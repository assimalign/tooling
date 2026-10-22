/**
 * A tolerant, position-preserving XML parser.
 *
 * Unlike a conformant parser this never stops at the first error: an editor has to understand a
 * document while it is being typed, so unterminated tags, stray end tags, and unclosed elements are
 * recorded as diagnostics and the tree is repaired around them. Every node keeps the offsets it was
 * read from, which is what completion, hover, and formatting are computed against.
 */

export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
export const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';

export type DiagnosticSeverity = 'error' | 'warning' | 'information';

export interface XmlDiagnostic {
    readonly start: number;
    readonly end: number;
    readonly message: string;
    readonly severity: DiagnosticSeverity;
}

export interface XmlAttribute {
    readonly name: string;
    readonly nameStart: number;
    readonly nameEnd: number;
    readonly hasEquals: boolean;
    /** The raw value without quotes. Entity references are not expanded. */
    readonly value: string | undefined;
    /** Offset of the opening quote, or of the first character of an unquoted value. */
    readonly valueStart: number | undefined;
    /** Offset just past the closing quote (or past the last character read when unterminated). */
    readonly valueEnd: number | undefined;
    readonly quote: '"' | '\'' | undefined;
    /** False when a quoted value ran into `<` or the end of the document. */
    readonly valueTerminated: boolean;
}

export interface XmlElement {
    readonly kind: 'element';
    readonly name: string;
    readonly nameStart: number;
    readonly nameEnd: number;
    readonly start: number;
    end: number;
    readonly attributes: XmlAttribute[];
    /** Offset just past `>` or `/>`; undefined while the start tag is unterminated. */
    startTagEnd: number | undefined;
    selfClosing: boolean;
    /** Offset of `</` of the matching end tag, when one was found. */
    endTagStart: number | undefined;
    readonly children: XmlNode[];
    readonly parent: XmlElement | undefined;
}

export interface XmlLeaf {
    readonly kind: 'text' | 'comment' | 'cdata' | 'processingInstruction' | 'declaration';
    readonly start: number;
    readonly end: number;
    readonly parent: XmlElement | undefined;
}

export type XmlNode = XmlElement | XmlLeaf;

export interface XmlDocument {
    readonly text: string;
    readonly children: XmlNode[];
    readonly diagnostics: XmlDiagnostic[];
    readonly root: XmlElement | undefined;
}

export function parseXml(text: string): XmlDocument {
    return new Parser(text).parse();
}

class Parser {
    private position = 0;
    private readonly stack: XmlElement[] = [];
    private readonly children: XmlNode[] = [];
    private readonly diagnostics: XmlDiagnostic[] = [];

    public constructor(private readonly text: string) {
    }

    public parse(): XmlDocument {
        const text = this.text;
        while (this.position < text.length) {
            const tagStart = text.indexOf('<', this.position);
            if (tagStart === -1) {
                this.addLeaf('text', this.position, text.length);
                this.position = text.length;
                break;
            }

            if (tagStart > this.position) {
                this.addLeaf('text', this.position, tagStart);
            }

            this.position = tagStart;
            if (text.startsWith('<!--', tagStart)) {
                this.readDelimited('comment', '-->', 'Comment is not terminated; expected \'-->\'.');
            }
            else if (text.startsWith('<![CDATA[', tagStart)) {
                this.readDelimited('cdata', ']]>', 'CDATA section is not terminated; expected \']]>\'.');
            }
            else if (text.startsWith('<!', tagStart)) {
                this.readDeclaration();
            }
            else if (text.startsWith('<?', tagStart)) {
                this.readProcessingInstruction();
            }
            else if (text.startsWith('</', tagStart)) {
                this.readEndTag();
            }
            else {
                this.readStartTag();
            }
        }

        for (let index = this.stack.length - 1; index >= 0; index--) {
            const element = this.stack[index]!;
            this.report(element.nameStart, element.nameEnd, `Element '${element.name}' is not closed.`);
            element.end = text.length;
        }
        this.stack.length = 0;

        const root = this.validateDocumentLevel();
        return { text, children: this.children, diagnostics: this.diagnostics, root };
    }

