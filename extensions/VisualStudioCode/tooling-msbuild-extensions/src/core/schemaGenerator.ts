/**
 * Turns a collected vocabulary into an XML Schema that extends the static MSBuild schema.
 *
 * Properties substitute for `Property`, items for `Item`, and tasks for `Task`, so the XML editor
 * offers them in property groups, item groups, and targets exactly where the static vocabulary
 * appears. Names the static schema already declares are left to it.
 */

import { MSBuildVocabulary } from './vocabulary';
import { ParseXml, attribute, elementChildren, localName } from './xml';

export const msbuildNamespace = 'http://schemas.microsoft.com/developer/msbuild/2003';

export interface SchemaGenerationOptions {
    /** The target namespace: the 2003 MSBuild namespace for legacy projects, undefined otherwise. */
    readonly namespace: string | undefined;
    /** Lower-cased names of every global element the static schema declares. */
    readonly staticNames: ReadonlySet<string>;
    /** How a file is named in documentation, typically workspace-relative. */
    readonly describePath: (path: string) => string;
    /** Shown in the schema's header comment. */
    readonly description: string;
    /**
     * The file being edited. Names starting with `_` are private by MSBuild convention and are
     * offered only in a file that defines or uses them itself.
     */
    readonly documentPath?: string | undefined;
}

const validName = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const maximumLocations = 3;

/** Reads the lower-cased names of the global elements declared by the static schema files. */
export function readStaticElementNames(schemaTexts: readonly string[], parseXml: ParseXml): Set<string> {
    const names = new Set<string>();
    for (const text of schemaTexts) {
        const root = parseXml(text).root;
        for (const element of root === undefined ? [] : elementChildren(root)) {
            const name = localName(element) === 'element' ? attribute(element, 'name') : undefined;
            if (name !== undefined) {
                names.add(name.toLowerCase());
            }
        }
    }

    return names;
}

export function generateContextSchema(vocabulary: MSBuildVocabulary, options: SchemaGenerationOptions): string {
    const claimed = new Set(options.staticNames);
    const claim = (name: string, paths: Iterable<string>): boolean => {
        const key = name.toLowerCase();
        if (!validName.test(name) || claimed.has(key)) {
            return false;
        }
        if (name.startsWith('_') && (options.documentPath === undefined || ![...paths].includes(options.documentPath))) {
            return false;
        }
        claimed.add(key);
        return true;
    };
    const byName = <TValue extends { readonly name: string }>(values: Iterable<TValue>): TValue[] =>
        [...values].sort((left, right) => left.name.localeCompare(right.name));
    const locations = (paths: Iterable<string>): string => {
        const unique = [...new Set(paths)].map(path => `\`${options.describePath(path)}\``);
        return unique.length <= maximumLocations
            ? unique.join(', ')
            : `${unique.slice(0, maximumLocations).join(', ')} and ${unique.length - maximumLocations} more`;
    };

    const declarations: string[] = [];

    for (const property of byName(vocabulary.properties.values())) {
        if (!claim(property.name, [...property.definitions.map(definition => definition.path), ...property.references])) {
            continue;
        }

        const documented = property.definitions.find(definition => definition.documentation !== undefined)?.documentation;
        const value = property.definitions.find(definition => definition.value !== undefined)?.value;
        const facts = property.definitions.length > 0
            ? [`Set in ${locations(property.definitions.map(definition => definition.path))}.`, value === undefined ? undefined : `Value: \`${value}\``]
            : [`Read in ${locations(property.references)}; not set in the import chain.`];
        declarations.push(element(property.name, 'StringPropertyType', 'Property', [documented, ...facts]));
    }

    for (const item of byName(vocabulary.items.values())) {
        if (!claim(item.name, [...item.definitions.map(definition => definition.path), ...item.references])) {
            continue;
        }

        const documented = item.definitions.find(definition => definition.documentation !== undefined)?.documentation;
        const facts = item.definitions.length > 0
            ? `Item type defined in ${locations(item.definitions.map(definition => definition.path))}.`
            : `Item type read in ${locations(item.references)}; no items are added in the import chain.`;
        const metadata = byName(item.metadata.values()).filter(entry => validName.test(entry.name));
        const metadataElements = metadata.map(entry =>
            // StringPropertyType: text plus the Condition attribute metadata elements accept.
            `                <xs:element name="${entry.name}" type="StringPropertyType">${annotation([entry.documentation], '                ')}</xs:element>`);
        const metadataAttributes = metadata.map(entry => `            <xs:attribute name="${entry.name}" type="xs:string"/>`);
        declarations.push([
            `  <xs:element name="${item.name}" substitutionGroup="Item">${annotation([documented, facts], '  ')}`,
            '    <xs:complexType>',
            '      <xs:complexContent>',
            '        <xs:extension base="SimpleItemType">',
            ...(metadataElements.length === 0 ? [] : [
                '          <xs:sequence>',
                '            <xs:choice minOccurs="0" maxOccurs="unbounded">',
                ...metadataElements.map(line => line.replace(/^ {4}/, '')),
                '            </xs:choice>',
                '          </xs:sequence>'
            ]),
            ...metadataAttributes,
            '        </xs:extension>',
            '      </xs:complexContent>',
            '    </xs:complexType>',
            '  </xs:element>'
        ].join('\n'));
    }

    for (const task of byName(vocabulary.tasks.values())) {
        if (!claim(task.name, [task.path])) {
            continue;
        }

        const parameters = byName(task.parameters.values()).filter(parameter => validName.test(parameter.name));
        declarations.push([
            `  <xs:element name="${task.name}" substitutionGroup="Task">${annotation([task.documentation, `Task registered by UsingTask in \`${options.describePath(task.path)}\`.`], '  ')}`,
            '    <xs:complexType>',
            '      <xs:complexContent>',
            '        <xs:extension base="TaskType">',
            ...parameters.map(parameter => {
                const use = parameter.required ? ' use="required"' : '';
                const documentation = parameter.type === undefined ? '' : annotation([`Type: \`${parameter.type}\``], '          ');
                return documentation.length === 0
                    ? `          <xs:attribute name="${parameter.name}" type="xs:string"${use}/>`
                    : `          <xs:attribute name="${parameter.name}" type="xs:string"${use}>${documentation}</xs:attribute>`;
            }),
            // A compiled task's parameters are not visible here; never reject one.
            '          <xs:anyAttribute processContents="skip"/>',
            '        </xs:extension>',
            '      </xs:complexContent>',
            '    </xs:complexType>',
            '  </xs:element>'
        ].join('\n'));
    }

    const namespaceAttributes = options.namespace === undefined ? '' : ` targetNamespace="${options.namespace}" xmlns="${options.namespace}"`;
    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        `<!-- ${escapeComment(options.description)} -->`,
        `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"${namespaceAttributes} elementFormDefault="qualified">`,
        ...declarations,
        '</xs:schema>',
        ''
    ].join('\n');
}

function element(name: string, type: string, substitutionGroup: string, documentation: readonly (string | undefined)[]): string {
    return `  <xs:element name="${name}" type="${type}" substitutionGroup="${substitutionGroup}">${annotation(documentation, '  ')}</xs:element>`;
}

function annotation(parts: readonly (string | undefined)[], indent: string): string {
    const text = parts.filter((part): part is string => part !== undefined && part.length > 0).join('\n\n');
    return text.length === 0
        ? ''
        : `\n${indent}  <xs:annotation><xs:documentation>${escapeText(text)}</xs:documentation></xs:annotation>\n${indent}`;
}

function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeComment(text: string): string {
    return text.replace(/--/g, '- -');
}
