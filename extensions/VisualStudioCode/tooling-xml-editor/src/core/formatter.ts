/**
 * A content-preserving XML formatter.
 *
 * Only whitespace the XML data model treats as insignificant in practice is rewritten: the
 * whitespace between markup in element-only content, and the whitespace between attributes.
 * Text-only and mixed content, attribute values, comments, CDATA sections, processing instructions,
 * and anything under `xml:space="preserve"` are emitted exactly as written. A document that is not
 * well-formed is never formatted, because a repaired tree would rewrite the user's markup.
 */

import { XmlDocument, XmlElement, XmlNode, getAttribute, parseXml } from './parser';

export interface FormatOptions {
    /** One level of indentation, for example two spaces or a tab. */
    readonly indent: string;
    readonly newline: '\n' | '\r\n';
    /** Put each attribute on its own line when an element has more than one. */
    readonly splitAttributes: boolean;
    /** Write `<a></a>` as `<a />`. */
    readonly selfCloseEmptyElements: boolean;
    /** Write `<a />` rather than `<a/>`. */
    readonly spaceBeforeSelfClose: boolean;
    /** Keep a single blank line where the source had one or more between nodes. */
    readonly preserveBlankLines: boolean;
}

export const defaultFormatOptions: FormatOptions = {
    indent: '  ',
    newline: '\n',
    splitAttributes: false,
    selfCloseEmptyElements: false,
    spaceBeforeSelfClose: true,
    preserveBlankLines: true
};

export type FormatResult =
    | { readonly kind: 'formatted'; readonly text: string }
    | { readonly kind: 'notWellFormed'; readonly message: string };

export function formatXml(text: string, options: FormatOptions = defaultFormatOptions): FormatResult {
    const document = parseXml(text);
    const firstError = document.diagnostics.find(diagnostic => diagnostic.severity === 'error');
    if (firstError !== undefined) {
        return { kind: 'notWellFormed', message: firstError.message };
    }

    const formatter = new Formatter(document, options);
    formatter.formatNodes(document.children, 0);
    let result = formatter.lines.join(options.newline);
    if (/\r?\n$/.test(text) || text.length === 0) {
        result += text.length === 0 ? '' : options.newline;
    }

    return { kind: 'formatted', text: result };
}

class Formatter {
    public readonly lines: string[] = [];

    public constructor(private readonly document: XmlDocument, private readonly options: FormatOptions) {
    }

    private raw(start: number, end: number): string {
        return this.document.text.slice(start, end);
    }

    private emit(depth: number, text: string): void {
        // Multi-line raw text (a comment, a long attribute value) keeps its own line structure; only
        // the first line is re-indented.
        const normalized = text.replace(/\r\n?/g, '\n').split('\n');
        this.lines.push(this.options.indent.repeat(depth) + normalized[0]);
        for (let index = 1; index < normalized.length; index++) {
            this.lines.push(normalized[index]!);
        }
    }

    public formatNodes(nodes: readonly XmlNode[], depth: number): void {
        let pendingBlankLine = false;
        let emittedAny = false;
        for (const node of nodes) {
            if (node.kind === 'text') {
                const whitespace = this.raw(node.start, node.end);
                if (this.options.preserveBlankLines && emittedAny && (whitespace.match(/\n/g)?.length ?? 0) >= 2) {
                    pendingBlankLine = true;
                }
                continue;
            }

            if (pendingBlankLine) {
                this.lines.push('');
                pendingBlankLine = false;
            }

            emittedAny = true;
            if (node.kind === 'element') {
                this.formatElement(node, depth);
            }
            else {
                this.emit(depth, this.raw(node.start, node.end));
            }
        }
    }

    private formatElement(element: XmlElement, depth: number): void {
        const content = this.classify(element);
        if (element.selfClosing || (content === 'empty' && this.options.selfCloseEmptyElements)) {
            this.emitStartTag(element, depth, this.options.spaceBeforeSelfClose ? ' />' : '/>');
            return;
        }

        const endTag = `</${element.name}>`;
        if (content === 'empty') {
            this.emitStartTag(element, depth, `>${endTag}`);
            return;
        }

        if (content === 'verbatim') {
            this.emitStartTag(element, depth, `>${this.raw(element.startTagEnd!, element.endTagStart!)}${endTag}`);
            return;
        }

        this.emitStartTag(element, depth, '>');
        this.formatNodes(element.children, depth + 1);
        this.emit(depth, endTag);
    }

    private emitStartTag(element: XmlElement, depth: number, suffix: string): void {
        const attributes = element.attributes.map(attribute => attribute.valueStart === undefined
            ? attribute.name
            : `${attribute.name}=${this.raw(attribute.valueStart, attribute.valueEnd!)}`);

        if (!this.options.splitAttributes || attributes.length <= 1) {
            this.emit(depth, `<${[element.name, ...attributes].join(' ')}${suffix}`);
            return;
        }

        this.emit(depth, `<${element.name}`);
        attributes.forEach((attribute, index) => {
            this.emit(depth + 1, index === attributes.length - 1 ? attribute + suffix : attribute);
        });
    }

    /**
     * - `empty`: no content, or only whitespace;
     * - `verbatim`: text or CDATA is present (text-only or mixed content) or whitespace is preserved;
     * - `structured`: only elements, comments, and processing instructions separated by whitespace.
     */
    private classify(element: XmlElement): 'empty' | 'verbatim' | 'structured' {
        if (element.selfClosing || element.startTagEnd === undefined || element.endTagStart === undefined) {
            return 'empty';
        }
        if (preservesSpace(element)) {
            return element.startTagEnd === element.endTagStart ? 'empty' : 'verbatim';
        }

        let hasMarkup = false;
        for (const child of element.children) {
            if (child.kind === 'cdata') {
                return 'verbatim';
            }
            if (child.kind === 'text') {
                if (this.raw(child.start, child.end).trim().length > 0) {
                    return 'verbatim';
                }
            }
            else {
                hasMarkup = true;
            }
        }

        return hasMarkup ? 'structured' : 'empty';
    }
}

function preservesSpace(element: XmlElement | undefined): boolean {
    for (let current = element; current !== undefined; current = current.parent) {
        const space = getAttribute(current, 'xml:space')?.value;
        if (space === 'preserve') {
            return true;
        }
        if (space === 'default') {
            return false;
        }
    }

    return false;
}
