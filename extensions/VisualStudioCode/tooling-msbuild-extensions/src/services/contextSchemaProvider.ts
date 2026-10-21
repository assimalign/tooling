import * as vscode from 'vscode';

import type { XmlDocument, XmlEditorApi, XmlSchemaProvider, XmlSchemaSource } from '../../../tooling-xml-editor/src/api';
import { MSBuildFileSystem } from '../core/expressions';
import { ImportChain, resolveImportChain } from '../core/importChain';
import { pathKey, relativePath } from '../core/paths';
import { generateContextSchema, msbuildNamespace, readStaticElementNames } from '../core/schemaGenerator';
import { collectVocabulary } from '../core/vocabulary';

export const configurationSection = 'msbuildExtensions';

export const defaultFileExtensions: readonly string[] = ['.csproj', '.vbproj', '.fsproj', '.proj', '.props', '.targets'];

/** Coalesces bursts of file changes before asking the XML editor to re-validate. */
const changeDelayMilliseconds = 400;

interface CacheEntry {
    readonly key: string;
    readonly result: Promise<{ readonly chain: ImportChain; readonly sources: readonly XmlSchemaSource[] }>;
}

/**
 * Supplies schemas for MSBuild files to the XML editor: the static MSBuild schema, plus a schema
 * generated from the vocabulary of the document's import chain.
 */
export class MSBuildSchemaProvider implements XmlSchemaProvider, vscode.Disposable {
    public readonly selector: vscode.DocumentFilter[];
    public readonly onDidChangeSchemas: vscode.Event<void>;

    private readonly changed = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly fileCache = new Map<string, Promise<string | undefined>>();
    private readonly contexts = new Map<string, CacheEntry>();
    private readonly staticSchemas: { readonly plain: string; readonly namespaced: string };
    private readonly staticNames: Promise<Set<string>>;
    /** Bumped whenever any MSBuild file changes, which invalidates every cached import chain. */
    private generation = 0;
    private changeTimer: ReturnType<typeof setTimeout> | undefined;

