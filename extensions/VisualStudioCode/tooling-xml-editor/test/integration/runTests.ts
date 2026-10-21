/**
 * Launches a real VS Code with the extension under development and runs suite.ts inside it.
 * The VS Code build defaults to stable; set VSCODE_TEST_VERSION to pin one (for example 1.85.2,
 * the minimum the manifest's engine range admits).
 */

import * as fs from 'fs';
import * as os from 'os';
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
                // VS Code listens on a socket inside the user data directory, and socket paths are
                // limited to about 107 bytes; a deep checkout (such as a CI runner's) exceeds that.
                `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-'))}`,
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
