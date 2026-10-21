/**
 * End-to-end checks inside VS Code against test/fixtures: the static schema for MSBuild files with
 * no settings, and import-chain IntelliSense in the viu-shaped fixture repository.
 */

import * as assert from 'assert';

import * as vscode from 'vscode';

const workspaceFolder = (): vscode.Uri => vscode.workspace.workspaceFolders![0]!.uri;

async function open(relativePath: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceFolder(), relativePath));
    await vscode.window.showTextDocument(document);
    return document;
}

async function waitFor<TValue>(read: () => Promise<TValue | undefined> | TValue | undefined, description: string, timeoutMilliseconds = 10_000): Promise<TValue> {
    const deadline = Date.now() + timeoutMilliseconds;
    let last: TValue | undefined;
    while (Date.now() < deadline) {
        last = await read();
        if (last !== undefined) {
            return last;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    throw new Error(`Timed out waiting for ${description}.`);
}

async function completions(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, position, '<');
    return list.items;
}

const label = (item: vscode.CompletionItem): string => typeof item.label === 'string' ? item.label : item.label.label;

const xmlDiagnostics = (uri: vscode.Uri): string[] =>
    vscode.languages.getDiagnostics(uri).filter(diagnostic => diagnostic.source === 'xml').map(diagnostic => diagnostic.message);

/** Puts `<` inside the document's empty PropertyGroup and returns the position after it. */
async function openPropertyGroup(document: vscode.TextDocument): Promise<vscode.Position> {
    const editor = await vscode.window.showTextDocument(document);
    const offset = document.getText().indexOf('<PropertyGroup>') + '<PropertyGroup>'.length;
    await editor.edit(edit => edit.insert(document.positionAt(offset), '<'));
    return document.positionAt(offset + 1);
}

const checks: [string, () => Promise<void>][] = [
    ['validates MSBuild files against the static schema without any settings', async () => {
        const document = await open('samples/Mistakes.csproj');
        const messages = await waitFor(() => xmlDiagnostics(document.uri).length > 0 ? xmlDiagnostics(document.uri) : undefined, 'diagnostics');
        assert.equal(messages.length, 5, messages.join('\n'));
    }],

    ['offers custom properties from the import chain', async () => {
        const document = await open('repo/libraries/Runtime/Directory.Build.props');
        const position = await openPropertyGroup(document);
        const items = await completions(document, position);
        const labels = items.map(label);

        for (const expected of ['RepoVersion', 'RepoRoot', 'RepoShared', 'RepoIsLibrary', 'TargetFramework']) {
            assert.ok(labels.includes(expected), `${expected} in ${labels.length} items`);
        }
        assert.ok(!labels.includes('RepoOptionalOnly'), 'condition-guarded import is not followed');

        const version = items.find(item => label(item) === 'RepoVersion')!;
        const documentation = version.documentation instanceof vscode.MarkdownString ? version.documentation.value : String(version.documentation);
        assert.match(documentation, /Version stamped into every package/);
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }],

    ['picks up unsaved edits in an imported file', async () => {
        const imported = await open('repo/build/Targets/Build.Version.props');
        const importedEditor = vscode.window.activeTextEditor!;
        const offset = imported.getText().indexOf('<RepoVersion>');
        await importedEditor.edit(edit => edit.insert(imported.positionAt(offset), '<RepoAddedWhileEditing>x</RepoAddedWhileEditing>\n    '));

        const document = await open('repo/libraries/Runtime/Directory.Build.props');
        const position = await openPropertyGroup(document);
        await waitFor(async () => (await completions(document, position)).some(item => label(item) === 'RepoAddedWhileEditing') ? true : undefined,
            'the new property to appear', 5_000);

        await vscode.commands.executeCommand('workbench.action.files.revert');
        await vscode.window.showTextDocument(imported);
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }],

    ['validates the fixture project without false errors', async () => {
        const document = await open('repo/libraries/Runtime/Runtime.csproj');
        await new Promise(resolve => setTimeout(resolve, 1_500));
        assert.deepEqual(xmlDiagnostics(document.uri), []);
    }],

    ['registers the Show Import Chain command', async () => {
        assert.ok((await vscode.commands.getCommands(true)).includes('msbuildExtensions.showImportChain'));
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
