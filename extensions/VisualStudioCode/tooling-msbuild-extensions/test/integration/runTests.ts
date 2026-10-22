/**
 * Launches VS Code with the XML editor and this extension (both from source) and runs suite.ts
 * against test/fixtures. Set VSCODE_TEST_VERSION to pin a VS Code build.
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
            extensionDevelopmentPath: [path.resolve(packageRoot, '..', 'tooling-xml-editor'), packageRoot],
            extensionTestsPath: path.join(__dirname, 'suite.js'),
            launchArgs: [
                // VS Code listens on a socket inside the user data directory, and socket paths are
                // limited to about 107 bytes; a deep checkout (such as a CI runner's) exceeds that.
                `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-'))}`,
                path.join(packageRoot, 'test', 'fixtures'),
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
