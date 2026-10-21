/**
 * Resolves the files a document is evaluated with: what it imports, transitively, and what MSBuild
 * imports implicitly around it.
 *
 * Evaluation follows MSBuild's order. The nearest Directory.Build.props and Directory.Packages.props
 * come first, then the document, then the nearest Directory.Build.targets, the same files an SDK
 * project in the document's folder would get. Properties are evaluated as files are read, so an
 * import such as `$(RepoRoot)eng\Shared.targets` resolves against the value an earlier file set, and
 * a condition that evaluates to false skips its import exactly as MSBuild would.
 */

import { Evaluator, MSBuildFileSystem } from './expressions';
import { directoryOf, directoryWithSlash, joinPath, pathKey, resolvePath } from './paths';
import { ParseXml, XmlDocument, XmlElement, attribute, elementChildren, localName, simpleContent } from './xml';

export type ContextFileOrigin = 'document' | 'import' | 'implicit' | 'additional';

export interface ContextFile {
    readonly path: string;
    readonly text: string;
    readonly xml: XmlDocument;
    readonly origin: ContextFileOrigin;
    /** The file whose `<Import>` brought this one in. */
    readonly importedBy: string | undefined;
}

export interface UnresolvedImport {
    readonly file: string;
    readonly project: string;
    readonly reason: string;
}

export interface ImportChain {
    /** Files in evaluation order. */
    readonly files: readonly ContextFile[];
    readonly unresolved: readonly UnresolvedImport[];
}

export interface ImportChainOptions {
    readonly fileSystem: MSBuildFileSystem;
    readonly parseXml: ParseXml;
    /** The document's current, possibly unsaved, text. */
    readonly documentText: string;
    readonly implicitImports: boolean;
    /** Absolute paths of files to include as roots even though nothing imports them. */
    readonly additionalFiles?: readonly string[];
    /** Stops following imports after this many files. */
    readonly maximumFiles?: number;
}

const defaultMaximumFiles = 400;

export async function resolveImportChain(documentPath: string, options: ImportChainOptions): Promise<ImportChain> {
    const fileSystem: MSBuildFileSystem = {
        readFile: filePath => pathKey(filePath) === pathKey(documentPath) ? Promise.resolve(options.documentText) : options.fileSystem.readFile(filePath),
        exists: filePath => pathKey(filePath) === pathKey(documentPath) ? Promise.resolve(true) : options.fileSystem.exists(filePath),
        readDirectory: directory => options.fileSystem.readDirectory(directory)
    };
    const resolver = new ImportChainResolver(fileSystem, options, documentPath);
    return resolver.resolve();
}

class ImportChainResolver {
    private readonly evaluator: Evaluator;
    private readonly visited = new Set<string>();
    private readonly files: ContextFile[] = [];
    private readonly unresolved: UnresolvedImport[] = [];
    private readonly maximumFiles: number;

    public constructor(
        private readonly fileSystem: MSBuildFileSystem,
        private readonly options: ImportChainOptions,
        private readonly documentPath: string) {
        this.evaluator = new Evaluator(fileSystem, documentPath);
        this.maximumFiles = options.maximumFiles ?? defaultMaximumFiles;
    }

    public async resolve(): Promise<ImportChain> {
        const directory = directoryOf(this.documentPath);
        if (this.options.implicitImports) {
            await this.processImplicit(await this.findFileAbove(directory, 'Directory.Build.props'));
            await this.processImplicit(await this.findFileAbove(directory, 'Directory.Packages.props'));
        }

        await this.processFile(this.documentPath, 'document', undefined);

        if (this.options.implicitImports) {
            await this.processImplicit(await this.findFileAbove(directory, 'Directory.Build.targets'));
        }

        for (const additional of this.options.additionalFiles ?? []) {
            await this.processFile(additional, 'additional', undefined);
        }

        // The document may have been reached through an import first (editing build\Build.props,
        // which the root Directory.Build.props imports); it is still the document.
        const documentKey = pathKey(this.documentPath);
        return {
            files: this.files.map(file => pathKey(file.path) === documentKey ? { ...file, origin: 'document' } : file),
            unresolved: this.unresolved
        };
    }

    private async processImplicit(filePath: string | undefined): Promise<void> {
        if (filePath !== undefined && pathKey(filePath) !== pathKey(this.documentPath)) {
            await this.processFile(filePath, 'implicit', undefined);
        }
    }

    private async findFileAbove(startDirectory: string, name: string): Promise<string | undefined> {
        let directory = startDirectory;
        while (true) {
            const candidate = joinPath(directory, name);
            if (await this.fileSystem.exists(candidate)) {
                return candidate;
            }

            const parent = directoryOf(directory);
            if (parent === directory) {
                return undefined;
            }
            directory = parent;
        }
    }

