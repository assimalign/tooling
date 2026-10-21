import * as vscode from 'vscode';

import { XmlDocument, parseXml } from '../core/parser';

export const configurationSection = 'xmlEditor';

/** The file extensions enabled by default when `xmlEditor.fileExtensions` is not set. */
export const defaultFileExtensions: readonly string[] = ['.xml', '.xsd'];

/**
 * The documents this extension serves: files whose extension is listed in
 * `xmlEditor.fileExtensions`, plus unsaved XML buffers, which have no extension to match.
 */
export function createDocumentSelector(): vscode.DocumentFilter[] {
    const configured = vscode.workspace
        .getConfiguration(configurationSection)
        .get<string[]>('fileExtensions', [...defaultFileExtensions]);
    const extensions = [...new Set(configured
        .map(extension => extension.trim())
        .filter(extension => extension.length > 1)
        .map(extension => (extension.startsWith('.') ? extension.slice(1) : extension).replace(/[{}[\]*?,]/g, '')))];

    const filters: vscode.DocumentFilter[] = [{ scheme: 'untitled', language: 'xml' }];
    if (extensions.length === 1) {
        filters.push({ pattern: `**/*.${extensions[0]}` });
    }
    else if (extensions.length > 1) {
        filters.push({ pattern: `**/*.{${extensions.join(',')}}` });
    }

    return filters;
}

/** Parses documents once per version. */
export class DocumentCache implements vscode.Disposable {
    private readonly entries = new Map<string, { version: number; xml: XmlDocument }>();
    private readonly subscription: vscode.Disposable;

    public constructor() {
        this.subscription = vscode.workspace.onDidCloseTextDocument(document => this.entries.delete(document.uri.toString()));
    }

    public get(document: vscode.TextDocument): XmlDocument {
        const key = document.uri.toString();
        const cached = this.entries.get(key);
        if (cached !== undefined && cached.version === document.version) {
            return cached.xml;
        }

        const xml = parseXml(document.getText());
        this.entries.set(key, { version: document.version, xml });
        return xml;
    }

    public dispose(): void {
        this.subscription.dispose();
        this.entries.clear();
    }
}
