import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { XmlSchemaProvider } from '../api';
import { XmlDocument, declaredNamespaces, schemaLocationHints } from '../core/parser';
import { SchemaLoader, SchemaSet, XSD_NAMESPACE } from '../core/schema';
import { configurationSection } from './documents';

/** One entry of the `xmlEditor.schemas` setting. */
export interface SchemaAssociation {
    readonly url?: string;
    readonly fileMatch?: readonly string[];
    readonly namespace?: string;
}

/** How long a remote schema download may take before it is abandoned. */
const downloadTimeoutMilliseconds = 15_000;

/**
 * Decides which schemas apply to a document and loads them.
 *
 * Sources, in priority order: `xmlEditor.schemas` entries whose `fileMatch` matches the document,
 * entries whose `namespace` the document declares, `xsi:schemaLocation` hints (skipped for a
 * namespace a setting already maps), the bundled schema-for-schemas for `.xsd` files, and schemas
 * from providers that other extensions register through the API.
 */
export class SchemaService implements vscode.Disposable {
    private readonly loader = new SchemaLoader(uri => this.fetch(uri));
    private readonly changed = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly reportedProblems = new Set<string>();
    private readonly bundledSchemaUri: string;
    private readonly providers: XmlSchemaProvider[] = [];
    private readonly providersChanged = new vscode.EventEmitter<void>();
    /** In-memory schema content supplied by providers, by URI. */
    private readonly suppliedSchemas = new Map<string, string>();

    /** Fires when schemas may have changed, so dependents can re-validate. */
    public readonly onDidChange = this.changed.event;

    /** Fires when a provider is registered or disposed, so the served document selector changes. */
    public readonly onDidChangeProviders = this.providersChanged.event;

