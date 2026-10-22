/**
 * Paths as the import chain sees them: absolute, forward-slashed URI paths (`/repo/build/x.props`,
 * or `/c:/repo/build/x.props` on Windows). MSBuild text spells paths with either separator and as
 * Windows drive paths; everything is normalized to this one form before it is compared or read.
 */

import * as path from 'path';

/** Converts an MSBuild path to the URI-path form, resolving it against `baseDirectory` when relative. */
export function resolvePath(value: string, baseDirectory: string): string {
    let normalized = value.trim().replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) {
        normalized = `/${normalized}`;
    }

    const trailingSlash = normalized.endsWith('/');
    const resolved = path.posix.resolve(baseDirectory, normalized);
    return trailingSlash && resolved !== '/' ? `${resolved}/` : resolved;
}

export function directoryOf(filePath: string): string {
    return path.posix.dirname(filePath);
}

/** The directory with a trailing slash, as MSBuild's `MSBuildThisFileDirectory` spells it. */
export function directoryWithSlash(filePath: string): string {
    const directory = directoryOf(filePath);
    return directory.endsWith('/') ? directory : `${directory}/`;
}

export function fileName(filePath: string): string {
    return path.posix.basename(filePath);
}

export function joinPath(directory: string, ...segments: string[]): string {
    return path.posix.join(directory, ...segments);
}

/** A key for comparing paths: drive-letter paths (Windows) compare case-insensitively. */
export function pathKey(filePath: string): string {
    const normalized = filePath.replace(/\/+$/, '');
    return /^\/[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

/** `path` relative to `root` when inside it, otherwise `path` itself. */
export function relativePath(filePath: string, root: string | undefined): string {
    if (root === undefined) {
        return filePath;
    }

    const relative = path.posix.relative(root, filePath);
    return relative.startsWith('..') || path.posix.isAbsolute(relative) ? filePath : relative;
}
