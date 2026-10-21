import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { resolveImportChain } from '../src/core/importChain';
import { generateContextSchema, msbuildNamespace, readStaticElementNames } from '../src/core/schemaGenerator';
import { collectVocabulary } from '../src/core/vocabulary';
import {
    SchemaLoader,
    SchemaSetType,
    cursor,
    fileFetcher,
    fixturesDirectory,
    getCompletions,
    getHover,
    nodeFileSystem,
    parseXml,
    schemaDirectory,
    schemaUri,
    validateDocument
} from './helpers';

const repository = path.join(fixturesDirectory, 'repo');
const staticNames = readStaticElementNames(
    ['Microsoft.Build.Core.xsd', 'Microsoft.Build.CommonTypes.xsd'].map(name => fs.readFileSync(path.join(schemaDirectory, 'MSBuild', name), 'utf8')),
    parseXml);

/** The static schema plus the schema generated for `relativePath`, loaded the way the extension does. */
async function schemasFor(relativePath: string, documentText?: string, namespace?: string): Promise<{ schemas: SchemaSetType; generated: string }> {
    const documentPath = path.join(repository, relativePath);
    const chain = await resolveImportChain(documentPath, {
        fileSystem: nodeFileSystem,
        parseXml,
        documentText: documentText ?? fs.readFileSync(documentPath, 'utf8'),
        implicitImports: true
    });
    const generated = generateContextSchema(collectVocabulary(chain.files), {
        namespace,
        staticNames,
        describePath: file => path.relative(repository, file).replace(/\\/g, '/'),
        description: 'test',
        documentPath
    });

    const staticUri = schemaUri(namespace === undefined ? 'Microsoft.Build.xsd' : 'Microsoft.Build.Namespaced.xsd');
    const loader = new SchemaLoader(uri => uri === 'memory:generated.xsd' ? Promise.resolve(generated) : fileFetcher(uri));
    return { schemas: await loader.load([staticUri, 'memory:generated.xsd']), generated };
}

function complete(schemas: SchemaSetType, textWithCursor: string): ReturnType<typeof getCompletions> {
    const { text, offset } = cursor(textWithCursor);
    return getCompletions(parseXml(text), offset, schemas);
}