    public constructor(context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {
        this.bundledSchemaUri = vscode.Uri.joinPath(context.extensionUri, 'schemas', 'XMLSchema.xsd').toString();

        const watcher = vscode.workspace.createFileSystemWatcher('**/*.xsd');
        this.disposables.push(
            watcher,
            watcher.onDidChange(() => this.reload()),
            watcher.onDidCreate(() => this.reload()),
            watcher.onDidDelete(() => this.reload()),
            vscode.workspace.onDidSaveTextDocument(document => {
                if (document.uri.path.toLowerCase().endsWith('.xsd')) {
                    this.reload();
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(`${configurationSection}.schemas`)
                    || event.affectsConfiguration(`${configurationSection}.schemaLocation`)
                    || event.affectsConfiguration(`${configurationSection}.schemaDownload`)) {
                    this.reload();
                }
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(() => this.reload()),
            this.changed,
            this.providersChanged);
    }

    public registerProvider(provider: XmlSchemaProvider): vscode.Disposable {
        this.providers.push(provider);
        const subscription = provider.onDidChangeSchemas?.(() => this.changed.fire());
        this.providersChanged.fire();
        this.changed.fire();

        return new vscode.Disposable(() => {
            const index = this.providers.indexOf(provider);
            if (index !== -1) {
                this.providers.splice(index, 1);
                subscription?.dispose();
                this.providersChanged.fire();
                this.changed.fire();
            }
        });
    }

    /** The documents providers serve, as document filters. */
    public providerSelector(): vscode.DocumentFilter[] {
        return this.providers.flatMap(provider => toFilters(provider.selector));
    }

    public reload(): void {
        this.loader.clear();
        this.reportedProblems.clear();
        this.changed.fire();
    }

    public async schemasFor(document: vscode.TextDocument, xml: XmlDocument): Promise<SchemaSet | undefined> {
        const uris = [...this.schemaUrisFor(document, xml), ...await this.providedSchemaUris(document, xml)];
        if (uris.length === 0) {
            return undefined;
        }

        const schemas = await this.loader.load(uris);
        for (const problem of schemas.problems) {
            const key = `${problem.uri}\n${problem.message}`;
            if (!this.reportedProblems.has(key)) {
                this.reportedProblems.add(key);
                this.log.warn(`${problem.uri}: ${problem.message}`);
            }
        }

        return schemas;
    }

    /** Namespace URIs from the settings, offered as `xmlns` values. */
    public knownNamespaces(document: vscode.TextDocument): string[] {
        const namespaces = this.associations(document)
            .map(association => association.namespace)
            .filter((namespace): namespace is string => typeof namespace === 'string' && namespace.length > 0);
        return [...new Set(namespaces)];
    }

    public schemaUrisFor(document: vscode.TextDocument, xml: XmlDocument): string[] {
        const configuration = vscode.workspace.getConfiguration(configurationSection, document.uri);
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const namespaces = declaredNamespaces(xml);
        const uris = new Set<string>();
        const mappedNamespaces = new Set<string>();

        for (const association of this.associations(document)) {
            if (typeof association.url !== 'string' || association.url.trim().length === 0) {
                continue;
            }

            const byFile = Array.isArray(association.fileMatch)
                && association.fileMatch.some(pattern => typeof pattern === 'string' && matchesFilePattern(document, pattern, folder));
            const byNamespace = typeof association.namespace === 'string' && namespaces.has(association.namespace);
            if (typeof association.namespace === 'string') {
                mappedNamespaces.add(association.namespace);
            }
            if (!byFile && !byNamespace) {
                continue;
            }

            const resolved = resolveSettingLocation(association.url, document, folder);
            if (resolved === undefined) {
                this.log.warn(`Could not resolve schema location '${association.url}' from the xmlEditor.schemas setting.`);
            }
            else {
                uris.add(resolved);
            }
        }

        if (configuration.get<boolean>('schemaLocation.enabled', true)) {
            for (const hint of schemaLocationHints(xml)) {
                if (!mappedNamespaces.has(hint.namespace)) {
                    const resolved = resolveDocumentLocation(hint.location, document.uri);
                    if (resolved !== undefined) {
                        uris.add(resolved);
                    }
                }
            }
        }

        if (document.uri.path.toLowerCase().endsWith('.xsd') || namespaces.has(XSD_NAMESPACE)) {
            uris.add(this.bundledSchemaUri);
        }

        return [...uris];
    }

    private async providedSchemaUris(document: vscode.TextDocument, xml: XmlDocument): Promise<string[]> {
        const uris: string[] = [];
        for (const provider of this.providers) {
            if (vscode.languages.match(provider.selector, document) === 0) {
                continue;
            }

            let sources;
            try {
                sources = await provider.provideSchemas(document, xml);
            }
            catch (error) {
                this.log.error(`A schema provider failed for ${document.uri.toString()}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }

            for (const source of sources) {
                if (source.content !== undefined && this.suppliedSchemas.get(source.uri) !== source.content) {
                    this.suppliedSchemas.set(source.uri, source.content);
                    this.loader.invalidateRoot(source.uri);
                }
                uris.push(source.uri);
            }
        }

        return uris;
    }

    private associations(document: vscode.TextDocument): SchemaAssociation[] {
        const value = vscode.workspace.getConfiguration(configurationSection, document.uri).get<unknown>('schemas', []);
        return Array.isArray(value)
            ? value.filter((entry): entry is SchemaAssociation => typeof entry === 'object' && entry !== null)
            : [];
    }

    private async fetch(uri: string): Promise<string> {
        const supplied = this.suppliedSchemas.get(uri);
        if (supplied !== undefined) {
            return supplied;
        }

        const resource = vscode.Uri.parse(uri, true);
        if (resource.scheme === 'http' || resource.scheme === 'https') {
            if (!vscode.workspace.isTrusted) {
                throw new Error('schemas are not downloaded in an untrusted workspace');
            }
            if (!vscode.workspace.getConfiguration(configurationSection).get<boolean>('schemaDownload.enabled', true)) {
                throw new Error('schema download is disabled by xmlEditor.schemaDownload.enabled');
            }

            this.log.info(`Downloading schema ${uri}`);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), downloadTimeoutMilliseconds);
            try {
                const response = await fetch(uri, { signal: controller.signal });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} ${response.statusText}`);
                }

                return await response.text();
            }
            finally {
                clearTimeout(timeout);
            }
        }

        const bytes = await vscode.workspace.fs.readFile(resource);
        return new TextDecoder('utf-8').decode(bytes);
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

function toFilters(selector: vscode.DocumentSelector): vscode.DocumentFilter[] {
    const filters = Array.isArray(selector) ? selector : [selector];
    return filters.map(filter => typeof filter === 'string' ? { language: filter } : filter);
}

/**
 * Matches a `fileMatch` glob against a document. Patterns are relative to the workspace folder;
 * a leading `/` or `./` is ignored, and a pattern without `/` matches the file name in any folder.
 */
export function matchesFilePattern(document: vscode.TextDocument, pattern: string, folder: vscode.WorkspaceFolder | undefined): boolean {
    let glob = pattern.trim().replace(/\\/g, '/');
    if (glob.startsWith('./')) {
        glob = glob.slice(2);
    }
    else if (glob.startsWith('/')) {
        glob = glob.slice(1);
    }
    if (glob.length === 0) {
        return false;
    }
    if (!glob.includes('/')) {
        glob = `**/${glob}`;
    }

    const filter: vscode.DocumentFilter = folder === undefined
        ? { pattern: glob.startsWith('**/') ? glob : `**/${glob}` }
        : { pattern: new vscode.RelativePattern(folder, glob) };
    return vscode.languages.match(filter, document) > 0;
}

/**
 * Resolves a schema location from the settings: `${workspaceFolder}`, `~` and `${userHome}`,
 * absolute paths, URLs with a scheme, and paths relative to the document's workspace folder (or to
 * the document itself outside a workspace).
 */
export function resolveSettingLocation(location: string, document: vscode.TextDocument, folder: vscode.WorkspaceFolder | undefined): string | undefined {
    const value = location.trim();
    const workspaceFolder = /^\$\{workspaceFolder\}[\\/]?/.exec(value);
    if (workspaceFolder !== null) {
        return folder === undefined ? undefined : joinPath(folder.uri, value.slice(workspaceFolder[0].length));
    }

    const home = /^(~|\$\{userHome\})[\\/]?/.exec(value);
    if (home !== null) {
        return vscode.Uri.file(path.join(os.homedir(), value.slice(home[0].length))).toString();
    }

    if (isAbsoluteFilePath(value)) {
        return vscode.Uri.file(value).toString();
    }
    if (/^[a-z][a-z0-9+.-]+:/i.test(value)) {
        return vscode.Uri.parse(value, true).toString();
    }

    const base = folder?.uri ?? vscode.Uri.joinPath(document.uri, '..');
    return joinPath(base, value);
}

/** Resolves an `xsi:schemaLocation` value against the document that contains it. */
export function resolveDocumentLocation(location: string, documentUri: vscode.Uri): string | undefined {
    const value = location.trim();
    if (isAbsoluteFilePath(value) && !value.startsWith('/')) {
        return vscode.Uri.file(value).toString();
    }

    try {
        return new URL(value, documentUri.toString()).toString();
    }
    catch {
        return undefined;
    }
}

function isAbsoluteFilePath(value: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

function joinPath(base: vscode.Uri, relative: string): string {
    const segments = relative.replace(/\\/g, '/').split('/').filter(segment => segment.length > 0 && segment !== '.');
    return vscode.Uri.joinPath(base, ...segments).toString();
}