    private validateDocumentLevel(): XmlElement | undefined {
        let root: XmlElement | undefined;
        for (const node of this.children) {
            if (node.kind === 'element') {
                if (root === undefined) {
                    root = node;
                }
                else {
                    this.report(node.nameStart, Math.max(node.nameEnd, node.nameStart + 1), 'Only one root element is allowed.');
                }
            }
            else if (node.kind === 'text' && this.text.slice(node.start, node.end).trim().length > 0) {
                const range = trimRange(this.text, node.start, node.end);
                this.report(range.start, range.end, 'Text is not allowed outside the root element.');
            }
            else if (node.kind === 'cdata') {
                this.report(node.start, node.end, 'CDATA sections are not allowed outside the root element.');
            }
        }

        return root;
    }

    private get current(): XmlElement | undefined {
        return this.stack[this.stack.length - 1];
    }

    private append(node: XmlNode): void {
        const parent = this.current;
        if (parent === undefined) {
            this.children.push(node);
        }
        else {
            parent.children.push(node);
        }
    }

    private addLeaf(kind: XmlLeaf['kind'], start: number, end: number): XmlLeaf {
        const leaf: XmlLeaf = { kind, start, end, parent: this.current };
        this.append(leaf);
        return leaf;
    }

    private report(start: number, end: number, message: string, severity: DiagnosticSeverity = 'error'): void {
        this.diagnostics.push({ start, end, message, severity });
    }

    private readDelimited(kind: 'comment' | 'cdata', terminator: string, message: string): void {
        const start = this.position;
        const close = this.text.indexOf(terminator, start + 4);
        if (close === -1) {
            this.report(start, Math.min(start + 4, this.text.length), message);
            this.position = this.text.length;
        }
        else {
            this.position = close + terminator.length;
        }

        this.addLeaf(kind, start, this.position);
    }

    private readDeclaration(): void {
        // <!DOCTYPE ...> may carry an internal subset in brackets and quoted literals that contain '>'.
        const start = this.position;
        const text = this.text;
        let depth = 0;
        let quote: string | undefined;
        let index = start + 2;
        for (; index < text.length; index++) {
            const character = text[index];
            if (quote !== undefined) {
                if (character === quote) {
                    quote = undefined;
                }
            }
            else if (character === '"' || character === '\'') {
                quote = character;
            }
            else if (character === '[') {
                depth++;
            }
            else if (character === ']') {
                depth--;
            }
            else if (character === '>' && depth <= 0) {
                break;
            }
        }

        if (index >= text.length) {
            this.report(start, Math.min(start + 2, text.length), 'Declaration is not terminated; expected \'>\'.');
            this.position = text.length;
        }
        else {
            this.position = index + 1;
        }

        this.addLeaf('declaration', start, this.position);
    }

    private readProcessingInstruction(): void {
        const start = this.position;
        const close = this.text.indexOf('?>', start + 2);
        this.position = close === -1 ? this.text.length : close + 2;
        if (close === -1) {
            this.report(start, Math.min(start + 2, this.text.length), 'Processing instruction is not terminated; expected \'?>\'.');
        }

        const target = readNameAt(this.text, start + 2);
        if (target.toLowerCase() === 'xml' && start !== 0) {
            this.report(start, start + 5, 'The XML declaration must be the first thing in the document.');
        }

        this.addLeaf('processingInstruction', start, this.position);
    }

