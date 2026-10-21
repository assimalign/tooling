import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

import { SchemaLoader, SchemaSet } from '../src/core/schema';

/** Test sources live beside the compiled tests' parent: out/test -> test. */
export const fixturesDirectory = path.join(__dirname, '..', '..', 'test', 'fixtures');
export const bundledSchemaPath = path.join(__dirname, '..', '..', 'schemas', 'XMLSchema.xsd');

export function fixtureUri(name: string): string {
    return pathToFileURL(path.join(fixturesDirectory, name)).toString();
}

export function fileFetcher(uri: string): Promise<string> {
    return fs.promises.readFile(new URL(uri), 'utf8');
}

export function loadFixtures(...names: string[]): Promise<SchemaSet> {
    return new SchemaLoader(fileFetcher).load(names.map(fixtureUri));
}

export function loadBundledSchema(): Promise<SchemaSet> {
    return new SchemaLoader(fileFetcher).load([pathToFileURL(bundledSchemaPath).toString()]);
}

/** Splits text at the `|` cursor marker. */
export function cursor(textWithCursor: string): { text: string; offset: number } {
    const offset = textWithCursor.indexOf('|');
    if (offset === -1) {
        throw new Error('The text has no | cursor marker.');
    }

    return { text: textWithCursor.slice(0, offset) + textWithCursor.slice(offset + 1), offset };
}
