/**
 * An XML Schema (XSD 1.0) component model sized for editor features.
 *
 * This is not a validating schema processor. It reads the parts of a schema that drive completion,
 * hover, and structural validation — declarations, content models, attribute uses, enumerations,
 * documentation, substitution groups, derivation, include, and import — and answers questions like
 * "which elements may appear here". Identity constraints, facets other than enumerations, and
 * particle ordering are intentionally out of scope; anything the model cannot resolve is reported as
 * incomplete so callers stay silent rather than raise false errors.
 */

import {
    XmlDocument,
    XmlElement,
    childElements,
    getAttribute,
    lookupNamespace,
    parseXml,
    splitQualifiedName,
    textContent
} from './parser';

export const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';

/** A namespace-qualified component key, `{namespace}localName`. */
export type ComponentKey = string;

export function componentKey(namespace: string, localName: string): ComponentKey {
    return `{${namespace}}${localName}`;
}

export function splitComponentKey(key: ComponentKey): { namespace: string; localName: string } {
    const close = key.indexOf('}');
    return { namespace: key.slice(1, close), localName: key.slice(close + 1) };
}

export interface Wildcard {
    /** The raw `namespace` attribute: `##any`, `##other`, or a list of URIs, `##targetNamespace`, `##local`. */
    readonly namespaces: string;
    readonly targetNamespace: string;
}

export interface ElementDeclaration {
    readonly name: string;
    readonly namespace: string;
    readonly typeName: ComponentKey | undefined;
    readonly type: TypeDefinition | undefined;
    readonly abstract: boolean;
    readonly substitutionGroup: ComponentKey | undefined;
    readonly documentation: string | undefined;
    readonly defaultValue: string | undefined;
    readonly fixedValue: string | undefined;
}

export interface AttributeDeclaration {
    readonly name: string;
    readonly namespace: string;
    readonly typeName: ComponentKey | undefined;
    readonly type: SimpleTypeDefinition | undefined;
    readonly documentation: string | undefined;
}

export type AttributeUseKind = 'optional' | 'required' | 'prohibited';

export type AttributeEntry =
    | {
        readonly kind: 'attribute';
        readonly declaration: AttributeDeclaration | undefined;
        readonly ref: ComponentKey | undefined;
        readonly use: AttributeUseKind;
        readonly defaultValue: string | undefined;
        readonly fixedValue: string | undefined;
        readonly documentation: string | undefined;
    }
    | { readonly kind: 'attributeGroup'; readonly ref: ComponentKey };

export interface AttributeGroupDefinition {
    readonly attributes: readonly AttributeEntry[];
    readonly anyAttribute: Wildcard | undefined;
}

export type Particle =
    | { readonly kind: 'element'; readonly min: number; readonly max: number; readonly declaration: ElementDeclaration | undefined; readonly ref: ComponentKey | undefined }
    | { readonly kind: 'sequence' | 'choice' | 'all'; readonly min: number; readonly max: number; readonly particles: readonly Particle[] }
    | { readonly kind: 'group'; readonly min: number; readonly max: number; readonly ref: ComponentKey }
    | { readonly kind: 'any'; readonly min: number; readonly max: number; readonly wildcard: Wildcard };

export interface ComplexTypeDefinition {
    readonly kind: 'complex';
    readonly name: string | undefined;
    readonly namespace: string;
    readonly documentation: string | undefined;
    readonly mixed: boolean;
    readonly simpleContent: boolean;
    readonly baseTypeName: ComponentKey | undefined;
    readonly derivation: 'extension' | 'restriction' | undefined;
    /** Facets declared by a simpleContent restriction. */
    readonly contentType: SimpleTypeDefinition | undefined;
    readonly particle: Particle | undefined;
    readonly attributes: readonly AttributeEntry[];
    readonly anyAttribute: Wildcard | undefined;
}

export interface Enumeration {
    readonly value: string;
    readonly documentation: string | undefined;
}

export interface SimpleTypeDefinition {
    readonly kind: 'simple';
    readonly name: string | undefined;
    readonly namespace: string;
    readonly documentation: string | undefined;
    readonly variety: 'atomic' | 'list' | 'union';
    readonly baseTypeName: ComponentKey | undefined;
    readonly baseType: SimpleTypeDefinition | undefined;
    readonly enumerations: readonly Enumeration[];
    readonly memberTypeNames: readonly ComponentKey[];
    readonly memberTypes: readonly SimpleTypeDefinition[];
    readonly itemTypeName: ComponentKey | undefined;
    readonly itemType: SimpleTypeDefinition | undefined;
}

export type TypeDefinition = ComplexTypeDefinition | SimpleTypeDefinition;

export interface SchemaReference {
    readonly kind: 'include' | 'import';
    readonly location: string;
    readonly namespace: string | undefined;
}

export interface SchemaProblem {
    readonly uri: string;
    readonly message: string;
}