    private readEndTag(): void {
        const text = this.text;
        const start = this.position;
        const nameStart = start + 2;
        const name = readNameAt(text, nameStart);
        const nameEnd = nameStart + name.length;
        let index = skipWhitespace(text, nameEnd);
        if (text[index] === '>') {
            index++;
        }
        else {
            this.report(start, nameEnd, `End tag '</${name}' is not terminated; expected '>'.`);
        }

        this.position = index;

        let match = -1;
        for (let stackIndex = this.stack.length - 1; stackIndex >= 0; stackIndex--) {
            if (this.stack[stackIndex]!.name === name) {
                match = stackIndex;
                break;
            }
        }

        if (match === -1) {
            this.report(start, Math.max(nameEnd, start + 2), name.length === 0
                ? 'Expected an element name after \'</\'.'
                : `Unexpected end tag '</${name}>'; no element '${name}' is open.`);
            return;
        }

        while (this.stack.length - 1 > match) {
            const unclosed = this.stack.pop()!;
            this.report(unclosed.nameStart, unclosed.nameEnd, `Element '${unclosed.name}' is not closed.`);
            unclosed.end = start;
        }

        const element = this.stack.pop()!;
        element.endTagStart = start;
        element.end = index;
    }

    private readStartTag(): void {
        const text = this.text;
        const start = this.position;
        const nameStart = start + 1;
        const name = readNameAt(text, nameStart);
        const nameEnd = nameStart + name.length;
        const element: XmlElement = {
            kind: 'element',
            name,
            nameStart,
            nameEnd,
            start,
            end: nameEnd,
            attributes: [],
            startTagEnd: undefined,
            selfClosing: false,
            endTagStart: undefined,
            children: [],
            parent: this.current
        };
        this.append(element);

        if (name.length === 0) {
            this.report(start, start + 1, 'Expected an element name after \'<\'.');
        }

        this.position = nameEnd;
        while (true) {
            this.position = skipWhitespace(text, this.position);
            const character = text[this.position];
            if (character === undefined || character === '<') {
                if (name.length > 0) {
                    this.report(nameStart, nameEnd, `Start tag of '${name}' is not terminated; expected '>'.`);
                }
                element.end = this.position;
                return;
            }

            if (character === '>') {
                this.position++;
                element.startTagEnd = this.position;
                element.end = this.position;
                this.stack.push(element);
                return;
            }

            if (character === '/' && text[this.position + 1] === '>') {
                this.position += 2;
                element.startTagEnd = this.position;
                element.selfClosing = true;
                element.end = this.position;
                return;
            }

            if (isNameStartCharacter(character)) {
                this.readAttribute(element);
            }
            else {
                this.report(this.position, this.position + 1, `Unexpected character '${character}' in the start tag of '${name}'.`);
                this.position++;
            }
        }
    }

    private readAttribute(element: XmlElement): void {
        const text = this.text;
        const nameStart = this.position;
        const name = readNameAt(text, nameStart);
        const nameEnd = nameStart + name.length;
        let index = skipWhitespace(text, nameEnd);
        let hasEquals = false;
        let value: string | undefined;
        let valueStart: number | undefined;
        let valueEnd: number | undefined;
        let quote: '"' | '\'' | undefined;
        let valueTerminated = true;

        if (text[index] === '=') {
            hasEquals = true;
            index = skipWhitespace(text, index + 1);
            const character = text[index];
            if (character === '"' || character === '\'') {
                quote = character;
                valueStart = index;
                let close = index + 1;
                while (close < text.length && text[close] !== quote && text[close] !== '<') {
                    close++;
                }

                value = text.slice(index + 1, close);
                if (text[close] === quote) {
                    index = close + 1;
                }
                else {
                    valueTerminated = false;
                    index = close;
                    this.report(nameStart, nameEnd, `The value of attribute '${name}' is not terminated.`);
                }
                valueEnd = index;
            }
            else if (character !== undefined && character !== '>' && character !== '<' && !text.startsWith('/>', index)) {
                valueStart = index;
                while (index < text.length && !isWhitespace(text[index]!) && text[index] !== '>' && text[index] !== '<' && !text.startsWith('/>', index)) {
                    index++;
                }
                value = text.slice(valueStart, index);
                valueEnd = index;
                this.report(valueStart, valueEnd, `The value of attribute '${name}' must be quoted.`);
            }
            else {
                this.report(nameStart, nameEnd, `Attribute '${name}' is missing a value.`);
            }
        }
        else {
            index = nameEnd;
            this.report(nameStart, nameEnd, `Attribute '${name}' is missing a value.`);
        }

        if (element.attributes.some(existing => existing.name === name)) {
            this.report(nameStart, nameEnd, `Attribute '${name}' is specified more than once.`);
        }

        element.attributes.push({ name, nameStart, nameEnd, hasEquals, value, valueStart, valueEnd, quote, valueTerminated });
        this.position = index;
    }
}

