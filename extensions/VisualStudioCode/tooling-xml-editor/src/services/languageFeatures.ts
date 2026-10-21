import * as vscode from 'vscode';

import { CompletionKind, CompletionSuggestion, getCompletions } from '../core/completion';
import { formatXml } from '../core/formatter';
import { getHover } from '../core/hover';
import { DocumentCache, configurationSection } from './documents';
import { SchemaService } from './schemaService';

/** Characters that open completion without a keystroke-triggered quick suggestion. */
const triggerCharacters = ['<', '/', ' ', '"', '\'', '=', ':'];

const completionItemKinds: Record<CompletionKind, vscode.CompletionItemKind> = {
    element: vscode.CompletionItemKind.Property,
    attribute: vscode.CompletionItemKind.Field,
    value: vscode.CompletionItemKind.EnumMember,
    endTag: vscode.CompletionItemKind.Property,
    namespace: vscode.CompletionItemKind.Module,
    snippet: vscode.CompletionItemKind.Snippet,
    type: vscode.CompletionItemKind.TypeParameter
};

export class XmlCompletionProvider implements vscode.CompletionItemProvider {
    public constructor(private readonly documents: DocumentCache, private readonly schemas: SchemaService) {
    }

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> {
        const xml = this.documents.get(document);
        const schemas = await this.schemas.schemasFor(document, xml).catch(() => undefined);
        if (token.isCancellationRequested) {
            return [];
        }

        const suggestions = getCompletions(xml, document.offsetAt(position), schemas, {
            knownNamespaces: this.schemas.knownNamespaces(document)
        });
        return suggestions.map(suggestion => toCompletionItem(document, position, suggestion));
    }
}

function toCompletionItem(document: vscode.TextDocument, position: vscode.Position, suggestion: CompletionSuggestion): vscode.CompletionItem {
    const item = new vscode.CompletionItem(suggestion.label, completionItemKinds[suggestion.kind]);
    item.insertText = suggestion.isSnippet ? new vscode.SnippetString(suggestion.insertText) : suggestion.insertText;

    // Completion ranges must be single-line and contain the cursor; a value spanning lines keeps
    // VS Code's default word range instead.
    const start = document.positionAt(suggestion.replaceStart);
    const end = document.positionAt(suggestion.replaceEnd);
    if (start.line === position.line && start.isBeforeOrEqual(position)) {
        item.range = end.line === position.line && end.isAfterOrEqual(position)
            ? { inserting: new vscode.Range(start, position), replacing: new vscode.Range(start, end) }
            : new vscode.Range(start, position);
    }

    if (suggestion.detail !== undefined) {
        item.detail = suggestion.detail;
    }
    if (suggestion.documentation !== undefined) {
        item.documentation = new vscode.MarkdownString(suggestion.documentation);
    }
    if (suggestion.sortText !== undefined) {
        item.sortText = suggestion.sortText;
    }
    if (suggestion.filterText !== undefined) {
        item.filterText = suggestion.filterText;
    }
    if (suggestion.retrigger === true) {
        item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest values' };
    }

    return item;
}

export class XmlHoverProvider implements vscode.HoverProvider {
    public constructor(private readonly documents: DocumentCache, private readonly schemas: SchemaService) {
    }

    public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const xml = this.documents.get(document);
        const schemas = await this.schemas.schemasFor(document, xml).catch(() => undefined);
        const hover = getHover(xml, document.offsetAt(position), schemas);
        return hover === undefined
            ? undefined
            : new vscode.Hover(
                new vscode.MarkdownString(hover.contents),
                new vscode.Range(document.positionAt(hover.start), document.positionAt(hover.end)));
    }
}

export class XmlFormattingProvider implements vscode.DocumentFormattingEditProvider {
    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions): vscode.TextEdit[] {
        const configuration = vscode.workspace.getConfiguration(configurationSection, document.uri);
        if (!configuration.get<boolean>('format.enabled', true)) {
            return [];
        }

        const original = document.getText();
        const result = formatXml(original, {
            indent: options.insertSpaces ? ' '.repeat(options.tabSize) : '\t',
            newline: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
            splitAttributes: configuration.get<boolean>('format.splitAttributes', false),
            selfCloseEmptyElements: configuration.get<boolean>('format.selfCloseEmptyElements', false),
            spaceBeforeSelfClose: configuration.get<boolean>('format.spaceBeforeSelfClose', true),
            preserveBlankLines: configuration.get<boolean>('format.preserveBlankLines', true)
        });

        if (result.kind === 'notWellFormed') {
            vscode.window.setStatusBarMessage(`$(warning) XML was not formatted: ${result.message}`, 5000);
            return [];
        }

        return minimalEdit(document, original, result.text);
    }
}

/** One edit covering only the changed middle, so the cursor and folds outside it stay put. */
function minimalEdit(document: vscode.TextDocument, original: string, formatted: string): vscode.TextEdit[] {
    if (original === formatted) {
        return [];
    }

    let prefix = 0;
    const shorter = Math.min(original.length, formatted.length);
    while (prefix < shorter && original.charCodeAt(prefix) === formatted.charCodeAt(prefix)) {
        prefix++;
    }

    let suffix = 0;
    while (suffix < shorter - prefix
        && original.charCodeAt(original.length - 1 - suffix) === formatted.charCodeAt(formatted.length - 1 - suffix)) {
        suffix++;
    }

    // Never split a CRLF pair between the kept and the replaced text.
    if (prefix > 0 && original[prefix - 1] === '\r') {
        prefix--;
    }
    if (suffix > 0 && original[original.length - suffix] === '\n' && original[original.length - suffix - 1] === '\r') {
        suffix--;
    }

    const range = new vscode.Range(document.positionAt(prefix), document.positionAt(original.length - suffix));
    return [vscode.TextEdit.replace(range, formatted.slice(prefix, formatted.length - suffix))];
}

/**
 * Registers the language providers for the configured file extensions, and re-registers them when
 * `xmlEditor.fileExtensions` changes.
 */
export class LanguageFeatureRegistration implements vscode.Disposable {
    private registrations: vscode.Disposable[] = [];

    public constructor(
        private readonly documents: DocumentCache,
        private readonly schemas: SchemaService) {
    }

    public register(selector: vscode.DocumentSelector): void {
        this.disposeRegistrations();
        this.registrations = [
            vscode.languages.registerCompletionItemProvider(selector, new XmlCompletionProvider(this.documents, this.schemas), ...triggerCharacters),
            vscode.languages.registerHoverProvider(selector, new XmlHoverProvider(this.documents, this.schemas)),
            vscode.languages.registerDocumentFormattingEditProvider(selector, new XmlFormattingProvider())
        ];
    }

    private disposeRegistrations(): void {
        for (const registration of this.registrations) {
            registration.dispose();
        }
        this.registrations = [];
    }

    public dispose(): void {
        this.disposeRegistrations();
    }
}
