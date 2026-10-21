/**
 * Schema-driven completion with a schema-less fallback.
 *
 * With a schema, suggestions come from the content model of the enclosing element. Without one,
 * the document itself is the vocabulary: element names, attribute names, and attribute values that
 * already appear are offered again, so completion is never empty in a well-populated file.
 */

import { CursorContext, getCursorContext } from './context';
import { DocumentModel } from './model';
import {
    XSI_NAMESPACE,
    XmlDocument,
    XmlElement,
    childElements,
    elementNamespace,
    forEachElement,
    prefixForNamespace,
    splitQualifiedName
} from './parser';
import {
    ComponentKey,
    ElementDeclaration,
    Enumeration,
    SchemaSet,
    TypeDefinition,
    XSD_NAMESPACE,
    builtInTypeNames,
    readSchemaDocument,
    splitComponentKey,
    typeDisplayName,
    wildcardAllows
} from './schema';

export type CompletionKind = 'element' | 'attribute' | 'value' | 'endTag' | 'namespace' | 'snippet' | 'type';

export interface CompletionSuggestion {
    readonly label: string;
    readonly kind: CompletionKind;
    readonly insertText: string;
    /** When true, `insertText` uses snippet syntax (`$1`, `$0`). */
    readonly isSnippet: boolean;
    readonly replaceStart: number;
    readonly replaceEnd: number;
    readonly detail?: string | undefined;
    readonly documentation?: string | undefined;
    readonly sortText?: string | undefined;
    readonly filterText?: string | undefined;
    /** Re-open completion after inserting, for example to pick an attribute value. */
    readonly retrigger?: boolean | undefined;
}

export interface CompletionOptions {
    /** Namespace URIs offered for `xmlns` values, typically from the registered schema settings. */
    readonly knownNamespaces?: readonly string[];
}

export function getCompletions(
    document: XmlDocument,
    offset: number,
    schemas: SchemaSet | undefined,
    options: CompletionOptions = {}): CompletionSuggestion[] {
    const context = getCursorContext(document, offset);
    const model = schemas === undefined ? undefined : new DocumentModel(document, schemas);
    switch (context.kind) {
        case 'elementName':
            return elementNameCompletions(document, context, model);
        case 'endTag':
            return context.element === undefined || context.element.name.length === 0
                ? []
                : [{
                    label: `/${context.element.name}`,
                    kind: 'endTag',
                    insertText: context.element.name + (context.hasClosingBracket ? '' : '>'),
                    isSnippet: false,
                    replaceStart: context.replaceStart,
                    replaceEnd: context.replaceEnd,
                    filterText: context.element.name,
                    sortText: '0'
                }];
        case 'attributeName':
            return attributeNameCompletions(document, context, model);
        case 'attributeValue':
            return attributeValueCompletions(document, offset, context, model, options);
        case 'content':
            return contentCompletions(context, model);
        default:
            return [];
    }
}

// ------------------------------------------------------------------------------------------------
// Element names
// ------------------------------------------------------------------------------------------------

type ElementNameContext = Extract<CursorContext, { kind: 'elementName' }>;

interface ElementCandidate {
    readonly declaration: ElementDeclaration;
    readonly required: boolean;
    readonly order: number;
    readonly fromWildcard: boolean;
}

function elementNameCompletions(document: XmlDocument, context: ElementNameContext, model: DocumentModel | undefined): CompletionSuggestion[] {
    const suggestions: CompletionSuggestion[] = [];
    const parent = context.parent;
    const candidates = model === undefined ? undefined : elementCandidates(model, context.element, parent);

    if (candidates !== undefined && candidates.length > 0) {
        for (const candidate of candidates) {
            const suggestion = elementSuggestion(model!, context, candidate);
            if (suggestion !== undefined) {
                suggestions.push(suggestion);
            }
        }
    }
    else if (candidates === undefined) {
        const seen = new Set<string>();
        forEachElement(document.children, element => {
            if (element !== context.element && element.name.length > 0 && !seen.has(element.name)) {
                seen.add(element.name);
                suggestions.push({
                    label: element.name,
                    kind: 'element',
                    insertText: context.bareTag ? `${element.name}$1>$0</${element.name}>` : element.name,
                    isSnippet: context.bareTag,
                    replaceStart: context.replaceStart,
                    replaceEnd: context.replaceEnd,
                    detail: 'Used in this document',
                    sortText: `1${element.name}`
                });
            }
        });
    }

    if (parent !== undefined && parent.endTagStart === undefined && parent.name.length > 0) {
        suggestions.push({
            label: `/${parent.name}`,
            kind: 'endTag',
            insertText: `/${parent.name}>`,
            isSnippet: false,
            replaceStart: context.replaceStart,
            replaceEnd: context.replaceEnd,
            filterText: `/${parent.name}`,
            sortText: '3'
        });
    }

    if (context.bareTag && parent !== undefined) {
        suggestions.push(
            {
                label: '!--',
                kind: 'snippet',
                insertText: '!-- $0 -->',
                isSnippet: true,
                replaceStart: context.replaceStart,
                replaceEnd: context.replaceEnd,
                detail: 'Comment',
                sortText: '4a'
            },
            {
                label: '![CDATA[',
                kind: 'snippet',
                insertText: '![CDATA[$0]]>',
                isSnippet: true,
                replaceStart: context.replaceStart,
                replaceEnd: context.replaceEnd,
                detail: 'CDATA section',
                sortText: '4b'
            });
    }

    return suggestions;
}