export function isWhitespace(character: string): boolean {
    return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

export function isNameStartCharacter(character: string): boolean {
    const code = character.charCodeAt(0);
    return (code >= 0x61 && code <= 0x7a)
        || (code >= 0x41 && code <= 0x5a)
        || character === '_'
        || character === ':'
        || code >= 0xc0;
}

export function isNameCharacter(character: string): boolean {
    const code = character.charCodeAt(0);
    return isNameStartCharacter(character)
        || (code >= 0x30 && code <= 0x39)
        || character === '-'
        || character === '.'
        || code === 0xb7;
}

export function readNameAt(text: string, start: number): string {
    if (start >= text.length || !isNameStartCharacter(text[start]!)) {
        return '';
    }

    let end = start + 1;
    while (end < text.length && isNameCharacter(text[end]!)) {
        end++;
    }

    return text.slice(start, end);
}

function skipWhitespace(text: string, index: number): number {
    while (index < text.length && isWhitespace(text[index]!)) {
        index++;
    }

    return index;
}

function trimRange(text: string, start: number, end: number): { start: number; end: number } {
    while (start < end && isWhitespace(text[start]!)) {
        start++;
    }
    while (end > start && isWhitespace(text[end - 1]!)) {
        end--;
    }

    return { start, end };
}

// ------------------------------------------------------------------------------------------------
// Tree helpers
// ------------------------------------------------------------------------------------------------

export function childElements(element: XmlElement | XmlDocument): XmlElement[] {
    return element.children.filter((node): node is XmlElement => node.kind === 'element');
}

export function getAttribute(element: XmlElement, name: string): XmlAttribute | undefined {
    return element.attributes.find(attribute => attribute.name === name);
}

/** Visits every element depth-first in document order. */
export function forEachElement(nodes: readonly XmlNode[], visit: (element: XmlElement) => void): void {
    for (const node of nodes) {
        if (node.kind === 'element') {
            visit(node);
            forEachElement(node.children, visit);
        }
    }
}

/** The raw text between the start tag and the end tag, or undefined when the element has no content. */
export function innerText(document: XmlDocument, element: XmlElement): string | undefined {
    if (element.startTagEnd === undefined || element.selfClosing) {
        return undefined;
    }

    return document.text.slice(element.startTagEnd, element.endTagStart ?? element.end);
}

const predefinedEntities: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };

/** Replaces the predefined entities and character references; other entity references are kept. */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (reference, name: string) => {
        if (name.startsWith('#')) {
            const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
            return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : reference;
        }

        return predefinedEntities[name] ?? reference;
    });
}

/** The character data of an element: its text (entities decoded) and CDATA children, without markup. */
export function textContent(document: XmlDocument, element: XmlElement): string {
    let result = '';
    for (const child of element.children) {
        if (child.kind === 'text') {
            result += decodeEntities(document.text.slice(child.start, child.end));
        }
        else if (child.kind === 'cdata') {
            result += document.text.slice(child.start + 9, Math.max(child.start + 9, child.end - 3));
        }
        else if (child.kind === 'element') {
            result += textContent(document, child);
        }
    }

    return result;
}

// ------------------------------------------------------------------------------------------------
// Namespaces
// ------------------------------------------------------------------------------------------------

export interface QualifiedName {
    readonly prefix: string;
    readonly localName: string;
}

export function splitQualifiedName(name: string): QualifiedName {
    const colon = name.indexOf(':');
    return colon === -1
        ? { prefix: '', localName: name }
        : { prefix: name.slice(0, colon), localName: name.slice(colon + 1) };
}