/** The global components of one schema document. */
export interface SchemaDocument {
    readonly uri: string;
    readonly targetNamespace: string;
    readonly elements: Map<ComponentKey, ElementDeclaration>;
    readonly attributes: Map<ComponentKey, AttributeDeclaration>;
    readonly types: Map<ComponentKey, TypeDefinition>;
    readonly groups: Map<ComponentKey, Particle>;
    readonly attributeGroups: Map<ComponentKey, AttributeGroupDefinition>;
    readonly references: readonly SchemaReference[];
    readonly problems: readonly SchemaProblem[];
}

// ------------------------------------------------------------------------------------------------
// Reading a schema document
// ------------------------------------------------------------------------------------------------

/**
 * Reads the global components of one schema document. `includingNamespace` is the target namespace
 * of the schema that included this one, which a schema without its own target namespace adopts
 * ("chameleon" include).
 */
export function readSchemaDocument(text: string, uri: string, includingNamespace?: string): SchemaDocument {
    const xml = parseXml(text);
    const problems: SchemaProblem[] = [];
    const root = xml.root;
    const empty = (): SchemaDocument => ({
        uri,
        targetNamespace: includingNamespace ?? '',
        elements: new Map(),
        attributes: new Map(),
        types: new Map(),
        groups: new Map(),
        attributeGroups: new Map(),
        references: [],
        problems
    });

    if (root === undefined || !isSchemaElement(root, 'schema')) {
        problems.push({ uri, message: 'The document is not an XML Schema; expected an xs:schema root element.' });
        return empty();
    }

    if (xml.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
        problems.push({ uri, message: `The schema is not well-formed: ${xml.diagnostics[0]!.message}` });
    }

    const reader = new SchemaReader(xml, root, uri, includingNamespace);
    return reader.read(problems);
}

function isSchemaElement(element: XmlElement, localName?: string): boolean {
    return lookupNamespace(element, splitQualifiedName(element.name).prefix) === XSD_NAMESPACE
        && (localName === undefined || splitQualifiedName(element.name).localName === localName);
}

function localNameOf(element: XmlElement): string {
    return splitQualifiedName(element.name).localName;
}

function schemaChildren(element: XmlElement): XmlElement[] {
    return childElements(element).filter(child => isSchemaElement(child));
}

function attributeValue(element: XmlElement, name: string): string | undefined {
    const value = getAttribute(element, name)?.value;
    return value === undefined ? undefined : value.trim();
}

