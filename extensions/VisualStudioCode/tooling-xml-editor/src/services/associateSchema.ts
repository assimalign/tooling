import * as path from 'path';

import * as vscode from 'vscode';

import { configurationSection } from './documents';
import { SchemaAssociation } from './schemaService';

interface SchemaPick extends vscode.QuickPickItem {
    readonly uri?: vscode.Uri;
    readonly action?: 'browse' | 'url';
}

interface PatternPick extends vscode.QuickPickItem {
    readonly pattern: string;
}

interface TargetPick extends vscode.QuickPickItem {
    readonly target: vscode.ConfigurationTarget;
}

/**
 * `XML: Associate Schema with Current File`: picks a schema and a file pattern, then appends an
 * entry to `xmlEditor.schemas` in the workspace folder's `.vscode/settings.json` or in the user
 * `settings.json`.
 */
export async function associateSchema(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
        void vscode.window.showWarningMessage('Open an XML document to associate a schema with it.');
        return;
    }

    const document = editor.document;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const fileName = path.posix.basename(document.uri.path);

    const schemaFiles = await vscode.workspace.findFiles('**/*.xsd', '**/node_modules/**', 500);
    const schemaPick = await vscode.window.showQuickPick<SchemaPick>([
        ...schemaFiles
            .sort((left, right) => left.path.localeCompare(right.path))
            .map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })),
        { label: '$(folder-opened) Browse...', action: 'browse', alwaysShow: true },
        { label: '$(globe) Enter a URL...', action: 'url', alwaysShow: true }
    ], { placeHolder: `Select the XML Schema for ${fileName}` });
    if (schemaPick === undefined) {
        return;
    }

    let schema: vscode.Uri | string | undefined = schemaPick.uri;
    if (schemaPick.action === 'browse') {
        const selected = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'XML Schema': ['xsd'], 'All files': ['*'] },
            ...(folder === undefined ? {} : { defaultUri: folder.uri })
        });
        schema = selected?.[0];
    }
    else if (schemaPick.action === 'url') {
        schema = await vscode.window.showInputBox({
            prompt: 'The http(s) URL of the schema',
            placeHolder: 'https://example.com/schema.xsd',
            validateInput: value => /^https?:\/\/\S+$/i.test(value.trim()) ? undefined : 'Enter an http:// or https:// URL.'
        });
    }
    if (schema === undefined) {
        return;
    }

    const extension = path.posix.extname(fileName);
    const relativePath = folder === undefined ? fileName : path.posix.relative(folder.uri.path, document.uri.path);
    const patterns: PatternPick[] = [
        { label: relativePath, description: 'This file only', pattern: relativePath },
        { label: fileName, description: 'Files with this name in any folder', pattern: fileName }
    ];
    if (extension.length > 0) {
        patterns.push({ label: `**/*${extension}`, description: `Every ${extension} file`, pattern: `**/*${extension}` });
    }
    const patternPick = await vscode.window.showQuickPick(patterns, { placeHolder: 'Which documents should use this schema?' });
    if (patternPick === undefined) {
        return;
    }

    const targets: TargetPick[] = [];
    if (folder !== undefined) {
        targets.push({ label: 'Workspace', description: '.vscode/settings.json', target: vscode.ConfigurationTarget.WorkspaceFolder });
    }
    targets.push({ label: 'User', description: 'settings.json', target: vscode.ConfigurationTarget.Global });
    const targetPick = targets.length === 1 ? targets[0] : await vscode.window.showQuickPick(targets, { placeHolder: 'Where should the association be saved?' });
    if (targetPick === undefined) {
        return;
    }

    const url = typeof schema === 'string'
        ? schema.trim()
        : schemaSettingPath(schema, targetPick.target === vscode.ConfigurationTarget.Global ? undefined : folder);
    const configuration = vscode.workspace.getConfiguration(configurationSection, folder?.uri ?? document.uri);
    const inspected = configuration.inspect<SchemaAssociation[]>('schemas');
    const existing = (targetPick.target === vscode.ConfigurationTarget.Global ? inspected?.globalValue : inspected?.workspaceFolderValue) ?? [];
    await configuration.update('schemas', [...existing, { fileMatch: [patternPick.pattern], url }], targetPick.target);

    void vscode.window.showInformationMessage(`Associated ${url} with ${patternPick.pattern}.`);
}

/** A workspace-relative `./path` for schemas inside the folder, otherwise an absolute path. */
function schemaSettingPath(schema: vscode.Uri, folder: vscode.WorkspaceFolder | undefined): string {
    if (folder !== undefined && schema.scheme === folder.uri.scheme) {
        const relative = path.posix.relative(folder.uri.path, schema.path);
        if (!relative.startsWith('..') && !path.posix.isAbsolute(relative)) {
            return `./${relative}`;
        }
    }

    return schema.scheme === 'file' ? schema.fsPath : schema.toString();
}
