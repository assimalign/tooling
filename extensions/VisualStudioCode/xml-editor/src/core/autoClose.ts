/**
 * Decides what to insert after the user types `>` or `/` so that tags close themselves.
 */

import { findOpenElementAt } from './context';
import { XmlElement, XmlNode, isNameCharacter, parseXml } from './parser';

/**
 * Returns the text to insert at `offset` (the position just after the typed character), or
 * undefined when nothing should be inserted.
 *
 * - After `>` that ends a start tag with no matching end tag, inserts `</name>`.
 * - After `</`, inserts the name of the innermost open element followed by `>`.
 */
export function getAutoCloseText(text: string, offset: number): string | undefined {
    const typed = text[offset - 1];
    if (typed === '>') {
        const document = parseXml(text);
        const element = findStartTagEndingAt(document.children, offset);
        if (element === undefined || element.selfClosing || element.endTagStart !== undefined || element.name.length === 0) {
            return undefined;
        }

        return `</${element.name}>`;
    }

    if (typed === '/' && text[offset - 2] === '<') {
        if (offset < text.length && (isNameCharacter(text[offset]!) || text[offset] === '>')) {
            return undefined;
        }

        // Parse without the half-typed `</` so it cannot be mistaken for the end of anything.
        const document = parseXml(text.slice(0, offset - 2) + '  ' + text.slice(offset));
        const element = findOpenElementAt(document.children, offset - 2);
        if (element === undefined || element.name.length === 0 || element.endTagStart !== undefined) {
            return undefined;
        }

        return `${element.name}>`;
    }

    return undefined;
}

function findStartTagEndingAt(nodes: readonly XmlNode[], offset: number): XmlElement | undefined {
    for (const node of nodes) {
        if (node.kind !== 'element' || node.start >= offset) {
            continue;
        }
        if (node.startTagEnd === offset) {
            return node;
        }
        if (node.end >= offset) {
            const nested = findStartTagEndingAt(node.children, offset);
            if (nested !== undefined) {
                return nested;
            }
        }
    }

    return undefined;
}
