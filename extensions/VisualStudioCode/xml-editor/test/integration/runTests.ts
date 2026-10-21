/**
 * Launches a real VS Code with the extension under development and runs suite.ts inside it.
 * The VS Code build defaults to stable; set VSCODE_TEST_VERSION to pin one (for example 1.85.2,
 * the minimum the manifest's engine range admits).
 */

import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const packageRoot = path.resolve(__dirname, '..', '..', '..');
    try {
        await runTests({
            version: process.env['VSCODE_TEST_VERSION'] ?? 'stable',
            extensionDevelopmentPath: packageRoot,
            extensionTestsPath: path.join(__dirname, 'suite.js'),
            launchArgs: [
                path.join(packageRoot, 'test', 'integration', 'workspace'),
                '--disable-extensions',
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes'
            ]
        });
    }
    catch (error) {
        console.error(error);
        process.exit(1);
    }
}

void main();
