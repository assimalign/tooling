import * as vscode from 'vscode';

import {
    DiagnosticSeverity,
    XSI_NAMESPACE,
    XmlDiagnostic,
    XmlDocument,
    attributeNamespace,
    schemaLocationHints
} from '../core/parser';
import { SchemaSet } from '../core/schema';
import { validateDocument } from '../core/validation';
import { DocumentCache, configurationSection } from './documents';
import { SchemaService } from './schemaService';

const validationDelayMilliseconds = 300;

const severities: Record<DiagnosticSeverity, vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information
};

/** Validates served documents as they open and change, debounced per document. */
export class DiagnosticsController implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('xml-editor');
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly documents: DocumentCache,
        private readonly schemas: SchemaService,
        private readonly isServed: (document: vscode.TextDocument) => boolean) {
        this.disposables.push(
            this.collection,
            vscode.workspace.onDidOpenTextDocument(document => this.schedule(document, 0)),
            vscode.workspace.onDidChangeTextDocument(event => this.schedule(event.document, validationDelayMilliseconds)),
            vscode.workspace.onDidCloseTextDocument(document => this.clear(document.uri)),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(`${configurationSection}.validation`)) {
                    this.validateAll();
                }
            }),
            schemas.onDidChange(() => this.validateAll()));
    }

    public validateAll(): void {
        for (const document of vscode.workspace.textDocuments) {
            this.schedule(document, 0);
        }
    }

    private schedule(document: vscode.TextDocument, delay: number): void {
        const key = document.uri.toString();
        const pending = this.timers.get(key);
        if (pending !== undefined) {
            clearTimeout(pending);
        }

        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            void this.validate(document);
        }, delay));
    }

    private clear(uri: vscode.Uri): void {
        const key = uri.toString();
        const pending = this.timers.get(key);
        if (pending !== undefined) {
            clearTimeout(pending);
            this.timers.delete(key);
        }
        this.collection.delete(uri);
    }

    private async validate(document: vscode.TextDocument): Promise<void> {
        const enabled = vscode.workspace.getConfiguration(configurationSection, document.uri).get<boolean>('validation.enabled', true);
        if (document.isClosed || !enabled || !this.isServed(document)) {
            this.collection.delete(document.uri);
            return;
        }

        const version = document.version;
        const xml = this.documents.get(document);
        const schemas = await this.schemas.schemasFor(document, xml).catch(() => undefined);
        if (document.isClosed || document.version !== version) {
            return;
        }

        const diagnostics = validateDocument(xml, schemas).map(diagnostic => toDiagnostic(document, diagnostic));
        diagnostics.push(...schemaProblems(document, xml, schemas));
        this.collection.set(document.uri, diagnostics);
    }

    public dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

function toDiagnostic(document: vscode.TextDocument, diagnostic: XmlDiagnostic): vscode.Diagnostic {
    const range = new vscode.Range(document.positionAt(diagnostic.start), document.positionAt(Math.max(diagnostic.end, diagnostic.start)));
    const result = new vscode.Diagnostic(range, diagnostic.message, severities[diagnostic.severity]);
    result.source = 'xml';
    return result;
}

/**
 * Surfaces schemas that failed to load as warnings, placed on the `xsi:schemaLocation` attribute
 * that named them when there is one, otherwise on the root element.
 */
function schemaProblems(document: vscode.TextDocument, xml: XmlDocument, schemas: SchemaSet | undefined): vscode.Diagnostic[] {
    if (schemas === undefined || schemas.problems.length === 0 || xml.root === undefined) {
        return [];
    }

    const root = xml.root;
    const hintAttribute = root.attributes.find(attribute => attributeNamespace(root, attribute) === XSI_NAMESPACE
        && /(^|:)(schemaLocation|noNamespaceSchemaLocation)$/.test(attribute.name));
    const anchor = hintAttribute !== undefined && schemaLocationHints(xml).length > 0
        ? { start: hintAttribute.nameStart, end: hintAttribute.valueEnd ?? hintAttribute.nameEnd }
        : { start: root.nameStart, end: root.nameEnd };
    const range = new vscode.Range(document.positionAt(anchor.start), document.positionAt(anchor.end));

    return schemas.problems.map(problem => {
        const diagnostic = new vscode.Diagnostic(range, `Schema ${problem.uri}: ${problem.message}`, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = 'xml';
        return diagnostic;
    });
}
