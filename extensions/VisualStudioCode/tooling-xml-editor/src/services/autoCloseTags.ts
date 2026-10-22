import * as vscode from 'vscode';

import { getAutoCloseText } from '../core/autoClose';
import { configurationSection } from './documents';

/**
 * Inserts `</name>` after a typed `>` and the element name after a typed `</`. Only single-cursor
 * typing of one character is handled; pastes, multi-cursor edits, undo, and redo are left alone.
 */
export class AutoCloseTags implements vscode.Disposable {
    private readonly subscription: vscode.Disposable;

    public constructor(private readonly isServed: (document: vscode.TextDocument) => boolean) {
        this.subscription = vscode.workspace.onDidChangeTextDocument(event => this.onDidChange(event));
    }

    private onDidChange(event: vscode.TextDocumentChangeEvent): void {
        if (event.reason !== undefined || event.contentChanges.length !== 1) {
            return;
        }

        const change = event.contentChanges[0]!;
        if ((change.text !== '>' && change.text !== '/') || change.rangeLength !== 0) {
            return;
        }

        const document = event.document;
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined || editor.document !== document || editor.selections.length !== 1 || !this.isServed(document)) {
            return;
        }
        if (!vscode.workspace.getConfiguration(configurationSection, document.uri).get<boolean>('completion.autoCloseTags', true)) {
            return;
        }

        const offset = change.rangeOffset + 1;
        const insertion = getAutoCloseText(document.getText(), offset);
        if (insertion === undefined) {
            return;
        }

        const version = document.version;
        const position = document.positionAt(offset);
        // Insert after the typing edit settles; a later keystroke cancels the insertion.
        setTimeout(() => void this.insert(editor, version, position, insertion, change.text === '>'), 0);
    }

    private async insert(editor: vscode.TextEditor, version: number, position: vscode.Position, insertion: string, keepCursor: boolean): Promise<void> {
        const document = editor.document;
        if (document.version !== version || vscode.window.activeTextEditor !== editor) {
            return;
        }

        // A plain edit plus an explicit selection, rather than a snippet: with the suggest widget
        // open, a snippet whose only tab stop is $0 does not reliably keep the cursor in place.
        const applied = await editor.edit(builder => builder.insert(position, insertion), { undoStopBefore: false, undoStopAfter: false });
        if (applied && keepCursor && document.version === version + 1) {
            editor.selection = new vscode.Selection(position, position);
        }
    }

    public dispose(): void {
        this.subscription.dispose();
    }
}
