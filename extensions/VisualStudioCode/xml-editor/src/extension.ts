import * as vscode from 'vscode';

import { associateSchema } from './services/associateSchema';
import { AutoCloseTags } from './services/autoCloseTags';
import { DiagnosticsController } from './services/diagnostics';
import { DocumentCache, configurationSection, createDocumentSelector } from './services/documents';
import { LanguageFeatureRegistration } from './services/languageFeatures';
import { SchemaService } from './services/schemaService';

export function activate(context: vscode.ExtensionContext): void {
    const log = vscode.window.createOutputChannel('XML Editor', { log: true });
    const documents = new DocumentCache();
    const schemas = new SchemaService(context, log);
    const features = new LanguageFeatureRegistration(documents, schemas);

    let selector = createDocumentSelector();
    const isServed = (document: vscode.TextDocument): boolean => vscode.languages.match(selector, document) > 0;
    features.register(selector);

    const diagnostics = new DiagnosticsController(documents, schemas, isServed);

    context.subscriptions.push(
        log,
        documents,
        schemas,
        features,
        diagnostics,
        new AutoCloseTags(isServed),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`${configurationSection}.fileExtensions`)) {
                selector = createDocumentSelector();
                features.register(selector);
                diagnostics.validateAll();
            }
        }),
        vscode.commands.registerCommand('xmlEditor.associateSchema', associateSchema),
        vscode.commands.registerCommand('xmlEditor.reloadSchemas', () => {
            schemas.reload();
            void vscode.window.showInformationMessage('XML schemas reloaded.');
        }));

    diagnostics.validateAll();
}

export function deactivate(): void {
}
