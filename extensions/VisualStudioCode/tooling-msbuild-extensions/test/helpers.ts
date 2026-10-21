/**
 * Test access to the XML editor. Production code only sees the XML editor through its API object;
 * tests load its compiled modules directly, which `npm test` builds first through the project reference.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

import type * as CompletionModule from '../../tooling-xml-editor/src/core/completion';
import type * as HoverModule from '../../tooling-xml-editor/src/core/hover';
import type * as ParserModule from '../../tooling-xml-editor/src/core/parser';
import type * as SchemaModule from '../../tooling-xml-editor/src/core/schema';
import type * as ValidationModule from '../../tooling-xml-editor/src/core/validation';
import { MSBuildFileSystem } from '../src/core/expressions';

const xmlEditorOutput = path.resolve(__dirname, '..', '..', '..', 'tooling-xml-editor', 'out', 'src', 'core');

function load<TModule>(name: string): TModule {
    return require(path.join(xmlEditorOutput, name)) as TModule;
}

export const { getCompletions } = load<typeof CompletionModule>('completion');
export const { getHover } = load<typeof HoverModule>('hover');
export const { parseXml } = load<typeof ParserModule>('parser');
export const { SchemaLoader, SchemaSet } = load<typeof SchemaModule>('schema');
export const { validateDocument } = load<typeof ValidationModule>('validation');
export type SchemaSetType = SchemaModule.SchemaSet;

export const packageDirectory = path.join(__dirname, '..', '..');
export const fixturesDirectory = path.join(packageDirectory, 'test', 'fixtures');
export const schemaDirectory = path.join(packageDirectory, 'schemas');

export function schemaUri(name: string): string {
    return pathToFileURL(path.join(schemaDirectory, name)).toString();
}

export function fileFetcher(uri: string): Promise<string> {
    return fs.promises.readFile(new URL(uri), 'utf8');
}

/** Reads the real disk with URI-style paths, as the import chain expects. */
export const nodeFileSystem: MSBuildFileSystem = {
    readFile: async filePath => {
        try {
            return await fs.promises.readFile(filePath, 'utf8');
        }
        catch {
            return undefined;
        }
    },
    exists: async filePath => fs.existsSync(filePath),
    readDirectory: async directory => {
        try {
            return (await fs.promises.readdir(directory, { withFileTypes: true }))
                .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }));
        }
        catch {
            return undefined;
        }
    }
};

/** Splits text at the `|` cursor marker. */
export function cursor(textWithCursor: string): { text: string; offset: number } {
    const offset = textWithCursor.indexOf('|');
    if (offset === -1) {
        throw new Error('The text has no | cursor marker.');
    }

    return { text: textWithCursor.slice(0, offset) + textWithCursor.slice(offset + 1), offset };
}