function parseOccurs(value: string | undefined): number {
    if (value === undefined) {
        return 1;
    }
    if (value === 'unbounded') {
        return Number.POSITIVE_INFINITY;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 1 : parsed;
}

class SchemaReader {
    private readonly targetNamespace: string;
    /** True when this schema has no target namespace of its own and adopts the includer's. */
    private readonly chameleon: boolean;
    private readonly elementFormQualified: boolean;
    private readonly attributeFormQualified: boolean;

    public constructor(
        private readonly xml: XmlDocument,
        private readonly root: XmlElement,
        private readonly uri: string,
        includingNamespace: string | undefined) {
        const declaredNamespace = attributeValue(root, 'targetNamespace');
        this.targetNamespace = declaredNamespace ?? includingNamespace ?? '';
        this.chameleon = declaredNamespace === undefined && includingNamespace !== undefined && includingNamespace !== '';
        this.elementFormQualified = attributeValue(root, 'elementFormDefault') === 'qualified';
        this.attributeFormQualified = attributeValue(root, 'attributeFormDefault') === 'qualified';
    }

    public read(problems: SchemaProblem[]): SchemaDocument {
        const result: SchemaDocument = {
            uri: this.uri,
            targetNamespace: this.targetNamespace,
            elements: new Map(),
            attributes: new Map(),
            types: new Map(),
            groups: new Map(),
            attributeGroups: new Map(),
            references: [],
            problems
        };
        const references = result.references as SchemaReference[];

        for (const child of schemaChildren(this.root)) {
            const name = attributeValue(child, 'name');
            const key = name === undefined ? undefined : componentKey(this.targetNamespace, name);
            switch (localNameOf(child)) {
                case 'element':
                    if (key !== undefined) {
                        result.elements.set(key, this.readElementDeclaration(child, true));
                    }
                    break;
                case 'attribute':
                    if (key !== undefined) {
                        result.attributes.set(key, this.readAttributeDeclaration(child, true));
                    }
                    break;
                case 'complexType':
                    if (key !== undefined) {
                        result.types.set(key, this.readComplexType(child, name));
                    }
                    break;
                case 'simpleType':
                    if (key !== undefined) {
                        result.types.set(key, this.readSimpleType(child, name));
                    }
                    break;
                case 'group': {
                    const particle = this.readGroupDefinition(child);
                    if (key !== undefined && particle !== undefined) {
                        result.groups.set(key, particle);
                    }
                    break;
                }
                case 'attributeGroup':
                    if (key !== undefined) {
                        result.attributeGroups.set(key, this.readAttributeContainer(child));
                    }
                    break;
                case 'include':
                case 'redefine':
                case 'override': {
                    const location = attributeValue(child, 'schemaLocation');
                    if (location) {
                        references.push({ kind: 'include', location, namespace: this.targetNamespace });
                    }
                    break;
                }
                case 'import': {
                    const location = attributeValue(child, 'schemaLocation');
                    if (location) {
                        references.push({ kind: 'import', location, namespace: attributeValue(child, 'namespace') });
                    }
                    break;
                }
            }
        }

        return result;
    }

    private resolveQualifiedName(element: XmlElement, value: string | undefined): ComponentKey | undefined {
        if (value === undefined || value.length === 0) {
            return undefined;
        }

        const { prefix, localName } = splitQualifiedName(value);
        let namespace = lookupNamespace(element, prefix);
        if (namespace === '' && this.chameleon) {
            // A chameleon include moves its no-namespace references into the including namespace too.
            namespace = this.targetNamespace;
        }
        // An undeclared prefix cannot be resolved; keep a key that will never match anything.
        return componentKey(namespace ?? `#unresolved:${prefix}`, localName);
    }

    private documentation(element: XmlElement): string | undefined {
        const parts: string[] = [];
        for (const annotation of schemaChildren(element)) {
            if (localNameOf(annotation) !== 'annotation') {
                continue;
            }

            for (const documentation of schemaChildren(annotation)) {
                if (localNameOf(documentation) === 'documentation') {
                    const text = normalizeDocumentation(textContent(this.xml, documentation));
                    if (text.length > 0) {
                        parts.push(text);
                    }
                }
            }
        }

        return parts.length === 0 ? undefined : parts.join('\n\n');
    }

    private readElementDeclaration(element: XmlElement, global: boolean): ElementDeclaration {
        const form = attributeValue(element, 'form');
        const qualified = global || form === 'qualified' || (form === undefined && this.elementFormQualified);
        const inline = schemaChildren(element).find(child => {
            const localName = localNameOf(child);
            return localName === 'complexType' || localName === 'simpleType';
        });

        return {
            name: attributeValue(element, 'name') ?? '',
            namespace: qualified ? this.targetNamespace : '',
            typeName: this.resolveQualifiedName(element, attributeValue(element, 'type')),
            type: inline === undefined
                ? undefined
                : localNameOf(inline) === 'complexType' ? this.readComplexType(inline, undefined) : this.readSimpleType(inline, undefined),
            abstract: attributeValue(element, 'abstract') === 'true',
            substitutionGroup: this.resolveQualifiedName(element, attributeValue(element, 'substitutionGroup')),
            documentation: this.documentation(element),
            defaultValue: attributeValue(element, 'default'),
            fixedValue: attributeValue(element, 'fixed')
        };
    }

    private readAttributeDeclaration(element: XmlElement, global: boolean): AttributeDeclaration {
        const form = attributeValue(element, 'form');
        const qualified = global || form === 'qualified' || (form === undefined && this.attributeFormQualified);
        const inline = schemaChildren(element).find(child => localNameOf(child) === 'simpleType');
        return {
            name: attributeValue(element, 'name') ?? '',
            namespace: qualified ? this.targetNamespace : '',
            typeName: this.resolveQualifiedName(element, attributeValue(element, 'type')),
            type: inline === undefined ? undefined : this.readSimpleType(inline, undefined),
            documentation: this.documentation(element)
        };
    }

    private readGroupDefinition(element: XmlElement): Particle | undefined {
        const model = schemaChildren(element).find(child => ['sequence', 'choice', 'all'].includes(localNameOf(child)));
        return model === undefined ? undefined : this.readParticle(model);
    }

    private readParticle(element: XmlElement): Particle | undefined {
        const min = parseOccurs(attributeValue(element, 'minOccurs'));
        const max = parseOccurs(attributeValue(element, 'maxOccurs'));
        const localName = localNameOf(element);
        switch (localName) {
            case 'element': {
                const ref = this.resolveQualifiedName(element, attributeValue(element, 'ref'));
                return ref !== undefined
                    ? { kind: 'element', min, max, declaration: undefined, ref }
                    : { kind: 'element', min, max, declaration: this.readElementDeclaration(element, false), ref: undefined };
            }
            case 'sequence':
            case 'choice':
            case 'all': {
                const particles: Particle[] = [];
                for (const child of schemaChildren(element)) {
                    const particle = this.readParticle(child);
                    if (particle !== undefined) {
                        particles.push(particle);
                    }
                }
                return { kind: localName, min, max, particles };
            }
            case 'group': {
                const ref = this.resolveQualifiedName(element, attributeValue(element, 'ref'));
                return ref === undefined ? undefined : { kind: 'group', min, max, ref };
            }
            case 'any':
                return { kind: 'any', min, max, wildcard: this.readWildcard(element) };
            default:
                return undefined;
        }
    }

    private readWildcard(element: XmlElement): Wildcard {
        return { namespaces: attributeValue(element, 'namespace') ?? '##any', targetNamespace: this.targetNamespace };
    }

    /** Reads attribute, attributeGroup, and anyAttribute children of a type, extension, or group. */
    private readAttributeContainer(element: XmlElement): AttributeGroupDefinition {
        const attributes: AttributeEntry[] = [];
        let anyAttribute: Wildcard | undefined;
        for (const child of schemaChildren(element)) {
            switch (localNameOf(child)) {
                case 'attribute': {
                    const ref = this.resolveQualifiedName(child, attributeValue(child, 'ref'));
                    const use = attributeValue(child, 'use');
                    attributes.push({
                        kind: 'attribute',
                        declaration: ref === undefined ? this.readAttributeDeclaration(child, false) : undefined,
                        ref,
                        use: use === 'required' || use === 'prohibited' ? use : 'optional',
                        defaultValue: attributeValue(child, 'default'),
                        fixedValue: attributeValue(child, 'fixed'),
                        documentation: this.documentation(child)
                    });
                    break;
                }
                case 'attributeGroup': {
                    const ref = this.resolveQualifiedName(child, attributeValue(child, 'ref'));
                    if (ref !== undefined) {
                        attributes.push({ kind: 'attributeGroup', ref });
                    }
                    break;
                }
                case 'anyAttribute':
                    anyAttribute = this.readWildcard(child);
                    break;
            }
        }

        return { attributes, anyAttribute };
    }

    private readComplexType(element: XmlElement, name: string | undefined): ComplexTypeDefinition {
        let mixed = attributeValue(element, 'mixed') === 'true';
        let simpleContent = false;
        let baseTypeName: ComponentKey | undefined;
        let derivation: 'extension' | 'restriction' | undefined;
        let contentType: SimpleTypeDefinition | undefined;
        let particle: Particle | undefined;
        let container: AttributeGroupDefinition = this.readAttributeContainer(element);

        for (const child of schemaChildren(element)) {
            const localName = localNameOf(child);
            if (localName === 'simpleContent' || localName === 'complexContent') {
                simpleContent = localName === 'simpleContent';
                if (attributeValue(child, 'mixed') === 'true') {
                    mixed = true;
                }

                const derivationElement = schemaChildren(child).find(candidate => {
                    const candidateName = localNameOf(candidate);
                    return candidateName === 'extension' || candidateName === 'restriction';
                });
                if (derivationElement === undefined) {
                    continue;
                }

                derivation = localNameOf(derivationElement) as 'extension' | 'restriction';
                baseTypeName = this.resolveQualifiedName(derivationElement, attributeValue(derivationElement, 'base'));
                container = this.readAttributeContainer(derivationElement);
                if (simpleContent) {
                    const enumerations = this.readEnumerations(derivationElement);
                    if (enumerations.length > 0) {
                        contentType = this.simpleType(undefined, undefined, { baseTypeName, enumerations });
                    }
                }
                else {
                    const model = schemaChildren(derivationElement).find(candidate =>
                        ['sequence', 'choice', 'all', 'group'].includes(localNameOf(candidate)));
                    particle = model === undefined ? undefined : this.readParticle(model);
                }
            }
            else if (['sequence', 'choice', 'all', 'group'].includes(localName)) {
                particle = this.readParticle(child);
            }
        }

        return {
            kind: 'complex',
            name,
            namespace: this.targetNamespace,
            documentation: this.documentation(element),
            mixed,
            simpleContent,
            baseTypeName,
            derivation,
            contentType,
            particle,
            attributes: container.attributes,
            anyAttribute: container.anyAttribute
        };
    }

    private readEnumerations(element: XmlElement): Enumeration[] {
        return schemaChildren(element)
            .filter(child => localNameOf(child) === 'enumeration')
            .map(child => ({ value: getAttribute(child, 'value')?.value ?? '', documentation: this.documentation(child) }));
    }

    private readSimpleType(element: XmlElement, name: string | undefined): SimpleTypeDefinition {
        const documentation = this.documentation(element);
        for (const child of schemaChildren(element)) {
            const inline = schemaChildren(child).filter(candidate => localNameOf(candidate) === 'simpleType');
            switch (localNameOf(child)) {
                case 'restriction':
                    return this.simpleType(name, documentation, {
                        baseTypeName: this.resolveQualifiedName(child, attributeValue(child, 'base')),
                        baseType: inline[0] === undefined ? undefined : this.readSimpleType(inline[0], undefined),
                        enumerations: this.readEnumerations(child)
                    });
                case 'union':
                    return this.simpleType(name, documentation, {
                        variety: 'union',
                        memberTypeNames: (attributeValue(child, 'memberTypes') ?? '')
                            .split(/\s+/)
                            .map(token => this.resolveQualifiedName(child, token))
                            .filter((key): key is ComponentKey => key !== undefined),
                        memberTypes: inline.map(member => this.readSimpleType(member, undefined))
                    });
                case 'list':
                    return this.simpleType(name, documentation, {
                        variety: 'list',
                        itemTypeName: this.resolveQualifiedName(child, attributeValue(child, 'itemType')),
                        itemType: inline[0] === undefined ? undefined : this.readSimpleType(inline[0], undefined)
                    });
            }
        }

        return this.simpleType(name, documentation, {});
    }

    private simpleType(
        name: string | undefined,
        documentation: string | undefined,
        parts: Partial<Omit<SimpleTypeDefinition, 'kind' | 'name' | 'namespace' | 'documentation'>>): SimpleTypeDefinition {
        return {
            kind: 'simple',
            name,
            namespace: this.targetNamespace,
            documentation,
            variety: parts.variety ?? 'atomic',
            baseTypeName: parts.baseTypeName,
            baseType: parts.baseType,
            enumerations: parts.enumerations ?? [],
            memberTypeNames: parts.memberTypeNames ?? [],
            memberTypes: parts.memberTypes ?? [],
            itemTypeName: parts.itemTypeName,
            itemType: parts.itemType
        };
    }
}

/** Collapses the indentation an annotation picks up from the schema's own formatting. */
export function normalizeDocumentation(text: string): string {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length > 0 && lines[0]!.trim().length === 0) {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1]!.trim().length === 0) {
        lines.pop();
    }

    const indentation = Math.min(...lines
        .filter(line => line.trim().length > 0)
        .map(line => line.length - line.trimStart().length));
    return lines.map(line => line.slice(Number.isFinite(indentation) ? indentation : 0).trimEnd()).join('\n');
}

