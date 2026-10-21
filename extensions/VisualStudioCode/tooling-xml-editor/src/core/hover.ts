/**
 * Hover documentation for element names, attribute names, and enumerated attribute values.
 */

import { DocumentModel } from './model';
import { XmlDocument, XmlElement, XmlNode } from './parser';
import { SchemaSet, typeDisplayName } from './schema';

export interface HoverResult {
    /** Markdown. */
    readonly contents: string;
    readonly start: number;
    readonly end: number;
}

export function getHover(document: XmlDocument, offset: number, schemas: SchemaSet | undefined): HoverResult | undefined {
    if (schemas === undefined) {
        return undefined;
    }

    const element = findElementAt(document.children, offset);
    if (element === undefined) {
        return undefined;
    }

    const model = new DocumentModel(document, schemas);
    const endTagNameStart = element.endTagStart === undefined ? undefined : element.endTagStart + 2;
    const onStartName = offset >= element.nameStart && offset <= element.nameEnd;
    const onEndName = endTagNameStart !== undefined && offset >= endTagNameStart && offset <= endTagNameStart + element.name.length;
    if (onStartName || onEndName) {
        const declaration = model.declarationOf(element);
        if (declaration === undefined) {
            return undefined;
        }

        const start = onStartName ? element.nameStart : endTagNameStart!;
        return {
            contents: describe(element.name, typeDisplayName(model.typeOf(element)), declaration.documentation),
            start,
            end: start + element.name.length
        };
    }

    for (const attribute of element.attributes) {
        const onName = offset >= attribute.nameStart && offset <= attribute.nameEnd;
        const onValue = attribute.valueStart !== undefined && attribute.valueEnd !== undefined
            && offset > attribute.valueStart && offset < attribute.valueEnd;
        if (!onName && !onValue) {
            continue;
        }

        const resolved = model.attributeDeclaration(element, attribute.name);
        if (resolved === undefined) {
            return undefined;
        }

        const type = schemas.attributeType(resolved.declaration);
        if (onValue && attribute.value !== undefined) {
            const enumeration = schemas.enumerations(type).find(candidate => candidate.value === attribute.value);
            if (enumeration?.documentation === undefined) {
                return undefined;
            }

            return { contents: enumeration.documentation, start: attribute.valueStart! + 1, end: attribute.valueEnd! - 1 };
        }

        const details = [
            resolved.use === 'required' ? '**Required.**' : undefined,
            resolved.defaultValue === undefined ? undefined : `Default: \`${resolved.defaultValue}\``,
            resolved.fixedValue === undefined ? undefined : `Fixed: \`${resolved.fixedValue}\``,
            resolved.documentation
        ].filter((part): part is string => part !== undefined);
        const values = schemas.enumerations(type).map(enumeration => `\`${enumeration.value}\``);
        if (values.length > 0 && values.length <= 30) {
            details.push(`Values: ${values.join(', ')}`);
        }

        return {
            contents: describe(attribute.name, typeDisplayName(type), details.length === 0 ? undefined : details.join('\n\n')),
            start: attribute.nameStart,
            end: attribute.nameEnd
        };
    }

    return undefined;
}

function describe(name: string, typeName: string | undefined, documentation: string | undefined): string {
    const heading = typeName === undefined ? `\`${name}\`` : `\`${name}\` : \`${typeName}\``;
    return documentation === undefined ? heading : `${heading}\n\n${documentation}`;
}

/** The deepest element whose start tag or end tag contains `offset`. */
function findElementAt(nodes: readonly XmlNode[], offset: number): XmlElement | undefined {
    for (const node of nodes) {
        if (node.kind !== 'element' || offset < node.start || offset > node.end) {
            continue;
        }

        const nested = findElementAt(node.children, offset);
        if (nested !== undefined) {
            return nested;
        }

        const inStartTag = offset <= (node.startTagEnd ?? node.end);
        const inEndTag = node.endTagStart !== undefined && offset >= node.endTagStart;
        if (inStartTag || inEndTag) {
            return node;
        }
    }

    return undefined;
}
