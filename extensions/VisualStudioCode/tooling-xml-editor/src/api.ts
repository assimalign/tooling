/**
 * The API this extension returns from `activate`, for extensions that build on it.
 *
 * A dependent extension lists `assimalign.tooling-xml-editor` in `extensionDependencies` and reads
 * the API with:
 *
 *     const api = await vscode.extensions.getExtension<XmlEditorApi>('assimalign.tooling-xml-editor')!.activate();
 *
 * Import these types with `import type` only; the dependent extension must not load this package's
 * code at run time except through the returned object.
 */

import type * as vscode from 'vscode';

import type { XmlDocument } from './core/parser';

export type {
    XmlAttribute,
    XmlDiagnostic,
    XmlDocument,
    XmlElement,
    XmlLeaf,
    XmlNode
} from './core/parser';

/** A schema for a document: a URI the editor can read, or a URI plus in-memory content. */
export interface XmlSchemaSource {
    /**
     * Identifies the schema. With `content`, any unique URI works and the editor never reads it;
     * when the content for a URI changes, the editor reloads that schema.
     */
    readonly uri: string;
    readonly content?: string | undefined;
}

export interface XmlSchemaProvider {
    /**
     * The documents this provider supplies schemas for. The editor serves these documents
     * (completion, hover, validation, formatting) whether or not `xmlEditor.fileExtensions` lists them.
     */
    readonly selector: vscode.DocumentSelector;

    /** Schemas for a document, in addition to those from the user's settings and `xsi` hints. */
    provideSchemas(document: vscode.TextDocument, xml: XmlDocument): Promise<readonly XmlSchemaSource[]> | readonly XmlSchemaSource[];

    /** Fire when schemas for open documents may have changed, so the editor re-validates them. */
    readonly onDidChangeSchemas?: vscode.Event<void>;
}

export interface XmlEditorApi {
    readonly apiVersion: 1;

    /** The tolerant, position-preserving parser the editor itself uses. */
    parseXml(text: string): XmlDocument;

    registerSchemaProvider(provider: XmlSchemaProvider): vscode.Disposable;
}