// ------------------------------------------------------------------------------------------------
// Built-in types
// ------------------------------------------------------------------------------------------------

/** Every built-in XSD datatype name, for completion of type references while authoring schemas. */
export const builtInTypeNames: readonly string[] = [
    'anyType', 'anySimpleType', 'anyURI', 'base64Binary', 'boolean', 'byte', 'date', 'dateTime',
    'decimal', 'double', 'duration', 'ENTITIES', 'ENTITY', 'float', 'gDay', 'gMonth', 'gMonthDay',
    'gYear', 'gYearMonth', 'hexBinary', 'ID', 'IDREF', 'IDREFS', 'int', 'integer', 'language', 'long',
    'Name', 'NCName', 'negativeInteger', 'NMTOKEN', 'NMTOKENS', 'nonNegativeInteger',
    'nonPositiveInteger', 'normalizedString', 'NOTATION', 'positiveInteger', 'QName', 'short',
    'string', 'time', 'token', 'unsignedByte', 'unsignedInt', 'unsignedLong', 'unsignedShort'
];

const anyTypeDefinition: ComplexTypeDefinition = {
    kind: 'complex',
    name: 'anyType',
    namespace: XSD_NAMESPACE,
    documentation: undefined,
    mixed: true,
    simpleContent: false,
    baseTypeName: undefined,
    derivation: undefined,
    contentType: undefined,
    particle: {
        kind: 'any',
        min: 0,
        max: Number.POSITIVE_INFINITY,
        wildcard: { namespaces: '##any', targetNamespace: '' }
    },
    attributes: [],
    anyAttribute: { namespaces: '##any', targetNamespace: '' }
};

