/**
 * Small helpers over the XML editor's syntax tree. The tree types come from the XML editor's API;
 * these helpers are restated here because only its types, not its code, may be imported.
 */

import type { XmlDocument, XmlElement, XmlNode } from '../../../tooling-xml-editor/src/api';

export type { XmlDocument, XmlElement, XmlNode };

export type ParseXml = (text: string) => XmlDocument;

export function localName(element: XmlElement): string {
    const colon = element.name.indexOf(':');
    return colon === -1 ? element.name : element.name.slice(colon + 1);
}

export function elementChildren(element: XmlElement): XmlElement[] {
    return element.children.filter((node): node is XmlElement => node.kind === 'element');
}

export function attribute(element: XmlElement, name: string): string | undefined {
    return element.attributes.find(candidate => candidate.name === name)?.value;
}

/** Text and CDATA directly inside an element, or undefined when it has child elements. */
export function simpleContent(document: XmlDocument, element: XmlElement): string | undefined {
    let text = '';
    for (const child of element.children) {
        if (child.kind === 'element') {
            return undefined;
        }
        if (child.kind === 'text') {
            text += document.text.slice(child.start, child.end);
        }
        else if (child.kind === 'cdata') {
            text += document.text.slice(child.start + 9, Math.max(child.start + 9, child.end - 3));
        }
    }

    return text;
}

/**
 * The comment directly before a node among its siblings (whitespace between them is allowed),
 * normalized: comment markers removed, common indentation stripped.
 */
export function precedingComment(document: XmlDocument, element: XmlElement): string | undefined {
    const siblings = element.parent?.children ?? document.children;
    let index = siblings.indexOf(element) - 1;
    while (index >= 0 && siblings[index]!.kind === 'text' && document.text.slice(siblings[index]!.start, siblings[index]!.end).trim().length === 0) {
        index--;
    }

    const node = siblings[index];
    if (node === undefined || node.kind !== 'comment') {
        return undefined;
    }

    const raw = document.text.slice(node.start + 4, Math.max(node.start + 4, node.end - 3));
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    const indentation = Math.min(...lines.slice(1)
        .filter(line => line.trim().length > 0)
        .map(line => line.length - line.trimStart().length));
    const text = [lines[0]!.trim(), ...lines.slice(1).map(line => line.slice(Number.isFinite(indentation) ? indentation : 0).trimEnd())]
        .join('\n')
        .trim();
    return text.length === 0 ? undefined : text;
}
