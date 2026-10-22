import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { ImportChain, resolveImportChain } from '../src/core/importChain';
import { fixturesDirectory, nodeFileSystem, parseXml } from './helpers';

const repository = path.join(fixturesDirectory, 'repo');

function chainFor(relativePath: string, overrides: { implicitImports?: boolean; additionalFiles?: string[]; documentText?: string } = {}): Promise<ImportChain> {
    const documentPath = path.join(repository, relativePath);
    return resolveImportChain(documentPath, {
        fileSystem: nodeFileSystem,
        parseXml,
        documentText: overrides.documentText ?? fs.readFileSync(documentPath, 'utf8'),
        implicitImports: overrides.implicitImports ?? true,
        additionalFiles: (overrides.additionalFiles ?? []).map(file => path.join(repository, file))
    });
}

const relative = (chain: ImportChain): string[] => chain.files.map(file => path.relative(repository, file.path).replace(/\\/g, '/'));

describe('resolveImportChain', () => {
    it('follows explicit imports and the implicit Directory.Build.targets, in evaluation order', async () => {
        const chain = await chainFor('libraries/Runtime/Directory.Build.props');

        assert.deepEqual(relative(chain), [
            'libraries/Runtime/Directory.Build.props',
            'libraries/Directory.Build.props',
            'Directory.Build.props',
            'build/Build.props',
            'build/Targets/Build.Global.props',
            'build/Targets/Build.Version.props',
            'libraries/Directory.Build.targets',
            'Directory.Build.targets',
            'build/Build.targets',
            'build/Targets/Build.Packaging.targets',
            'eng/Shared.targets'
        ]);
        assert.deepEqual(chain.files.map(file => file.origin), [
            'document', 'import', 'import', 'import', 'import', 'import', 'implicit', 'import', 'import', 'import', 'import'
        ]);
        assert.deepEqual(chain.unresolved, []);
    });

    it('skips imports whose condition is false and files nothing imports', async () => {
        const files = relative(await chainFor('libraries/Runtime/Directory.Build.props'));

        assert.ok(!files.includes('eng/Optional.targets'), 'guarded by RepoUseOptional');
        assert.ok(!files.includes('build/Targets/Build.Unimported.targets'), 'never imported');
    });

    it('follows a condition-guarded import once its property is set', async () => {
        const text = '<Project><PropertyGroup><RepoUseOptional>true</RepoUseOptional></PropertyGroup><Import Project="..\\Directory.Build.props" /></Project>';
        const files = relative(await chainFor('libraries/Runtime/Directory.Build.props', { documentText: text }));

        assert.ok(files.includes('eng/Optional.targets'));
    });

    it('puts a project between the props and targets chains', async () => {
        const files = relative(await chainFor('tools/Tool.csproj'));

        assert.equal(files[0], 'Directory.Build.props');
        assert.ok(files.indexOf('tools/Tool.csproj') < files.indexOf('Directory.Build.targets'));
    });

    it('treats a file reached by import as the document', async () => {
        const chain = await chainFor('build/Build.props');

        assert.equal(chain.files.find(file => file.path.endsWith('build/Build.props'))?.origin, 'document');
        assert.equal(relative(chain).filter(file => file === 'build/Build.props').length, 1);
    });

    it('can skip implicit imports and add files nothing imports', async () => {
        const files = relative(await chainFor('libraries/Runtime/Directory.Build.props', {
            implicitImports: false,
            additionalFiles: ['build/Targets/Build.Unimported.targets']
        }));

        assert.ok(!files.includes('Directory.Build.targets'));
        assert.equal(files[files.length - 1], 'build/Targets/Build.Unimported.targets');
    });

    it('reports imports it cannot follow', async () => {
        const text = '<Project><Import Project="$([MSBuild]::Unknown())\\x.props" /><Import Project="missing.props" /><Import Project="Sdk.props" Sdk="Microsoft.NET.Sdk" /></Project>';
        const chain = await chainFor('libraries/Runtime/Directory.Build.props', { documentText: text, implicitImports: false });

        assert.deepEqual(chain.unresolved.map(entry => entry.project), ['$([MSBuild]::Unknown())\\x.props', 'missing.props']);
    });
});