const builtInSimpleTypes = new Map<string, SimpleTypeDefinition>(builtInTypeNames
    .filter(name => name !== 'anyType')
    .map(name => [name, {
        kind: 'simple',
        name,
        namespace: XSD_NAMESPACE,
        documentation: undefined,
        variety: 'atomic',
        baseTypeName: undefined,
        baseType: undefined,
        enumerations: name === 'boolean'
            ? [{ value: 'true', documentation: undefined }, { value: 'false', documentation: undefined }]
            : [],
        memberTypeNames: [],
        memberTypes: [],
        itemTypeName: undefined,
        itemType: undefined
    }]));

// ------------------------------------------------------------------------------------------------
// A set of schema documents
// ------------------------------------------------------------------------------------------------

export interface ResolvedAttribute {
    readonly declaration: AttributeDeclaration;
    readonly use: AttributeUseKind;
    readonly defaultValue: string | undefined;
    readonly fixedValue: string | undefined;
    readonly documentation: string | undefined;
}

export interface ResolvedAttributes {
    readonly attributes: Map<ComponentKey, ResolvedAttribute>;
    readonly anyAttribute: Wildcard | undefined;
    /** False when a referenced type, attribute, or group could not be found. */
    readonly complete: boolean;
}

export interface ResolvedChild {
    readonly declaration: ElementDeclaration;
    /** True when the element must appear: every enclosing particle is required and none is a choice. */
    readonly required: boolean;
    readonly maxOccurs: number;
    /** Document order of the first particle that introduced the element. */
    readonly order: number;
}

export interface ResolvedChildren {
    readonly elements: Map<ComponentKey, ResolvedChild>;
    readonly wildcards: readonly Wildcard[];
    readonly complete: boolean;
}

export function wildcardAllows(wildcard: Wildcard, namespace: string): boolean {
    const constraint = wildcard.namespaces.trim();
    if (constraint === '##any') {
        return true;
    }
    if (constraint === '##other') {
        return namespace !== wildcard.targetNamespace && namespace !== '';
    }

    return constraint.split(/\s+/).some(token => {
        if (token === '##targetNamespace') {
            return namespace === wildcard.targetNamespace;
        }
        if (token === '##local') {
            return namespace === '';
        }

        return token === namespace;
    });
}