/**
 * The declarations that may appear at `element`, or undefined when the schema has nothing to say
 * about the position (so the caller falls back to the document's own vocabulary).
 */
function elementCandidates(model: DocumentModel, element: XmlElement, parent: XmlElement | undefined): ElementCandidate[] | undefined {
    const schemas = model.schemas;
    if (parent === undefined) {
        const roots = schemas.globalElements().filter(declaration => !declaration.abstract);
        return roots.length === 0
            ? undefined
            : roots.map((declaration, order) => ({ declaration, required: false, order, fromWildcard: false }));
    }

    const children = model.childrenOf(parent);
    if (children === undefined) {
        return undefined;
    }

    const counts = new Map<ComponentKey, number>();
    for (const sibling of childElements(parent)) {
        if (sibling === element) {
            continue;
        }

        const namespace = elementNamespace(sibling);
        if (namespace !== undefined) {
            const key = `{${namespace}}${splitQualifiedName(sibling.name).localName}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }

    const candidates: ElementCandidate[] = [];
    for (const [key, child] of children.elements) {
        if ((counts.get(key) ?? 0) < child.maxOccurs) {
            candidates.push({ declaration: child.declaration, required: child.required && !counts.has(key), order: child.order, fromWildcard: false });
        }
    }

    if (children.wildcards.length > 0) {
        let order = candidates.length;
        for (const declaration of schemas.globalElements()) {
            if (!declaration.abstract
                && !children.elements.has(`{${declaration.namespace}}${declaration.name}`)
                && children.wildcards.some(wildcard => wildcardAllows(wildcard, declaration.namespace))) {
                candidates.push({ declaration, required: false, order: order++, fromWildcard: true });
            }
        }
    }

    return candidates;
}

function elementSuggestion(model: DocumentModel, context: ElementNameContext, candidate: ElementCandidate): CompletionSuggestion | undefined {
    const { declaration } = candidate;
    const prefix = prefixForNamespace(context.element, declaration.namespace);
    const name = prefix ? `${prefix}:${declaration.name}` : declaration.name;
    const namespaceDeclaration = prefix === undefined ? ` xmlns="${escapeSnippet(declaration.namespace)}"` : '';
    const type = model.schemas.typeOf(declaration);

    let insertText = name;
    if (context.bareTag) {
        const required = [...model.schemas.attributesOf(type).attributes.values()]
            .filter(attribute => attribute.use === 'required' && attribute.declaration.namespace === '');
        let tabStop = 1;
        const attributes = required
            .map(attribute => ` ${attribute.declaration.name}="\${${tabStop++}${attribute.fixedValue === undefined ? '' : `:${escapeSnippet(attribute.fixedValue)}`}}"`)
            .join('');
        insertText = isEmptyContent(model.schemas, type)
            ? `${name}${namespaceDeclaration}${attributes}$${tabStop} />`
            : `${name}${namespaceDeclaration}${attributes}$${tabStop}>$0</${name}>`;
    }

    const typeName = typeDisplayName(type);
    return {
        label: name,
        kind: 'element',
        insertText,
        isSnippet: context.bareTag,
        replaceStart: context.replaceStart,
        replaceEnd: context.replaceEnd,
        detail: [candidate.required ? 'required' : undefined, typeName, declaration.namespace || undefined]
            .filter(part => part !== undefined)
            .join(' · ') || undefined,
        ...(declaration.documentation === undefined ? {} : { documentation: declaration.documentation }),
        sortText: `${candidate.fromWildcard ? '2' : candidate.required ? '0' : '1'}${String(candidate.order).padStart(5, '0')}`,
        filterText: name
    };
}

function isEmptyContent(schemas: SchemaSet, type: TypeDefinition | undefined): boolean {
    if (type === undefined || type.kind === 'simple' || type.mixed || type.simpleContent) {
        return false;
    }

    const children = schemas.childrenOf(type);
    return children.complete && children.elements.size === 0 && children.wildcards.length === 0;
}

// ------------------------------------------------------------------------------------------------
// Attribute names
// ------------------------------------------------------------------------------------------------

type AttributeNameContext = Extract<CursorContext, { kind: 'attributeName' }>;

function attributeNameCompletions(document: XmlDocument, context: AttributeNameContext, model: DocumentModel | undefined): CompletionSuggestion[] {
    const element = context.element;
    const present = new Set(element.attributes.filter(attribute => attribute !== context.attribute).map(attribute => attribute.name));
    const valueAlreadyTyped = context.attribute?.hasEquals === true;
    const suggestions: CompletionSuggestion[] = [];
    const seen = new Set<string>();

    const add = (name: string, detail: string | undefined, documentation: string | undefined, sortText: string, hasValues: boolean, value?: string): void => {
        if (present.has(name) || seen.has(name)) {
            return;
        }

        seen.add(name);
        suggestions.push({
            label: name,
            kind: 'attribute',
            insertText: valueAlreadyTyped
                ? name
                : value === undefined ? `${name}="$1"` : `${name}="${escapeSnippet(value)}"$0`,
            isSnippet: !valueAlreadyTyped,
            replaceStart: context.replaceStart,
            replaceEnd: context.replaceEnd,
            ...(detail === undefined ? {} : { detail }),
            ...(documentation === undefined ? {} : { documentation }),
            sortText,
            retrigger: !valueAlreadyTyped && value === undefined && hasValues
        });
    };

    const resolved = model?.attributesOf(element);
    if (model !== undefined && resolved !== undefined && model.declarationOf(element) !== undefined) {
        for (const attribute of resolved.attributes.values()) {
            const { declaration } = attribute;
            const prefix = declaration.namespace === '' ? '' : prefixForNamespace(element, declaration.namespace);
            if (prefix === undefined) {
                continue;
            }

            const name = prefix ? `${prefix}:${declaration.name}` : declaration.name;
            const type = model.schemas.attributeType(declaration);
            add(
                name,
                [attribute.use === 'required' ? 'required' : undefined, typeDisplayName(type)].filter(part => part !== undefined).join(' · ') || undefined,
                attribute.documentation,
                `${attribute.use === 'required' ? '0' : '1'}${name}`,
                model.schemas.enumerations(type).length > 0);
        }

        if (resolved.anyAttribute !== undefined) {
            for (const declaration of model.schemas.globalAttributes()) {
                if (!wildcardAllows(resolved.anyAttribute, declaration.namespace)) {
                    continue;
                }

                const prefix = declaration.namespace === '' ? '' : prefixForNamespace(element, declaration.namespace);
                if (prefix !== undefined) {
                    const name = prefix ? `${prefix}:${declaration.name}` : declaration.name;
                    add(name, declaration.namespace || undefined, declaration.documentation, `2${name}`,
                        model.schemas.enumerations(model.schemas.attributeType(declaration)).length > 0);
                }
            }
        }
    }
    else {
        forEachElement(document.children, other => {
            if (other !== element && other.name === element.name) {
                for (const attribute of other.attributes) {
                    if (!attribute.name.startsWith('xmlns')) {
                        add(attribute.name, 'Used in this document', undefined, `1${attribute.name}`, true);
                    }
                }
            }
        });
    }

    if (!element.attributes.some(attribute => attribute.name === 'xmlns')) {
        add('xmlns', 'Default namespace declaration', undefined, `5xmlns`, true);
    }

    const xsiPrefix = prefixForNamespace(element, XSI_NAMESPACE);
    if (xsiPrefix === undefined) {
        add('xmlns:xsi', 'XML Schema instance namespace', 'Enables `xsi:schemaLocation`, `xsi:noNamespaceSchemaLocation`, `xsi:type`, and `xsi:nil`.', '6xmlns:xsi', false, XSI_NAMESPACE);
    }
    else if (xsiPrefix !== '') {
        if (element.parent === undefined) {
            add(`${xsiPrefix}:schemaLocation`, 'Namespace and schema location pairs', 'Space-separated pairs of a namespace URI and the location of its schema.', `6${xsiPrefix}:schemaLocation`, false);
            add(`${xsiPrefix}:noNamespaceSchemaLocation`, 'Schema location for elements without a namespace', undefined, `6${xsiPrefix}:noNamespaceSchemaLocation`, false);
        }
        add(`${xsiPrefix}:type`, 'Overrides the declared type', undefined, `7${xsiPrefix}:type`, false);
        add(`${xsiPrefix}:nil`, 'Marks the element as nil', undefined, `7${xsiPrefix}:nil`, true);
    }

    return suggestions;
}

// ------------------------------------------------------------------------------------------------
// Attribute values
// ------------------------------------------------------------------------------------------------

type AttributeValueContext = Extract<CursorContext, { kind: 'attributeValue' }>;

function attributeValueCompletions(
    document: XmlDocument,
    offset: number,
    context: AttributeValueContext,
    model: DocumentModel | undefined,
    options: CompletionOptions): CompletionSuggestion[] {
    const { element, attribute } = context;
    const values: { value: string; detail?: string; documentation?: string; kind?: CompletionKind }[] = [];
    let replaceStart = context.replaceStart;
    let replaceEnd = context.replaceEnd;

    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
        const namespaces = new Set<string>([...(options.knownNamespaces ?? []), ...(model?.schemas.targetNamespaces ?? [])]);
        if (attribute.name === 'xmlns:xsi') {
            namespaces.add(XSI_NAMESPACE);
        }
        if (attribute.name === 'xmlns:xs' || attribute.name === 'xmlns:xsd') {
            namespaces.add(XSD_NAMESPACE);
        }
        for (const namespace of namespaces) {
            if (namespace.length > 0) {
                values.push({ value: namespace, kind: 'namespace' });
            }
        }
    }
    else if (splitQualifiedName(attribute.name).localName === 'nil' && splitQualifiedName(attribute.name).prefix === prefixForNamespace(element, XSI_NAMESPACE)) {
        values.push({ value: 'true' }, { value: 'false' });
    }
    else if (elementNamespace(element) === XSD_NAMESPACE && isSchemaReferenceAttribute(element, attribute.name)) {
        const token = tokenRangeAt(document.text, offset, context.replaceStart, context.replaceEnd);
        if (attribute.name === 'memberTypes') {
            replaceStart = token.start;
            replaceEnd = token.end;
        }
        values.push(...schemaReferenceValues(document, element, attribute.name));
    }
    else if (model !== undefined) {
        const declaration = model.attributeDeclaration(element, attribute.name);
        if (declaration !== undefined) {
            const type = model.schemas.attributeType(declaration.declaration);
            if (declaration.fixedValue !== undefined) {
                values.push({ value: declaration.fixedValue, detail: 'fixed' });
            }
            else {
                values.push(...enumerationValues(model.schemas.enumerations(type), declaration.defaultValue));
            }
        }
    }

    if (values.length === 0) {
        const seen = new Set<string>();
        forEachElement(document.children, other => {
            for (const candidate of other.attributes) {
                if (candidate !== attribute
                    && candidate.name === attribute.name
                    && other.name === element.name
                    && candidate.value !== undefined
                    && candidate.value.length > 0
                    && candidate.value.length <= 200
                    && !seen.has(candidate.value)) {
                    seen.add(candidate.value);
                    values.push({ value: candidate.value, detail: 'Used in this document' });
                }
            }
        });
    }

    return values.map((value, index) => ({
        label: value.value,
        kind: value.kind ?? 'value',
        insertText: context.quoted ? value.value : `"${value.value}"`,
        isSnippet: false,
        replaceStart,
        replaceEnd,
        ...(value.detail === undefined ? {} : { detail: value.detail }),
        ...(value.documentation === undefined ? {} : { documentation: value.documentation }),
        sortText: String(index).padStart(5, '0')
    }));
}

function enumerationValues(enumerations: readonly Enumeration[], defaultValue: string | undefined): { value: string; detail?: string; documentation?: string }[] {
    const seen = new Set<string>();
    const values: { value: string; detail?: string; documentation?: string }[] = [];
    for (const enumeration of enumerations) {
        if (seen.has(enumeration.value)) {
            continue;
        }

        seen.add(enumeration.value);
        values.push({
            value: enumeration.value,
            ...(enumeration.value === defaultValue ? { detail: 'default' } : {}),
            ...(enumeration.documentation === undefined ? {} : { documentation: enumeration.documentation })
        });
    }

    return values;
}

function tokenRangeAt(text: string, offset: number, start: number, end: number): { start: number; end: number } {
    let tokenStart = offset;
    while (tokenStart > start && !/\s/.test(text[tokenStart - 1]!)) {
        tokenStart--;
    }

    let tokenEnd = offset;
    while (tokenEnd < end && !/\s/.test(text[tokenEnd]!)) {
        tokenEnd++;
    }

    return { start: tokenStart, end: tokenEnd };
}

// ------------------------------------------------------------------------------------------------
// Authoring XML Schema documents
// ------------------------------------------------------------------------------------------------

type SchemaReferenceKind = 'anyType' | 'simpleType' | 'element' | 'attribute' | 'group' | 'attributeGroup';

function schemaReferenceKind(element: XmlElement, attributeName: string): SchemaReferenceKind | undefined {
    const localName = splitQualifiedName(element.name).localName;
    switch (attributeName) {
        case 'type':
            return localName === 'element' ? 'anyType' : localName === 'attribute' ? 'simpleType' : undefined;
        case 'base':
            return localName === 'restriction' || localName === 'extension' ? 'anyType' : undefined;
        case 'itemType':
        case 'memberTypes':
            return 'simpleType';
        case 'substitutionGroup':
            return 'element';
        case 'ref':
            return localName === 'element' || localName === 'attribute' || localName === 'group' || localName === 'attributeGroup'
                ? localName
                : undefined;
        default:
            return undefined;
    }
}

function isSchemaReferenceAttribute(element: XmlElement, attributeName: string): boolean {
    return schemaReferenceKind(element, attributeName) !== undefined;
}

/** Built-in types plus the named components of the schema being edited, written with its prefixes. */
function schemaReferenceValues(document: XmlDocument, element: XmlElement, attributeName: string): { value: string; detail?: string; documentation?: string; kind?: CompletionKind }[] {
    const kind = schemaReferenceKind(element, attributeName)!;
    const schema = readSchemaDocument(document.text, 'untitled:current');
    const values: { value: string; detail?: string; documentation?: string; kind?: CompletionKind }[] = [];
    const qualify = (key: ComponentKey): string | undefined => {
        const { namespace, localName } = splitComponentKey(key);
        const prefix = prefixForNamespace(element, namespace);
        if (prefix === undefined) {
            return namespace === '' ? localName : undefined;
        }

        return prefix ? `${prefix}:${localName}` : localName;
    };
    const addAll = (keys: Iterable<ComponentKey>, detail: string, kindOf?: (key: ComponentKey) => boolean): void => {
        for (const key of keys) {
            if (kindOf !== undefined && !kindOf(key)) {
                continue;
            }

            const value = qualify(key);
            if (value !== undefined) {
                values.push({ value, detail, kind: 'type' });
            }
        }
    };

    switch (kind) {
        case 'anyType':
        case 'simpleType':
            addAll(schema.types.keys(), 'Type in this schema', key => kind === 'anyType' || schema.types.get(key)?.kind === 'simple');
            for (const name of builtInTypeNames) {
                if (kind === 'simpleType' && name === 'anyType') {
                    continue;
                }

                const value = qualify(`{${XSD_NAMESPACE}}${name}`);
                if (value !== undefined) {
                    values.push({ value, detail: 'Built-in type', kind: 'type' });
                }
            }
            break;
        case 'element':
            addAll(schema.elements.keys(), 'Global element');
            break;
        case 'attribute':
            addAll(schema.attributes.keys(), 'Global attribute');
            break;
        case 'group':
            addAll(schema.groups.keys(), 'Model group');
            break;
        case 'attributeGroup':
            addAll(schema.attributeGroups.keys(), 'Attribute group');
            break;
    }

    return values;
}

// ------------------------------------------------------------------------------------------------
// Element content
// ------------------------------------------------------------------------------------------------

type ContentContext = Extract<CursorContext, { kind: 'content' }>;

function contentCompletions(context: ContentContext, model: DocumentModel | undefined): CompletionSuggestion[] {
    const element = context.element;
    if (element === undefined || model === undefined || childElements(element).length > 0) {
        return [];
    }

    const declaration = model.declarationOf(element);
    const type = model.schemas.simpleTypeOf(model.typeOf(element));
    return enumerationValues(model.schemas.enumerations(type), declaration?.defaultValue).map((value, index) => ({
        label: value.value,
        kind: 'value' as const,
        insertText: value.value,
        isSnippet: false,
        replaceStart: context.replaceStart,
        replaceEnd: context.replaceEnd,
        ...(value.detail === undefined ? {} : { detail: value.detail }),
        ...(value.documentation === undefined ? {} : { documentation: value.documentation }),
        sortText: String(index).padStart(5, '0')
    }));
}

function escapeSnippet(value: string): string {
    return value.replace(/[\\$}]/g, character => `\\${character}`);
}
