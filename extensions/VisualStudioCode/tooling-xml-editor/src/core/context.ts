/**
 * Classifies a cursor offset: inside an element name, an end tag, an attribute name or value, or
 * element content. Completion and hover both start here.
 */

import {
    XmlAttribute,
    XmlDocument,
    XmlElement,
    XmlNode,
    isNameCharacter,
    isWhitespace
} from './parser';

export type CursorContext =
    | {
        readonly kind: 'elementName';
        readonly element: XmlElement;
        readonly parent: XmlElement | undefined;
        readonly replaceStart: number;
        readonly replaceEnd: number;
        /** True when nothing follows the name yet, so completion may write the whole element. */
        readonly bareTag: boolean;
    }
    | {
        readonly kind: 'endTag';
        /** The innermost open element, which the end tag should close. */
        readonly element: XmlElement | undefined;
        readonly replaceStart: number;
        readonly replaceEnd: number;
        readonly hasClosingBracket: boolean;
    }
    | {
        readonly kind: 'attributeName';
        readonly element: XmlElement;
        readonly attribute: XmlAttribute | undefined;
        readonly replaceStart: number;
        readonly replaceEnd: number;
    }
    | {
        readonly kind: 'attributeValue';
        readonly element: XmlElement;
        readonly attribute: XmlAttribute;
        readonly replaceStart: number;
        readonly replaceEnd: number;
        /** False when the value has no quotes yet (`name=|`), so completion must add them. */
        readonly quoted: boolean;
    }
    | {
        readonly kind: 'content';
        readonly element: XmlElement | undefined;
        readonly replaceStart: number;
        readonly replaceEnd: number;
    }
    | { readonly kind: 'none' };

export function getCursorContext(document: XmlDocument, offset: number): CursorContext {
    const text = document.text;
    if (isInsideOpaqueNode(document.children, offset)) {
        return { kind: 'none' };
    }

    const endTag = getEndTagContext(document, offset);
    if (endTag !== undefined) {
        return endTag;
    }

    const element = findStartTagAt(document.children, offset);
    if (element !== undefined) {
        if (offset >= element.nameStart && offset <= element.nameEnd) {
            return {
                kind: 'elementName',
                element,
                parent: element.parent,
                replaceStart: element.nameStart,
                replaceEnd: element.nameEnd,
                bareTag: element.startTagEnd === undefined && element.attributes.length === 0
            };
        }

        for (const attribute of element.attributes) {
            if (attribute.valueStart !== undefined && attribute.valueEnd !== undefined) {
                const quoted = attribute.quote !== undefined;
                const contentStart = quoted ? attribute.valueStart + 1 : attribute.valueStart;
                const contentEnd = quoted && attribute.valueTerminated ? attribute.valueEnd - 1 : attribute.valueEnd;
                if (offset >= contentStart && offset <= contentEnd) {
                    return { kind: 'attributeValue', element, attribute, replaceStart: contentStart, replaceEnd: contentEnd, quoted: true };
                }
            }

            if (offset >= attribute.nameStart && offset <= attribute.nameEnd) {
                return { kind: 'attributeName', element, attribute, replaceStart: attribute.nameStart, replaceEnd: attribute.nameEnd };
            }

            if (attribute.hasEquals && attribute.valueStart === undefined && offset > attribute.nameEnd) {
                const equals = text.indexOf('=', attribute.nameEnd);
                if (equals !== -1 && offset > equals && text.slice(equals + 1, offset).trim().length === 0) {
                    return { kind: 'attributeValue', element, attribute, replaceStart: offset, replaceEnd: offset, quoted: false };
                }
            }
        }

        if (offset > 0 && isWhitespace(text[offset - 1]!)) {
            return { kind: 'attributeName', element, attribute: undefined, replaceStart: offset, replaceEnd: offset };
        }

        return { kind: 'none' };
    }

    const parent = findOpenElementAt(document.children, offset);
    const word = wordRangeAt(text, offset);
    return { kind: 'content', element: parent, replaceStart: word.start, replaceEnd: word.end };
}

function isInsideOpaqueNode(nodes: readonly XmlNode[], offset: number): boolean {
    for (const node of nodes) {
        if (node.kind === 'element') {
            if (offset > node.start && offset <= node.end && isInsideOpaqueNode(node.children, offset)) {
                return true;
            }
        }
        else if (node.kind !== 'text' && offset > node.start && offset < node.end) {
            return true;
        }
    }

    return false;
}

function getEndTagContext(document: XmlDocument, offset: number): CursorContext | undefined {
    const text = document.text;
    let nameStart = offset;
    while (nameStart > 0 && isNameCharacter(text[nameStart - 1]!)) {
        nameStart--;
    }

    if (nameStart < 2 || text[nameStart - 1] !== '/' || text[nameStart - 2] !== '<') {
        return undefined;
    }

    let nameEnd = offset;
    while (nameEnd < text.length && isNameCharacter(text[nameEnd]!)) {
        nameEnd++;
    }

    const tagStart = nameStart - 2;
    return {
        kind: 'endTag',
        element: findElementClosableAt(document.children, tagStart),
        replaceStart: nameStart,
        replaceEnd: nameEnd,
        hasClosingBracket: text[nameEnd] === '>'
    };
}

/** The deepest element whose start tag contains `offset` (past the `<`). */
function findStartTagAt(nodes: readonly XmlNode[], offset: number): XmlElement | undefined {
    for (const node of nodes) {
        if (node.kind !== 'element' || offset <= node.start || offset > node.end) {
            continue;
        }

        const tagEnd = node.startTagEnd;
        if (tagEnd === undefined ? offset <= node.end : offset < tagEnd) {
            return node;
        }

        const nested = findStartTagAt(node.children, offset);
        if (nested !== undefined) {
            return nested;
        }
    }

    return undefined;
}

/** The deepest element whose content (between its tags) contains `offset`. */
export function findOpenElementAt(nodes: readonly XmlNode[], offset: number): XmlElement | undefined {
    for (const node of nodes) {
        if (node.kind !== 'element' || node.selfClosing || node.startTagEnd === undefined) {
            continue;
        }

        const contentEnd = node.endTagStart ?? node.end;
        if (offset >= node.startTagEnd && offset <= contentEnd) {
            return findOpenElementAt(node.children, offset) ?? node;
        }
    }

    return undefined;
}

/**
 * The element an end tag starting at `tagStart` should close: an element whose own end tag starts
 * there, or otherwise the innermost element still open at that point.
 */
function findElementClosableAt(nodes: readonly XmlNode[], tagStart: number): XmlElement | undefined {
    for (const node of nodes) {
        if (node.kind !== 'element' || node.selfClosing || node.startTagEnd === undefined) {
            continue;
        }

        if (node.endTagStart === tagStart) {
            return node;
        }

        const contentEnd = node.endTagStart ?? node.end;
        if (tagStart >= node.startTagEnd && tagStart <= contentEnd) {
            return findElementClosableAt(node.children, tagStart) ?? node;
        }
    }

    return undefined;
}

function wordRangeAt(text: string, offset: number): { start: number; end: number } {
    let start = offset;
    while (start > 0 && !isWhitespace(text[start - 1]!) && text[start - 1] !== '>' && text[start - 1] !== '<') {
        start--;
    }

    let end = offset;
    while (end < text.length && !isWhitespace(text[end]!) && text[end] !== '<') {
        end++;
    }

    return { start, end };
}
