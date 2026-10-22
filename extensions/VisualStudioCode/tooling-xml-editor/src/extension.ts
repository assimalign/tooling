import * as vscode from 'vscode';

import { XmlEditorApi } from './api';
import { parseXml } from './core/parser';
import { associateSchema } from './services/associateSchema';
import { AutoCloseTags } from './services/autoCloseTags';
import { DiagnosticsController } from './services/diagnostics';
import { DocumentCache, configurationSection, createDocumentSelector } from './services/documents';
import { LanguageFeatureRegistration } from './services/languageFeatures';
import { SchemaService } from './services/schemaService';

export function activate(context: vscode.ExtensionContext): XmlEditorApi {
    const log = vscode.window.createOutputChannel('XML Editor', { log: true });
    const documents = new DocumentCache();
    const schemas = new SchemaService(context, log);
    const features = new LanguageFeatureRegistration(documents, schemas);

    // The served documents are the configured file extensions plus whatever schema providers serve.
    let selector: vscode.DocumentFilter[] = [];
    const isServed = (document: vscode.TextDocument): boolean => vscode.languages.match(selector, document) > 0;
    const updateSelector = (): void => {
        selector = [...createDocumentSelector(), ...schemas.providerSelector()];
        features.register(selector);
    };
    updateSelector();

    const diagnostics = new DiagnosticsController(documents, schemas, isServed);

    context.subscriptions.push(
        log,
        documents,
        schemas,
        features,
        diagnostics,
        new AutoCloseTags(isServed),
        schemas.onDidChangeProviders(() => {
            updateSelector();
            diagnostics.validateAll();
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`${configurationSection}.fileExtensions`)) {
                updateSelector();
                diagnostics.validateAll();
            }
        }),
        vscode.commands.registerCommand('xmlEditor.associateSchema', associateSchema),
        vscode.commands.registerCommand('xmlEditor.reloadSchemas', () => {
            schemas.reload();
            void vscode.window.showInformationMessage('XML schemas reloaded.');
        }));

    diagnostics.validateAll();

    return {
        apiVersion: 1,
        parseXml,
        registerSchemaProvider: provider => schemas.registerProvider(provider)
    };
}

export function deactivate(): void {
}
