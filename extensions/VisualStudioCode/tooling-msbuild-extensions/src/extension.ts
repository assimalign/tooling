import * as vscode from 'vscode';

import type { XmlEditorApi } from '../../tooling-xml-editor/src/api';
import { ContextFile, UnresolvedImport } from './core/importChain';
import { relativePath } from './core/paths';
import { MSBuildSchemaProvider, configurationSection } from './services/contextSchemaProvider';

const xmlEditorExtensionId = 'assimalign.tooling-xml-editor';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const log = vscode.window.createOutputChannel('MSBuild Extensions', { log: true });
    context.subscriptions.push(log);

    const xmlEditor = vscode.extensions.getExtension<XmlEditorApi>(xmlEditorExtensionId);
    if (xmlEditor === undefined) {
        void vscode.window.showErrorMessage(`MSBuild Extensions needs the ${xmlEditorExtensionId} extension.`);
        return;
    }

    const api = await xmlEditor.activate();
    let provider = new MSBuildSchemaProvider(context, api, log);
    let registration = api.registerSchemaProvider(provider);

    context.subscriptions.push(
        { dispose: () => { registration.dispose(); provider.dispose(); } },
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`${configurationSection}.fileExtensions`)) {
                // The selector is fixed per provider, so a new one replaces it.
                registration.dispose();
                provider.dispose();
                provider = new MSBuildSchemaProvider(context, api, log);
                registration = api.registerSchemaProvider(provider);
            }
        }),
        vscode.commands.registerCommand('msbuildExtensions.showImportChain', () => showImportChain(provider)));
}

interface ChainPick extends vscode.QuickPickItem {
    readonly path?: string;
}

async function showImportChain(provider: MSBuildSchemaProvider): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || vscode.languages.match(provider.selector, editor.document) === 0) {
        void vscode.window.showWarningMessage('Open an MSBuild file to see its import chain.');
        return;
    }

    const document = editor.document;
    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.path;
    const chain = await provider.importChain(document);
    const describe = (filePath: string): string => relativePath(filePath, root);
    const origin = (file: ContextFile): string => {
        switch (file.origin) {
            case 'document': return 'this file';
            case 'implicit': return 'imported implicitly by MSBuild';
            case 'additional': return 'from msbuildExtensions.importChain.additionalFiles';
            default: return `imported by ${describe(file.importedBy ?? '')}`;
        }
    };
    const unresolved = (entry: UnresolvedImport): ChainPick => ({
        label: `$(warning) ${entry.project}`,
        description: `in ${describe(entry.file)}`,
        detail: entry.reason
    });

    const picks: ChainPick[] = [
        { label: 'Files', kind: vscode.QuickPickItemKind.Separator },
        ...chain.files.map(file => ({ label: describe(file.path), description: origin(file), path: file.path })),
        ...(chain.unresolved.length === 0 ? [] : [
            { label: 'Not followed', kind: vscode.QuickPickItemKind.Separator },
            ...chain.unresolved.map(unresolved)
        ])
    ];
    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: `${chain.files.length} files contribute to IntelliSense in ${describe(document.uri.path)}`,
        matchOnDescription: true
    });
    if (picked?.path !== undefined) {
        await vscode.window.showTextDocument(document.uri.with({ path: picked.path }));
    }
}

export function deactivate(): void {
}