describe('context schema', () => {
    it('is a valid schema that loads beside the static one', async () => {
        const { schemas } = await schemasFor('libraries/Runtime/Directory.Build.props');

        assert.deepEqual(schemas.problems, []);
    });

    it('offers custom properties from the whole import chain, with their documentation', async () => {
        const { schemas } = await schemasFor('libraries/Runtime/Directory.Build.props');
        const suggestions = complete(schemas, '<Project><PropertyGroup><|</PropertyGroup></Project>');
        const labels = suggestions.map(suggestion => suggestion.label);

        for (const expected of ['RepoRoot', 'RepoOutputPath', 'RepoVersion', 'RepoVersionSuffix', 'RepoIsLibrary', 'RepoShared', 'RepoPackEnabled', 'TargetFramework']) {
            assert.ok(labels.includes(expected), expected);
        }
        for (const excluded of ['RepoOptionalOnly', 'RepoConsumerOnly', 'MSBuildThisFileDirectory']) {
            assert.ok(!labels.includes(excluded), excluded);
        }

        const version = suggestions.find(suggestion => suggestion.label === 'RepoVersion')!;
        assert.equal(version.documentation, 'Version stamped into every package.\n\nSet in `build/Targets/Build.Version.props`.\n\nValue: `1.2.3`');
        assert.match(suggestions.find(suggestion => suggestion.label === 'RepoPackEnabled')!.documentation!, /Read in `build\/Targets\/Build.Packaging.targets`; not set/);
    });

    it('offers custom items with their metadata as elements and attributes', async () => {
        const { schemas } = await schemasFor('libraries/Runtime/Directory.Build.props');

        assert.ok(complete(schemas, '<Project><ItemGroup><|</ItemGroup></Project>').some(suggestion => suggestion.label === 'RepoPackageFile'));
        assert.deepEqual(complete(schemas, '<Project><ItemGroup><RepoPackageFile Include="x"><|</RepoPackageFile></ItemGroup></Project>')
            .filter(suggestion => suggestion.kind === 'element').map(suggestion => suggestion.label), ['PackagePath', 'Signed']);
        assert.ok(complete(schemas, '<Project><ItemGroup><RepoPackageFile |/></ItemGroup></Project>').some(suggestion => suggestion.label === 'Signed'));
    });

    it('offers custom tasks with their parameters', async () => {
        const { schemas } = await schemasFor('libraries/Runtime/Directory.Build.props');
        const tasks = complete(schemas, '<Project><Target Name="t"><|</Target></Project>').map(suggestion => suggestion.label);
        const parameters = complete(schemas, '<Project><Target Name="t"><StampVersion |/></Target></Project>');

        assert.ok(tasks.includes('StampVersion') && tasks.includes('Message'));
        assert.deepEqual(parameters.filter(suggestion => suggestion.detail?.includes('required')).map(suggestion => suggestion.label), ['Version']);
        assert.ok(parameters.some(suggestion => suggestion.label === 'Overwrite'), 'parameters used at call sites');
    });

    it('describes custom properties on hover', async () => {
        const { schemas } = await schemasFor('libraries/Runtime/Directory.Build.props');
        const { text, offset } = cursor('<Project><PropertyGroup><RepoRo|ot>x</RepoRoot></PropertyGroup></Project>');

        assert.match(getHover(parseXml(text), offset, schemas)!.contents, /The repository root, with a trailing slash\./);
    });

    it('validates the fixture repository without false errors', async () => {
        for (const file of ['libraries/Runtime/Directory.Build.props', 'libraries/Runtime/Runtime.csproj', 'build/Targets/Build.Packaging.targets', 'tools/Tool.csproj']) {
            const text = fs.readFileSync(path.join(repository, file), 'utf8');
            const { schemas } = await schemasFor(file, text);
            assert.deepEqual(validateDocument(parseXml(text), schemas).map(diagnostic => diagnostic.message), [], file);
        }
    });

    it('accepts Condition on custom metadata', async () => {
        const text = '<Project><Import Project="..\\Directory.Build.props" /><ItemGroup><RepoPackageFile Include="x"><Signed Condition="true">true</Signed></RepoPackageFile></ItemGroup></Project>';
        const { schemas } = await schemasFor('libraries/Runtime/Directory.Build.props', text);

        assert.deepEqual(validateDocument(parseXml(text), schemas), []);
    });

    it('still reports a missing required parameter of a custom task', async () => {
        const text = '<Project><Import Project="..\\Directory.Build.props" /><Target Name="t"><StampVersion OutputFile="x" /></Target></Project>';
        const { schemas } = await schemasFor('libraries/Runtime/Directory.Build.props', text);

        assert.deepEqual(validateDocument(parseXml(text), schemas).map(diagnostic => diagnostic.message), [
            'Element \'StampVersion\' is missing required attribute \'Version\'.'
        ]);
    });

    it('targets the 2003 namespace for legacy projects', async () => {
        const text = `<Project xmlns="${msbuildNamespace}"><Import Project="..\\Directory.Build.props" /><PropertyGroup></PropertyGroup></Project>`;
        const { schemas, generated } = await schemasFor('libraries/Runtime/Directory.Build.props', text, msbuildNamespace);

        assert.match(generated, /targetNamespace="http:\/\/schemas.microsoft.com\/developer\/msbuild\/2003"/);
        assert.ok(complete(schemas, `<Project xmlns="${msbuildNamespace}"><PropertyGroup><|</PropertyGroup></Project>`).some(suggestion => suggestion.label === 'RepoVersion'));
    });

    it('offers private (_-prefixed) names only in a file that uses them', async () => {
        const privateUse = '<Project><Import Project="..\\Directory.Build.props" /><PropertyGroup><_RepoScratch>x</_RepoScratch></PropertyGroup></Project>';
        const withUse = await schemasFor('libraries/Runtime/Directory.Build.props', privateUse);
        const elsewhere = generateContextSchema(
            collectVocabulary([{ path: '/other.props', xml: parseXml('<Project><PropertyGroup><_RepoScratch>x</_RepoScratch></PropertyGroup></Project>') }]),
            { namespace: undefined, staticNames, describePath: file => file, description: 'test', documentPath: '/document.props' });

        assert.match(withUse.generated, /name="_RepoScratch"/);
        assert.doesNotMatch(elsewhere, /_RepoScratch/);
    });

    it('leaves names the static schema declares to it', async () => {
        const { generated } = await schemasFor('libraries/Runtime/Runtime.csproj');

        assert.doesNotMatch(generated, /name="TargetFramework"/);
        assert.match(generated, /name="RepoPackEnabled"/);
    });
});