/** Resolves a prefix ('' for the default namespace) in the scope of an element. */
export function lookupNamespace(element: XmlElement | undefined, prefix: string): string | undefined {
    if (prefix === 'xml') {
        return XML_NAMESPACE;
    }
    if (prefix === 'xmlns') {
        return XMLNS_NAMESPACE;
    }

    const declaration = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
    for (let current = element; current !== undefined; current = current.parent) {
        const attribute = getAttribute(current, declaration);
        if (attribute !== undefined && attribute.value !== undefined) {
            return attribute.value;
        }
    }

    return prefix === '' ? '' : undefined;
}

/** Every prefix in scope at an element, nearest declaration first. The default namespace uses ''. */
export function namespacesInScope(element: XmlElement | undefined): Map<string, string> {
    const scope = new Map<string, string>();
    for (let current = element; current !== undefined; current = current.parent) {
        for (const attribute of current.attributes) {
            if (attribute.value === undefined) {
                continue;
            }
            if (attribute.name === 'xmlns' && !scope.has('')) {
                scope.set('', attribute.value);
            }
            else if (attribute.name.startsWith('xmlns:')) {
                const prefix = attribute.name.slice(6);
                if (!scope.has(prefix)) {
                    scope.set(prefix, attribute.value);
                }
            }
        }
    }

    return scope;
}

/** The namespace of an element, or undefined when its prefix is not declared. */
export function elementNamespace(element: XmlElement): string | undefined {
    return lookupNamespace(element, splitQualifiedName(element.name).prefix);
}

/** The namespace of an attribute. Unprefixed attributes are in no namespace. */
export function attributeNamespace(element: XmlElement, attribute: XmlAttribute): string | undefined {
    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
        return XMLNS_NAMESPACE;
    }

    const { prefix } = splitQualifiedName(attribute.name);
    return prefix === '' ? '' : lookupNamespace(element, prefix);
}

/**
 * The prefix to write a name in `namespace` with, at `element`: '' when it is the default namespace,
 * otherwise the nearest declared prefix. Undefined when the namespace is not in scope.
 */
export function prefixForNamespace(element: XmlElement | undefined, namespace: string): string | undefined {
    if (namespace === XML_NAMESPACE) {
        return 'xml';
    }

    const scope = namespacesInScope(element);
    if ((scope.get('') ?? '') === namespace) {
        return '';
    }

    for (const [prefix, uri] of scope) {
        if (prefix !== '' && uri === namespace && lookupNamespace(element, prefix) === namespace) {
            return prefix;
        }
    }

    return undefined;
}

/** Every namespace URI declared anywhere in the document. */
export function declaredNamespaces(document: XmlDocument): Set<string> {
    const namespaces = new Set<string>();
    forEachElement(document.children, element => {
        for (const attribute of element.attributes) {
            if ((attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) && attribute.value) {
                namespaces.add(attribute.value);
            }
        }
    });

    return namespaces;
}

export interface SchemaLocationHint {
    readonly namespace: string;
    readonly location: string;
}

/** Reads `xsi:schemaLocation` and `xsi:noNamespaceSchemaLocation` from every element. */
export function schemaLocationHints(document: XmlDocument): SchemaLocationHint[] {
    const hints: SchemaLocationHint[] = [];
    forEachElement(document.children, element => {
        for (const attribute of element.attributes) {
            if (attribute.value === undefined || attributeNamespace(element, attribute) !== XSI_NAMESPACE) {
                continue;
            }

            const { localName } = splitQualifiedName(attribute.name);
            if (localName === 'noNamespaceSchemaLocation' && attribute.value.trim().length > 0) {
                hints.push({ namespace: '', location: attribute.value.trim() });
            }
            else if (localName === 'schemaLocation') {
                const tokens = attribute.value.split(/\s+/).filter(token => token.length > 0);
                for (let index = 0; index + 1 < tokens.length; index += 2) {
                    hints.push({ namespace: tokens[index]!, location: tokens[index + 1]! });
                }
            }
        }
    });

    return hints;
}
