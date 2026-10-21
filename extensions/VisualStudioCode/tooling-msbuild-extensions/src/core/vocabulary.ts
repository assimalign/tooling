/**
 * Collects the custom vocabulary of a set of MSBuild files: properties set or referenced, item
 * types and their metadata, and tasks registered with UsingTask.
 */

import { XmlDocument, XmlElement, XmlNode, attribute, elementChildren, localName, precedingComment, simpleContent } from './xml';

export interface VocabularySource {
    readonly path: string;
    readonly xml: XmlDocument;
}

export interface PropertyDefinition {
    readonly path: string;
    /** The raw value, when it is short single-line text. */
    readonly value: string | undefined;
    readonly documentation: string | undefined;
}

export interface PropertyVocabulary {
    readonly name: string;
    readonly definitions: PropertyDefinition[];
    /** Files that read the property with `$(Name)`. */
    readonly references: Set<string>;
}

export interface MetadataVocabulary {
    readonly name: string;
    readonly documentation: string | undefined;
}

export interface ItemVocabulary {
    readonly name: string;
    readonly definitions: { readonly path: string; readonly documentation: string | undefined }[];
    readonly metadata: Map<string, MetadataVocabulary>;
    /** Files that read the item with `@(Name)`. */
    readonly references: Set<string>;
}

export interface TaskParameter {
    readonly name: string;
    readonly required: boolean;
    readonly type: string | undefined;
}

export interface TaskVocabulary {
    readonly name: string;
    readonly path: string;
    readonly documentation: string | undefined;
    readonly parameters: Map<string, TaskParameter>;
}

export interface MSBuildVocabulary {
    /** By lower-cased name; MSBuild names are case-insensitive. */
    readonly properties: Map<string, PropertyVocabulary>;
    readonly items: Map<string, ItemVocabulary>;
    readonly tasks: Map<string, TaskVocabulary>;
}

/** Item attributes MSBuild interprets itself; any other attribute is metadata. */
const itemOperationAttributes = new Set([
    'condition', 'exclude', 'include', 'keepduplicates', 'keepmetadata', 'label', 'matchonmetadata',
    'matchonmetadataoptions', 'remove', 'removemetadata', 'update'
]);

const maximumValueLength = 120;

export function collectVocabulary(sources: readonly VocabularySource[]): MSBuildVocabulary {
    const vocabulary: MSBuildVocabulary = { properties: new Map(), items: new Map(), tasks: new Map() };
    const taskInvocations: { path: string; element: XmlElement }[] = [];

    for (const source of sources) {
        const root = source.xml.root;
        if (root === undefined || localName(root) !== 'Project') {
            continue;
        }

        visit(root, element => {
            switch (localName(element)) {
                case 'PropertyGroup':
                    collectProperties(vocabulary, source, element);
                    break;
                case 'ItemGroup':
                case 'ItemDefinitionGroup':
                    collectItems(vocabulary, source, element);
                    break;
                case 'UsingTask':
                    collectTask(vocabulary, source, element);
                    break;
                case 'Target':
                    for (const child of elementChildren(element)) {
                        const name = localName(child);
                        if (name !== 'PropertyGroup' && name !== 'ItemGroup' && name !== 'OnError') {
                            taskInvocations.push({ path: source.path, element: child });
                        }
                    }
                    break;
            }

            collectReferences(vocabulary, source, element);
        });
    }

    // Parameters a custom task is called with are parameters too, even when its UsingTask (a
    // compiled task) does not list them.
    for (const invocation of taskInvocations) {
        const task = vocabulary.tasks.get(localName(invocation.element).toLowerCase());
        if (task === undefined) {
            continue;
        }

        for (const parameter of invocation.element.attributes) {
            const key = parameter.name.toLowerCase();
            if (key !== 'condition' && key !== 'continueonerror' && !task.parameters.has(key)) {
                task.parameters.set(key, { name: parameter.name, required: false, type: undefined });
            }
        }
    }

    return vocabulary;
}

function visit(element: XmlElement, callback: (element: XmlElement) => void): void {
    callback(element);
    for (const child of elementChildren(element)) {
        visit(child, callback);
    }
}

function documentationOf(source: VocabularySource, element: XmlElement, group: XmlElement): string | undefined {
    return precedingComment(source.xml, element)
        ?? (elementChildren(group)[0] === element ? precedingComment(source.xml, group) : undefined);
}