    public constructor(
        context: vscode.ExtensionContext,
        private readonly api: XmlEditorApi,
        private readonly log: vscode.LogOutputChannel) {
        this.selector = createSelector();
        this.onDidChangeSchemas = this.changed.event;

        const schemaDirectory = vscode.Uri.joinPath(context.extensionUri, 'schemas');
        this.staticSchemas = {
            plain: vscode.Uri.joinPath(schemaDirectory, 'Microsoft.Build.xsd').toString(),
            namespaced: vscode.Uri.joinPath(schemaDirectory, 'Microsoft.Build.Namespaced.xsd').toString()
        };
        this.staticNames = Promise.all(['Microsoft.Build.Core.xsd', 'Microsoft.Build.CommonTypes.xsd'].map(async name =>
            new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(schemaDirectory, 'MSBuild', name)))))
            .then(texts => readStaticElementNames(texts, text => api.parseXml(text)));

        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{props,targets,proj,csproj,vbproj,fsproj}');
        const onFileChanged = (uri: vscode.Uri): void => {
            this.fileCache.delete(uri.toString());
            this.invalidate();
        };
        this.disposables.push(
            watcher,
            watcher.onDidChange(onFileChanged),
            watcher.onDidCreate(onFileChanged),
            watcher.onDidDelete(onFileChanged),
            // Unsaved edits to an open file are read from the editor, so they matter as soon as they are typed.
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.contentChanges.length > 0 && vscode.languages.match(this.selector, event.document) > 0) {
                    this.invalidate();
                }
            }),
            vscode.workspace.onDidCloseTextDocument(document => this.contexts.delete(document.uri.toString())),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(`${configurationSection}.importChain`)) {
                    this.invalidate();
                }
            }),
            this.changed);
    }

    private invalidate(): void {
        this.generation++;
        if (this.changeTimer !== undefined) {
            clearTimeout(this.changeTimer);
        }
        this.changeTimer = setTimeout(() => {
            this.changeTimer = undefined;
            this.changed.fire();
        }, changeDelayMilliseconds);
    }

    public async provideSchemas(document: vscode.TextDocument, xml: XmlDocument): Promise<readonly XmlSchemaSource[]> {
        return (await this.resolve(document, xml)).sources;
    }

    /** The import chain of a document, as used for its schema. */
    public async importChain(document: vscode.TextDocument): Promise<ImportChain> {
        return (await this.resolve(document, this.api.parseXml(document.getText()))).chain;
    }

    private resolve(document: vscode.TextDocument, xml: XmlDocument): CacheEntry['result'] {
        const uri = document.uri.toString();
        const key = `${document.version}:${this.generation}`;
        const cached = this.contexts.get(uri);
        if (cached !== undefined && cached.key === key) {
            return cached.result;
        }

        const result = this.compute(document, xml);
        this.contexts.set(uri, { key, result });
        return result;
    }

    private async compute(document: vscode.TextDocument, xml: XmlDocument): Promise<{ chain: ImportChain; sources: XmlSchemaSource[] }> {
        const namespaced = isNamespaced(xml);
        const sources: XmlSchemaSource[] = [{ uri: namespaced ? this.staticSchemas.namespaced : this.staticSchemas.plain }];
        const configuration = vscode.workspace.getConfiguration(configurationSection, document.uri);
        if (!configuration.get<boolean>('importChain.enabled', true)) {
            return { chain: { files: [], unresolved: [] }, sources };
        }

        const started = Date.now();
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const chain = await resolveImportChain(document.uri.path, {
            fileSystem: this.fileSystemFor(document.uri),
            parseXml: text => this.api.parseXml(text),
            documentText: document.getText(),
            implicitImports: configuration.get<boolean>('importChain.implicitImports', true),
            additionalFiles: await this.additionalFiles(configuration, folder)
        });

        const describePath = (filePath: string): string => relativePath(filePath, folder?.uri.path);
        const schema = generateContextSchema(collectVocabulary(chain.files), {
            namespace: namespaced ? msbuildNamespace : undefined,
            staticNames: await this.staticNames,
            describePath,
            documentPath: document.uri.path,
            description: `Generated from the import chain of ${describePath(document.uri.path)} (${chain.files.length} files).`
        });
        sources.push({ uri: `tooling-msbuild-context:/${hash(document.uri.toString())}.xsd`, content: schema });

        this.log.trace(`Resolved ${chain.files.length} files for ${describePath(document.uri.path)} in ${Date.now() - started} ms.`);
        for (const unresolved of chain.unresolved) {
            this.log.debug(`${describePath(unresolved.file)}: <Import Project="${unresolved.project}" /> not followed: ${unresolved.reason}.`);
        }

        return { chain, sources };
    }

    private async additionalFiles(configuration: vscode.WorkspaceConfiguration, folder: vscode.WorkspaceFolder | undefined): Promise<string[]> {
        const patterns = configuration.get<unknown>('importChain.additionalFiles', []);
        if (folder === undefined || !Array.isArray(patterns)) {
            return [];
        }

        const files: string[] = [];
        for (const pattern of patterns) {
            if (typeof pattern === 'string' && pattern.trim().length > 0) {
                const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern.trim()), '**/node_modules/**', 200);
                files.push(...matches.map(uri => uri.path).sort());
            }
        }

        return files;
    }

    /** Reads open documents from the editor (unsaved edits included) and everything else from disk. */
    private fileSystemFor(base: vscode.Uri): MSBuildFileSystem {
        const toUri = (filePath: string): vscode.Uri => base.with({ path: filePath, query: '', fragment: '' });
        const openDocument = (uri: vscode.Uri): vscode.TextDocument | undefined => {
            const key = pathKey(uri.path);
            return vscode.workspace.textDocuments.find(candidate =>
                candidate.uri.scheme === uri.scheme && candidate.uri.authority === uri.authority && pathKey(candidate.uri.path) === key);
        };

        return {
            readFile: filePath => {
                const uri = toUri(filePath);
                const open = openDocument(uri);
                if (open !== undefined) {
                    return Promise.resolve(open.getText());
                }

                const cacheKey = uri.toString();
                let text = this.fileCache.get(cacheKey);
                if (text === undefined) {
                    text = Promise.resolve(vscode.workspace.fs.readFile(uri)).then(
                        bytes => new TextDecoder('utf-8').decode(bytes),
                        () => undefined);
                    this.fileCache.set(cacheKey, text);
                }
                return text;
            },
            exists: async filePath => {
                const uri = toUri(filePath);
                if (openDocument(uri) !== undefined) {
                    return true;
                }
                try {
                    await vscode.workspace.fs.stat(uri);
                    return true;
                }
                catch {
                    return false;
                }
            },
            readDirectory: async directory => {
                try {
                    const entries = await vscode.workspace.fs.readDirectory(toUri(directory));
                    return entries.map(([name, type]) => ({ name, isDirectory: (type & vscode.FileType.Directory) !== 0 }));
                }
                catch {
                    return undefined;
                }
            }
        };
    }

    public dispose(): void {
        if (this.changeTimer !== undefined) {
            clearTimeout(this.changeTimer);
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

export function createSelector(): vscode.DocumentFilter[] {
    const configured = vscode.workspace
        .getConfiguration(configurationSection)
        .get<string[]>('fileExtensions', [...defaultFileExtensions]);
    const extensions = [...new Set(configured
        .map(extension => extension.trim().replace(/^\./, '').replace(/[{}[\]*?,]/g, ''))
        .filter(extension => extension.length > 0))];
    return extensions.length === 0 ? [] : [{ pattern: extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(',')}}` }];
}

/** True when the root element declares the legacy MSBuild 2003 namespace. */
function isNamespaced(xml: XmlDocument): boolean {
    return xml.root?.attributes.some(attribute => attribute.name === 'xmlns' && attribute.value === msbuildNamespace) === true;
}

/** A short stable identifier for a document, for its generated schema's URI. */
function hash(value: string): string {
    let result = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 0x01000193);
    }

    return (result >>> 0).toString(16).padStart(8, '0');
}