export class SchemaSet {
    public readonly documents: SchemaDocument[] = [];
    public readonly problems: SchemaProblem[] = [];
    private readonly elements = new Map<ComponentKey, ElementDeclaration>();
    private readonly attributes = new Map<ComponentKey, AttributeDeclaration>();
    private readonly types = new Map<ComponentKey, TypeDefinition>();
    private readonly groups = new Map<ComponentKey, Particle>();
    private readonly attributeGroups = new Map<ComponentKey, AttributeGroupDefinition>();
    private readonly substitutions = new Map<ComponentKey, ElementDeclaration[]>();
    private readonly namespaces = new Set<string>();

    public add(document: SchemaDocument): void {
        this.documents.push(document);
        this.problems.push(...document.problems);
        this.namespaces.add(document.targetNamespace);
        copyInto(document.elements, this.elements);
        copyInto(document.attributes, this.attributes);
        copyInto(document.types, this.types);
        copyInto(document.groups, this.groups);
        copyInto(document.attributeGroups, this.attributeGroups);
        for (const declaration of document.elements.values()) {
            if (declaration.substitutionGroup !== undefined) {
                const members = this.substitutions.get(declaration.substitutionGroup) ?? [];
                members.push(declaration);
                this.substitutions.set(declaration.substitutionGroup, members);
            }
        }
    }