function collectProperties(vocabulary: MSBuildVocabulary, source: VocabularySource, group: XmlElement): void {
    for (const element of elementChildren(group)) {
        const name = localName(element);
        const property = getOrAdd(vocabulary.properties, name, () => ({ name, definitions: [], references: new Set<string>() }));
        const content = simpleContent(source.xml, element)?.trim();
        property.definitions.push({
            path: source.path,
            value: content !== undefined && content.length > 0 && content.length <= maximumValueLength && !content.includes('\n') ? content : undefined,
            documentation: documentationOf(source, element, group)
        });
    }
}

function collectItems(vocabulary: MSBuildVocabulary, source: VocabularySource, group: XmlElement): void {
    for (const element of elementChildren(group)) {
        const name = localName(element);
        const item = getOrAdd(vocabulary.items, name, () => ({ name, definitions: [], metadata: new Map(), references: new Set<string>() }));
        item.definitions.push({ path: source.path, documentation: documentationOf(source, element, group) });

        for (const metadata of elementChildren(element)) {
            const metadataName = localName(metadata);
            if (!item.metadata.has(metadataName.toLowerCase())) {
                item.metadata.set(metadataName.toLowerCase(), { name: metadataName, documentation: precedingComment(source.xml, metadata) });
            }
        }
        for (const metadata of element.attributes) {
            const key = metadata.name.toLowerCase();
            if (!itemOperationAttributes.has(key) && !metadata.name.includes(':') && !item.metadata.has(key)) {
                item.metadata.set(key, { name: metadata.name, documentation: undefined });
            }
        }
    }
}

function collectTask(vocabulary: MSBuildVocabulary, source: VocabularySource, usingTask: XmlElement): void {
    const taskName = attribute(usingTask, 'TaskName')?.trim();
    if (taskName === undefined || taskName.length === 0 || taskName.includes('$(')) {
        return;
    }

    // Tasks are invoked by their short name: TaskName="Company.Tasks.StampVersion" is <StampVersion />.
    const name = taskName.slice(taskName.lastIndexOf('.') + 1);
    const task = getOrAdd(vocabulary.tasks, name, () => ({
        name,
        path: source.path,
        documentation: precedingComment(source.xml, usingTask),
        parameters: new Map<string, TaskParameter>()
    }));

    for (const group of elementChildren(usingTask)) {
        if (localName(group) !== 'ParameterGroup') {
            continue;
        }

        for (const parameter of elementChildren(group)) {
            task.parameters.set(localName(parameter).toLowerCase(), {
                name: localName(parameter),
                required: attribute(parameter, 'Required')?.trim().toLowerCase() === 'true',
                type: attribute(parameter, 'ParameterType')?.trim()
            });
        }
    }
}

const propertyReference = /\$\(\s*([A-Za-z_][A-Za-z0-9_-]*)\s*[).]/g;
const itemReference = /@\(\s*([A-Za-z_][A-Za-z0-9_-]*)\s*[)\-,]/g;

function collectReferences(vocabulary: MSBuildVocabulary, source: VocabularySource, element: XmlElement): void {
    const texts: string[] = element.attributes.map(candidate => candidate.value ?? '');
    for (const child of element.children as readonly XmlNode[]) {
        if (child.kind === 'text') {
            texts.push(source.xml.text.slice(child.start, child.end));
        }
    }

    for (const text of texts) {
        if (!text.includes('(')) {
            continue;
        }

        for (const match of text.matchAll(propertyReference)) {
            const name = match[1]!;
            // MSBuild* properties are reserved: they can be read but never set.
            if (!name.toLowerCase().startsWith('msbuild')) {
                getOrAdd(vocabulary.properties, name, () => ({ name, definitions: [], references: new Set<string>() })).references.add(source.path);
            }
        }
        for (const match of text.matchAll(itemReference)) {
            const name = match[1]!;
            getOrAdd(vocabulary.items, name, () => ({ name, definitions: [], metadata: new Map(), references: new Set<string>() })).references.add(source.path);
        }
    }
}

function getOrAdd<TValue>(map: Map<string, TValue>, name: string, create: () => TValue): TValue {
    const key = name.toLowerCase();
    let value = map.get(key);
    if (value === undefined) {
        value = create();
        map.set(key, value);
    }

    return value;
}
