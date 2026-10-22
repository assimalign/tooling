import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Evaluator, MSBuildFileSystem } from '../src/core/expressions';

/** An in-memory file system: files by absolute path, directories implied. */
function memoryFileSystem(files: Record<string, string>): MSBuildFileSystem {
    const isDirectory = (path: string): boolean => Object.keys(files).some(file => file.startsWith(`${path.replace(/\/$/, '')}/`));
    return {
        readFile: async path => files[path],
        exists: async path => files[path] !== undefined || isDirectory(path),
        readDirectory: async () => undefined
    };
}

function evaluator(files: Record<string, string> = {}, project = '/repo/src/App/App.csproj'): Evaluator {
    const result = new Evaluator(memoryFileSystem(files), project);
    result.enterFile('/repo/build/Targets/Build.props');
    return result;
}

describe('Evaluator.expand', () => {
    it('expands reserved, set, and unset properties case-insensitively', async () => {
        const subject = evaluator();
        subject.setProperty('RepoRoot', '/repo/');

        assert.equal(await subject.expand('$(MSBuildThisFileDirectory)'), '/repo/build/Targets/');
        assert.equal(await subject.expand('$(MSBuildThisFile)|$(MSBuildThisFileName)|$(MSBuildThisFileExtension)'), 'Build.props|Build|.props');
        assert.equal(await subject.expand('$(MSBuildProjectDirectory)|$(MSBuildProjectName)'), '/repo/src/App|App');
        assert.equal(await subject.expand('$(reporoot)eng\\x.targets'), '/repo/eng\\x.targets');
        assert.equal(await subject.expand('a$(Unset)b'), 'ab');
    });

    it('evaluates the path functions repositories use', async () => {
        const subject = evaluator({ '/repo/Directory.Build.props': '<Project />' });

        assert.equal(await subject.expand('$([System.IO.Path]::GetFullPath(\'$(MSBuildThisFileDirectory)\\..\\..\'))\\'), '/repo\\');
        assert.equal(await subject.expand('$([MSBuild]::GetPathOfFileAbove(\'Directory.Build.props\', \'$(MSBuildThisFileDirectory)../\'))'), '/repo/Directory.Build.props');
        assert.equal(await subject.expand('$([MSBuild]::GetDirectoryNameOfFileAbove($(MSBuildThisFileDirectory), Directory.Build.props))'), '/repo');
        assert.equal(await subject.expand('$([MSBuild]::NormalizeDirectory(\'$(MSBuildThisFileDirectory)\', \'..\', \'out\'))'), '/repo/build/out/');
        assert.equal(await subject.expand('$([System.IO.Path]::Combine(\'a\', \'b\\c\'))'), 'a/b/c');
        assert.equal(await subject.expand('$([MSBuild]::GetPathOfFileAbove(\'Missing.props\'))'), '');
    });

    it('evaluates simple string methods and reports what it cannot evaluate', async () => {
        const subject = evaluator();
        subject.setProperty('Dir', '/repo/out/');

        assert.equal(await subject.expand('$(Dir.TrimEnd(\'/\'))'), '/repo/out');
        assert.equal(await subject.expand('$([System.Environment]::GetEnvironmentVariable(\'HOME\'))'), undefined);
        assert.equal(await subject.expand('@(Compile)'), undefined);
        assert.equal(await subject.expand('$(MSBuildToolsPath)\\Microsoft.CSharp.targets'), undefined, 'toolset paths are unknowable');
        subject.setProperty('Unknown', undefined);
        assert.equal(await subject.expand('$(Unknown)\\x'), undefined);
    });
});

describe('Evaluator.evaluateCondition', () => {
    it('compares case-insensitively with and, or, not, and parentheses', async () => {
        const subject = evaluator();
        subject.setProperty('Configuration', 'Release');

        assert.equal(await subject.evaluateCondition('\'$(Configuration)\' == \'release\''), true);
        assert.equal(await subject.evaluateCondition('\'$(Configuration)\' != \'Release\''), false);
        assert.equal(await subject.evaluateCondition('\'$(Unset)\' == \'\' and (\'$(Configuration)\' == \'Debug\' or !false)'), true);
        assert.equal(await subject.evaluateCondition('$(Configuration) == Release'), true);
    });

    it('evaluates Exists and HasTrailingSlash', async () => {
        const subject = evaluator({ '/repo/eng/Shared.targets': '<Project />' });

        assert.equal(await subject.evaluateCondition('Exists(\'/repo/eng/Shared.targets\')'), true);
        assert.equal(await subject.evaluateCondition('Exists(\'/repo/eng\')'), true);
        assert.equal(await subject.evaluateCondition('Exists(\'/repo/eng/Missing.targets\')'), false);
        assert.equal(await subject.evaluateCondition('HasTrailingSlash(\'/repo/\')'), true);
    });

    it('returns undefined for what it cannot decide, and false still wins an and', async () => {
        const subject = evaluator();

        assert.equal(await subject.evaluateCondition('$([MSBuild]::IsOSPlatform(\'Windows\'))'), undefined);
        assert.equal(await subject.evaluateCondition('\'@(Compile)\' != \'\''), undefined);
        assert.equal(await subject.evaluateCondition('\'@(Compile)\' != \'\' and \'a\' == \'b\''), false);
        assert.equal(await subject.evaluateCondition('\'unterminated'), undefined);
    });
});