    /** True when some schema in the set targets `namespace` ('' for no-namespace schemas). */
    public governs(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    public get targetNamespaces(): string[] {
        return [...this.namespaces];
    }

    public element(namespace: string, localName: string): ElementDeclaration | undefined {
        return this.elements.get(componentKey(namespace, localName));
    }

    public globalElements(): ElementDeclaration[] {
        return [...this.elements.values()];
    }

    public globalAttributes(): AttributeDeclaration[] {
        return [...this.attributes.values()];
    }

    public resolveType(key: ComponentKey | undefined): TypeDefinition | undefined {
        if (key === undefined) {
            return undefined;
        }

        // Declared types win so that a schema describing the XSD vocabulary itself can define types in
        // the XSD namespace alongside the built-ins.
        const declared = this.types.get(key);
        if (declared !== undefined) {
            return declared;
        }

        const { namespace, localName } = splitComponentKey(key);
        if (namespace === XSD_NAMESPACE) {
            return localName === 'anyType' ? anyTypeDefinition : builtInSimpleTypes.get(localName);
        }

        return undefined;
    }

    /** The type of an element: its inline type, its named type, its head's type, or xs:anyType. */
    public typeOf(declaration: ElementDeclaration, seen = new Set<ElementDeclaration>()): TypeDefinition | undefined {
        if (declaration.type !== undefined) {
            return declaration.type;
        }
        if (declaration.typeName !== undefined) {
            return this.resolveType(declaration.typeName);
        }
        if (declaration.substitutionGroup !== undefined && !seen.has(declaration)) {
            seen.add(declaration);
            const head = this.elements.get(declaration.substitutionGroup);
            return head === undefined ? undefined : this.typeOf(head, seen);
        }

        return anyTypeDefinition;
    }

    public attributesOf(type: TypeDefinition | undefined): ResolvedAttributes {
        const attributes = new Map<ComponentKey, ResolvedAttribute>();
        let anyAttribute: Wildcard | undefined;
        let complete = type !== undefined;
        const seenTypes = new Set<TypeDefinition>();

        const addEntries = (entries: readonly AttributeEntry[], seenGroups: Set<ComponentKey>): void => {
            for (const entry of entries) {
                if (entry.kind === 'attributeGroup') {
                    const group = this.attributeGroups.get(entry.ref);
                    if (group === undefined) {
                        complete = false;
                        continue;
                    }
                    if (seenGroups.has(entry.ref)) {
                        continue;
                    }

                    seenGroups.add(entry.ref);
                    addEntries(group.attributes, seenGroups);
                    anyAttribute = anyAttribute ?? group.anyAttribute;
                    continue;
                }

                const declaration = entry.declaration ?? (entry.ref === undefined ? undefined : this.attributes.get(entry.ref));
                if (declaration === undefined) {
                    complete = false;
                    continue;
                }

                const key = componentKey(declaration.namespace, declaration.name);
                if (entry.use === 'prohibited') {
                    attributes.delete(key);
                }
                else {
                    attributes.set(key, {
                        declaration,
                        use: entry.use,
                        defaultValue: entry.defaultValue,
                        fixedValue: entry.fixedValue,
                        documentation: entry.documentation ?? declaration.documentation
                    });
                }
            }
        };

        // Attribute uses are inherited through both extension and restriction; the attribute wildcard
        // only through extension, since a restriction must restate the wildcard it keeps.
        const visit = (current: TypeDefinition): void => {
            if (current.kind !== 'complex' || seenTypes.has(current)) {
                return;
            }

            seenTypes.add(current);
            if (current.baseTypeName !== undefined) {
                const base = this.resolveType(current.baseTypeName);
                if (base === undefined) {
                    complete = false;
                }
                else if (base !== anyTypeDefinition) {
                    visit(base);
                }
            }

            if (current.derivation !== 'extension') {
                anyAttribute = undefined;
            }

            addEntries(current.attributes, new Set());
            anyAttribute = current.anyAttribute ?? anyAttribute;
        };

        if (type !== undefined) {
            if (type === anyTypeDefinition) {
                anyAttribute = anyTypeDefinition.anyAttribute;
            }
            else {
                visit(type);
            }
        }

        return { attributes, anyAttribute, complete };
    }

    public childrenOf(type: TypeDefinition | undefined): ResolvedChildren {
        const elements = new Map<ComponentKey, ResolvedChild>();
        const wildcards: Wildcard[] = [];
        let complete = type !== undefined;
        let order = 0;

        const addDeclaration = (declaration: ElementDeclaration, required: boolean, maxOccurs: number, seen: Set<ElementDeclaration>): void => {
            if (seen.has(declaration)) {
                return;
            }

            seen.add(declaration);
            const key = componentKey(declaration.namespace, declaration.name);
            if (!declaration.abstract) {
                const existing = elements.get(key);
                elements.set(key, existing === undefined
                    ? { declaration, required, maxOccurs, order: order++ }
                    : { ...existing, required: existing.required || required, maxOccurs: existing.maxOccurs + maxOccurs });
            }

            for (const member of this.substitutions.get(key) ?? []) {
                // A substitute can stand in for the head, but never makes the head's slot mandatory for itself.
                addDeclaration(member, false, maxOccurs, seen);
            }
        };

        const walk = (particle: Particle, required: boolean, maxOccurs: number, seenGroups: Set<ComponentKey>): void => {
            const effectiveRequired = required && particle.min > 0;
            const effectiveMax = maxOccurs * particle.max;
            switch (particle.kind) {
                case 'element': {
                    const declaration = particle.declaration
                        ?? (particle.ref === undefined ? undefined : this.elements.get(particle.ref));
                    if (declaration === undefined) {
                        complete = false;
                        return;
                    }
                    addDeclaration(declaration, effectiveRequired, effectiveMax, new Set());
                    return;
                }
                case 'sequence':
                case 'all':
                    for (const child of particle.particles) {
                        walk(child, effectiveRequired, effectiveMax, seenGroups);
                    }
                    return;
                case 'choice':
                    for (const child of particle.particles) {
                        walk(child, effectiveRequired && particle.particles.length === 1, effectiveMax, seenGroups);
                    }
                    return;
                case 'group': {
                    const group = this.groups.get(particle.ref);
                    if (group === undefined) {
                        complete = false;
                        return;
                    }
                    if (seenGroups.has(particle.ref)) {
                        return;
                    }
                    walk(group, effectiveRequired, effectiveMax, new Set([...seenGroups, particle.ref]));
                    return;
                }
                case 'any':
                    wildcards.push(particle.wildcard);
                    return;
            }
        };

        const visit = (current: TypeDefinition, seenTypes: Set<TypeDefinition>): void => {
            if (current.kind !== 'complex' || current.simpleContent || seenTypes.has(current)) {
                return;
            }

            seenTypes.add(current);
            if (current.baseTypeName !== undefined && current.derivation === 'extension') {
                const base = this.resolveType(current.baseTypeName);
                if (base === undefined) {
                    complete = false;
                }
                else {
                    visit(base, seenTypes);
                }
            }

            if (current.particle !== undefined) {
                walk(current.particle, true, 1, new Set());
            }
        };

        if (type !== undefined) {
            visit(type, new Set());
        }

        return { elements, wildcards, complete };
    }

    /** The simple type governing an element's or attribute's character data, if any. */
    public simpleTypeOf(type: TypeDefinition | undefined, seen = new Set<TypeDefinition>()): SimpleTypeDefinition | undefined {
        if (type === undefined || seen.has(type)) {
            return undefined;
        }

        seen.add(type);
        if (type.kind === 'simple') {
            return type;
        }
        if (!type.simpleContent) {
            return undefined;
        }

        return type.contentType ?? this.simpleTypeOf(this.resolveType(type.baseTypeName), seen);
    }

    public attributeType(attribute: AttributeDeclaration): SimpleTypeDefinition | undefined {
        if (attribute.type !== undefined) {
            return attribute.type;
        }

        const resolved = this.resolveType(attribute.typeName);
        return resolved?.kind === 'simple' ? resolved : undefined;
    }

    /** Every enumerated value a simple type admits, following restriction, union, and list. */
    public enumerations(type: SimpleTypeDefinition | undefined, seen = new Set<SimpleTypeDefinition>()): Enumeration[] {
        if (type === undefined || seen.has(type)) {
            return [];
        }

        seen.add(type);
        switch (type.variety) {
            case 'union': {
                const members = [
                    ...type.memberTypes,
                    ...type.memberTypeNames.map(name => this.resolveType(name)).filter((member): member is SimpleTypeDefinition => member?.kind === 'simple')
                ];
                return members.flatMap(member => this.enumerations(member, seen));
            }
            case 'list': {
                const item = type.itemType ?? this.resolveType(type.itemTypeName);
                return item?.kind === 'simple' ? this.enumerations(item, seen) : [];
            }
            default: {
                if (type.enumerations.length > 0) {
                    return [...type.enumerations];
                }

                const base = type.baseType ?? this.resolveType(type.baseTypeName);
                return base?.kind === 'simple' ? this.enumerations(base, seen) : [];
            }
        }
    }

    /**
     * True when the enumerations of `type` are a closed set the value must come from. Unions with a
     * non-enumerated member (for example `xs:string`) accept anything.
     */
    public isClosedEnumeration(type: SimpleTypeDefinition | undefined, seen = new Set<SimpleTypeDefinition>()): boolean {
        if (type === undefined || seen.has(type)) {
            return false;
        }

        seen.add(type);
        switch (type.variety) {
            case 'union': {
                const members = [
                    ...type.memberTypes,
                    ...type.memberTypeNames.map(name => this.resolveType(name))
                ];
                return members.length > 0 && members.every(member => member?.kind === 'simple' && this.isClosedEnumeration(member, seen));
            }
            case 'list':
                return false;
            default: {
                if (type.enumerations.length > 0) {
                    return true;
                }

                const base = type.baseType ?? this.resolveType(type.baseTypeName);
                return base?.kind === 'simple' && this.isClosedEnumeration(base, seen);
            }
        }
    }
}

function copyInto<TValue>(source: Map<ComponentKey, TValue>, target: Map<ComponentKey, TValue>): void {
    for (const [key, value] of source) {
        if (!target.has(key)) {
            target.set(key, value);
        }
    }
}

export function typeDisplayName(type: TypeDefinition | undefined): string | undefined {
    if (type === undefined) {
        return undefined;
    }
    if (type.name !== undefined) {
        return type.name;
    }
    if (type.kind === 'simple') {
        return type.baseTypeName === undefined ? undefined : `${splitComponentKey(type.baseTypeName).localName} (restricted)`;
    }

    return type.baseTypeName === undefined ? undefined : `${splitComponentKey(type.baseTypeName).localName} (${type.derivation ?? 'derived'})`;
}

// ------------------------------------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------------------------------------

/** Reads the text of a schema by absolute URI. Rejects when the schema cannot be read. */
export type SchemaFetcher = (uri: string) => Promise<string>;

/**
 * Loads schema documents and everything they include or import, caching each document by URI and
 * the namespace it was read under.
 */
export class SchemaLoader {
    private readonly texts = new Map<string, Promise<string>>();
    private readonly documents = new Map<string, SchemaDocument>();
    private readonly sets = new Map<string, Promise<SchemaSet>>();

