/**
 * End-to-end checks that run inside VS Code against test/integration/workspace, whose
 * .vscode/settings.json registers schemas both by file pattern and by namespace.
 */

import * as assert from 'assert';

import * as vscode from 'vscode';

const workspaceFolder = (): vscode.Uri => vscode.workspace.workspaceFolders![0]!.uri;

async function open(relativePath: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceFolder(), relativePath));
    await vscode.window.showTextDocument(document);
    return document;
}

async function waitFor<TValue>(read: () => TValue | undefined, description: string, timeoutMilliseconds = 10_000): Promise<TValue> {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
        const value = read();
        if (value !== undefined) {
            return value;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for ${description}.`);
}

async function completionLabels(document: vscode.TextDocument, position: vscode.Position, trigger?: string): Promise<string[]> {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider', document.uri, position, trigger);
    return list.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
}

function positionAfter(document: vscode.TextDocument, search: string): vscode.Position {
    const offset = document.getText().indexOf(search);
    assert.notEqual(offset, -1, `'${search}' not found`);
    return document.positionAt(offset + search.length);
}

const xmlDiagnostics = (uri: vscode.Uri): vscode.Diagnostic[] =>
    vscode.languages.getDiagnostics(uri).filter(diagnostic => diagnostic.source === 'xml');

const checks: [string, () => Promise<void>][] = [
    ['validates a document against a schema registered by fileMatch', async () => {
        const document = await open('library/books.xml');
        const diagnostics = await waitFor(
            () => xmlDiagnostics(document.uri).length > 0 ? xmlDiagnostics(document.uri) : undefined,
            'diagnostics on books.xml');
        assert.deepEqual(diagnostics.map(diagnostic => diagnostic.message), ['Element \'shelf\' is not allowed in \'library\'.']);
    }],

    ['completes child elements from the schema', async () => {
        const document = await open('library/books.xml');
        const editor = vscode.window.activeTextEditor!;
        const line = document.lineAt(4);
        await editor.edit(edit => edit.replace(line.range, '  <'));
        const labels = await completionLabels(document, new vscode.Position(4, 3), '<');
        assert.ok(labels.includes('book'), labels.join(', '));
        assert.ok(labels.includes('magazine'), labels.join(', '));
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }],

    ['shows schema documentation on hover', async () => {
        const document = await open('library/books.xml');
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider', document.uri, positionAfter(document, '<lib'));
        const text = hovers.flatMap(hover => hover.contents.map(content => typeof content === 'string' ? content : content.value)).join('\n');
        assert.match(text, /A collection of books\./);
    }],

    ['completes enumerated values from a schema registered by namespace', async () => {
        const document = await open('catalog.xml');
        const labels = await completionLabels(document, positionAfter(document, 'kind="'), '"');
        assert.deepEqual(labels.filter(label => label === 'primary' || label === 'secondary').sort(), ['primary', 'secondary']);
    }],

    ['formats with the editor indentation settings', async () => {
        const document = await open('unformatted.xml');
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true });
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        await vscode.workspace.applyEdit(workspaceEdit);
        assert.equal(document.getText(), '<root>\n  <a>\n    <b x="1" />\n  </a>\n</root>\n');
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }],

    ['closes a start tag when > is typed', async () => {
        const document = await open('scratch.xml');
        const editor = vscode.window.activeTextEditor!;
        editor.selection = new vscode.Selection(new vscode.Position(1, 2), new vscode.Position(1, 2));
        await vscode.commands.executeCommand('type', { text: '<item' });
        await vscode.commands.executeCommand('type', { text: '>' });
        await waitFor(() => document.lineAt(1).text.includes('</item>') ? true : undefined, 'the inserted end tag', 3_000);
        assert.equal(document.lineAt(1).text, '  <item></item>');
        // Selection updates reach the extension host after the document change, so wait for them too.
        await waitFor(() => editor.selection.active.isEqual(new vscode.Position(1, 8)) ? true : undefined,
            'the cursor to stay between the tags', 3_000)
            .catch(error => {
                throw new Error(`${error instanceof Error ? error.message : String(error)} Cursor: ${editor.selection.active.line}:${editor.selection.active.character}.`);
            });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }],

    ['offers XML Schema vocabulary in .xsd files', async () => {
        const document = await open('schemas/catalog.xsd');
        const editor = vscode.window.activeTextEditor!;
        await editor.edit(edit => edit.insert(positionAfter(document, '<xs:sequence>'), '<'));
        const labels = await completionLabels(document, positionAfter(document, '<xs:sequence><'), '<');
        assert.ok(labels.includes('xs:element'), labels.join(', '));
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }],

    ['leaves extensions outside xmlEditor.fileExtensions alone', async () => {
        const document = await open('malformed.csproj');
        assert.equal(document.languageId, 'xml');
        await new Promise(resolve => setTimeout(resolve, 1_000));
        assert.deepEqual(xmlDiagnostics(document.uri), []);
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true });
        assert.ok(edits === undefined || edits.length === 0);
    }]
];

export async function run(): Promise<void> {
    const failures: string[] = [];
    for (const [name, check] of checks) {
        try {
            await check();
            console.log(`  ✔ ${name}`);
        }
        catch (error) {
            failures.push(name);
            console.error(`  ✖ ${name}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }
    }

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    if (failures.length > 0) {
        throw new Error(`${failures.length} of ${checks.length} integration checks failed.`);
    }
}