    /** Reads, records, and evaluates a file. False when it could not be read. */
    private async processFile(filePath: string, origin: ContextFileOrigin, importedBy: string | undefined): Promise<boolean> {
        const key = pathKey(filePath);
        if (this.visited.has(key)) {
            return true;
        }
        if (this.files.length >= this.maximumFiles) {
            this.unresolved.push({ file: importedBy ?? filePath, project: filePath, reason: `stopped after ${this.maximumFiles} files` });
            return true;
        }

        const text = await this.fileSystem.readFile(filePath);
        if (text === undefined) {
            return false;
        }

        this.visited.add(key);
        const xml = this.options.parseXml(text);
        this.files.push({ path: filePath, text, xml, origin, importedBy });

        const root = xml.root;
        if (root === undefined || localName(root) !== 'Project') {
            return true;
        }

        this.evaluator.enterFile(filePath);
        try {
            await this.evaluateChildren(xml, root);
        }
        finally {
            this.evaluator.exitFile();
        }

        return true;
    }

    private async isConditionTrue(element: XmlElement): Promise<boolean> {
        const condition = attribute(element, 'Condition');
        if (condition === undefined || condition.trim().length === 0) {
            return true;
        }

        // Unknown counts as true: never hide what cannot be ruled out.
        return await this.evaluator.evaluateCondition(condition) !== false;
    }

    private async evaluateChildren(xml: XmlDocument, parent: XmlElement): Promise<void> {
        for (const element of elementChildren(parent)) {
            switch (localName(element)) {
                case 'PropertyGroup':
                    if (await this.isConditionTrue(element)) {
                        await this.evaluateProperties(xml, element);
                    }
                    break;
                case 'Import':
                    await this.evaluateImport(element);
                    break;
                case 'ImportGroup':
                    if (await this.isConditionTrue(element)) {
                        for (const child of elementChildren(element)) {
                            if (localName(child) === 'Import') {
                                await this.evaluateImport(child);
                            }
                        }
                    }
                    break;
                case 'Choose':
                    await this.evaluateChoose(xml, element);
                    break;
            }
        }
    }

    private async evaluateProperties(xml: XmlDocument, group: XmlElement): Promise<void> {
        for (const property of elementChildren(group)) {
            if (!await this.isConditionTrue(property)) {
                continue;
            }

            const content = simpleContent(xml, property);
            this.evaluator.setProperty(localName(property), content === undefined ? undefined : await this.evaluator.expand(content.trim()));
        }
    }

    private async evaluateChoose(xml: XmlDocument, choose: XmlElement): Promise<void> {
        for (const branch of elementChildren(choose)) {
            const name = localName(branch);
            if (name === 'When' && !await this.isConditionTrue(branch)) {
                continue;
            }
            if (name === 'When' || name === 'Otherwise') {
                await this.evaluateChildren(xml, branch);
                return;
            }
        }
    }

    private async evaluateImport(element: XmlElement): Promise<void> {
        const project = attribute(element, 'Project');
        const currentFile = this.evaluator.currentFile;
        if (project === undefined || attribute(element, 'Sdk') !== undefined || !await this.isConditionTrue(element)) {
            return; // SDK imports resolve from the .NET SDK, whose vocabulary the static schema covers.
        }

        const expanded = await this.evaluator.expand(project);
        if (expanded === undefined) {
            this.unresolved.push({ file: currentFile, project, reason: 'the path uses an expression this extension cannot evaluate' });
            return;
        }
        if (expanded.trim().length === 0) {
            return;
        }

        const resolved = resolvePath(expanded, directoryWithSlash(currentFile));
        const paths = /[*?]/.test(resolved) ? await this.expandWildcards(resolved) : [resolved];
        for (const filePath of paths) {
            if (!await this.processFile(filePath, 'import', currentFile)) {
                this.unresolved.push({ file: currentFile, project, reason: `${filePath} was not found` });
            }
        }
    }

    /** Expands `*`, `?`, and `**` in an absolute path, in sorted order. */
    private async expandWildcards(pattern: string): Promise<string[]> {
        const segments = pattern.split('/').filter(segment => segment.length > 0);
        const drive = /^[a-zA-Z]:$/.test(segments[0] ?? '') ? `/${segments.shift()}` : '';
        let candidates = [drive || '/'];

        for (let index = 0; index < segments.length; index++) {
            const segment = segments[index]!;
            const last = index === segments.length - 1;
            const next: string[] = [];
            for (const candidate of candidates) {
                if (segment === '**') {
                    next.push(...await this.allDirectories(candidate, 0));
                    continue;
                }
                if (!/[*?]/.test(segment)) {
                    next.push(joinPath(candidate, segment));
                    continue;
                }

                const matcher = new RegExp(`^${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
                for (const entry of await this.fileSystem.readDirectory(candidate) ?? []) {
                    if (matcher.test(entry.name) && entry.isDirectory !== last) {
                        next.push(joinPath(candidate, entry.name));
                    }
                }
            }
            candidates = next;
        }

        return candidates.sort((left, right) => left.localeCompare(right));
    }

    private async allDirectories(directory: string, depth: number): Promise<string[]> {
        const directories = [directory];
        if (depth >= 12) {
            return directories;
        }

        for (const entry of await this.fileSystem.readDirectory(directory) ?? []) {
            if (entry.isDirectory && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                directories.push(...await this.allDirectories(joinPath(directory, entry.name), depth + 1));
            }
        }

        return directories;
    }
}