    public constructor(private readonly fetcher: SchemaFetcher) {
    }

    public clear(): void {
        this.texts.clear();
        this.documents.clear();
        this.sets.clear();
    }

    public load(uris: readonly string[]): Promise<SchemaSet> {
        const key = [...new Set(uris)].sort().join('\n');
        let set = this.sets.get(key);
        if (set === undefined) {
            set = this.loadUncached([...new Set(uris)].sort());
            this.sets.set(key, set);
        }

        return set;
    }

    private async loadUncached(uris: readonly string[]): Promise<SchemaSet> {
        const set = new SchemaSet();
        const visited = new Set<string>();
        const queue: { uri: string; includingNamespace: string | undefined }[] = uris.map(uri => ({ uri, includingNamespace: undefined }));

        while (queue.length > 0) {
            const { uri, includingNamespace } = queue.shift()!;
            const visitKey = `${uri}#${includingNamespace ?? ''}`;
            if (visited.has(visitKey)) {
                continue;
            }

            visited.add(visitKey);
            let document = this.documents.get(visitKey);
            if (document === undefined) {
                let text: string;
                try {
                    text = await this.text(uri);
                }
                catch (error) {
                    set.problems.push({ uri, message: `Could not load schema: ${error instanceof Error ? error.message : String(error)}` });
                    continue;
                }

                document = readSchemaDocument(text, uri, includingNamespace);
                this.documents.set(visitKey, document);
            }

            set.add(document);
            for (const reference of document.references) {
                const resolved = resolveUri(reference.location, uri);
                if (resolved === undefined) {
                    set.problems.push({ uri, message: `Could not resolve schema location '${reference.location}'.` });
                    continue;
                }

                queue.push({
                    uri: resolved,
                    includingNamespace: reference.kind === 'include' ? document.targetNamespace : undefined
                });
            }
        }

        return set;
    }

    private text(uri: string): Promise<string> {
        let text = this.texts.get(uri);
        if (text === undefined) {
            text = this.fetcher(uri);
            this.texts.set(uri, text);
            // A failed read must not stay cached: the file may be created or the network may return.
            text.catch(() => this.texts.delete(uri));
        }

        return text;
    }
}

/** Resolves a schema location against the URI of the document that referenced it. */
export function resolveUri(location: string, base: string): string | undefined {
    try {
        return new URL(location, base).toString();
    }
    catch {
        return undefined;
    }
}
