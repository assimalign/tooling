/**
 * Pins the generated static MSBuild schema in schemas/ together with the XML editor behavior it
 * relies on: open vocabularies through skip wildcards, chameleon includes for the 2003 namespace,
 * root element selection, and suggest-only enumerations.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import {
    SchemaLoader,
    SchemaSetType,
    cursor,
    fileFetcher,
    fixturesDirectory,
    getCompletions,
    getHover,
    parseXml,
    schemaUri,
    validateDocument
} from './helpers';

const samplesDirectory = path.join(fixturesDirectory, 'samples');

// Legacy projects get both entry points (the extension picks one by namespace; loading both also
// proves they coexist), so the tests load them together.
const loadMSBuildSchemas = (): Promise<SchemaSetType> =>
    new SchemaLoader(fileFetcher).load([schemaUri('Microsoft.Build.xsd'), schemaUri('Microsoft.Build.Namespaced.xsd')]);

function messages(fileName: string, schemas: SchemaSetType): string[] {
    return validateDocument(parseXml(fs.readFileSync(path.join(samplesDirectory, fileName), 'utf8')), schemas)
        .map(diagnostic => diagnostic.message);
}

function labels(textWithCursor: string, schemas: SchemaSetType): string[] {
    const { text, offset } = cursor(textWithCursor);
    return getCompletions(parseXml(text), offset, schemas).map(suggestion => suggestion.label);
}

describe('static MSBuild schema', () => {
    it('loads without problems in both namespaces', async () => {
        const schemas = await loadMSBuildSchemas();

        assert.deepEqual(schemas.problems, []);
        assert.ok(schemas.element('', 'Project'));
        assert.ok(schemas.element('http://schemas.microsoft.com/developer/msbuild/2003', 'Project'));
    });

    it('accepts the valid samples, including custom names and metadata attributes', async () => {
        const schemas = await loadMSBuildSchemas();
        for (const fileName of ['Sample.csproj', 'Directory.Build.props', 'Build.targets', 'Legacy.csproj']) {
            assert.deepEqual(messages(fileName, schemas), [], fileName);
        }
    });

    it('reports the mistakes in Mistakes.csproj', async () => {
        assert.deepEqual(messages('Mistakes.csproj', await loadMSBuildSchemas()), [
            'Attribute \'Conditon\' is not allowed on \'PropertyGroup\'.',
            'Element \'Target\' is missing required attribute \'Name\'.',
            'Attribute \'Txt\' is not allowed on \'Message\'.',
            'Attribute \'Projct\' is not allowed on \'Import\'.',
            'Element \'Import\' is missing required attribute \'Project\'.'
        ]);
    });

    it('offers only Project at the root, once per namespace', async () => {
        const { text, offset } = cursor('<|');
        const suggestions = getCompletions(parseXml(text), offset, await loadMSBuildSchemas());

        // The no-namespace (SDK-style) Project, and the legacy one that declares the 2003 namespace.
        assert.deepEqual(suggestions.map(suggestion => suggestion.label), ['Project', 'Project']);
        assert.deepEqual(suggestions.map(suggestion => suggestion.insertText.includes('xmlns=')).sort(), [false, true]);
    });

    it('offers properties, items, and tasks where each belongs', async () => {
        const schemas = await loadMSBuildSchemas();
        const properties = labels('<Project><PropertyGroup><|</PropertyGroup></Project>', schemas);
        const items = labels('<Project><ItemGroup><|</ItemGroup></Project>', schemas);
        const tasks = labels('<Project><Target Name="t"><|</Target></Project>', schemas);

        assert.ok(properties.includes('TargetFramework') && !properties.includes('PackageReference'));
        assert.ok(items.includes('PackageReference') && !items.includes('TargetFramework'));
        assert.ok(tasks.includes('Message') && tasks.includes('Copy') && !tasks.includes('TargetFramework'));
    });

    it('suggests enumerated and boolean property values without enforcing them', async () => {
        const schemas = await loadMSBuildSchemas();

        assert.deepEqual(labels('<Project><PropertyGroup><Nullable>|</Nullable></PropertyGroup></Project>', schemas), ['enable', 'disable', 'warnings', 'annotations']);
        assert.deepEqual(labels('<Project><PropertyGroup><Optimize>|</Optimize></PropertyGroup></Project>', schemas), ['true', 'false']);
        assert.deepEqual(validateDocument(parseXml(
            '<Project><PropertyGroup><Nullable Condition="true">$(Choice)</Nullable><Optimize>on</Optimize></PropertyGroup></Project>'), schemas), []);
    });

    it('shows property documentation on hover', async () => {
        const { text, offset } = cursor('<Project><PropertyGroup><TargetFr|amework>net10.0</TargetFramework></PropertyGroup></Project>');
        const hover = getHover(parseXml(text), offset, await loadMSBuildSchemas());

        assert.match(hover!.contents, /Framework that this project targets/);
    });
});
