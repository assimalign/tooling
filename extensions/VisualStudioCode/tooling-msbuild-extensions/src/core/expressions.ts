/**
 * Just enough MSBuild evaluation to follow imports: property expansion, the property functions
 * repositories use to compute paths, and conditions.
 *
 * Anything this evaluator does not understand is reported as unknown rather than guessed. An
 * unknown value makes an import unresolved; an unknown condition counts as true, so the evaluator
 * never hides a branch it cannot rule out.
 */

import { directoryOf, directoryWithSlash, fileName, joinPath, resolvePath } from './paths';

export interface MSBuildFileSystem {
    /** The text of a file, or undefined when it does not exist or cannot be read. */
    readFile(path: string): Promise<string | undefined>;
    /** Whether a file or directory exists. */
    exists(path: string): Promise<boolean>;
    /** The entries of a directory, or undefined when it does not exist. */
    readDirectory(path: string): Promise<readonly { readonly name: string; readonly isDirectory: boolean }[] | undefined>;
}

/**
 * Properties MSBuild derives from its installation (toolset, SDK, and NuGet locations). They cannot
 * be known outside MSBuild, so they are unknown rather than empty: an import through one is reported
 * as not evaluable instead of as a missing file.
 */
const toolsetProperties = [
    'MSBuildBinPath', 'MSBuildExtensionsPath', 'MSBuildExtensionsPath32', 'MSBuildExtensionsPath64',
    'MSBuildFrameworkToolsPath', 'MSBuildFrameworkToolsPath32', 'MSBuildFrameworkToolsPath64',
    'MSBuildProgramFiles32', 'MSBuildSDKsPath', 'MSBuildToolsPath', 'MSBuildToolsPath32',
    'MSBuildToolsPath64', 'MSBuildToolsRoot', 'MSBuildUserExtensionsPath', 'NuGetPackageRoot', 'VSToolsPath'
];

/** Properties whose value comes from the file being evaluated rather than from the property table. */
const thisFileProperties = new Set([
    'msbuildthisfile',
    'msbuildthisfiledirectory',
    'msbuildthisfiledirectorynoroot',
    'msbuildthisfileextension',
    'msbuildthisfilefullpath',
    'msbuildthisfilename'
]);

export class Evaluator {
    /** Property values by lower-cased name. `undefined` marks a property whose value is unknown. */
    private readonly properties = new Map<string, string | undefined>();
    private readonly files: string[] = [];

    public constructor(private readonly fileSystem: MSBuildFileSystem, private readonly projectPath: string) {
        const projectFile = fileName(projectPath);
        const extensionIndex = projectFile.lastIndexOf('.');
        this.properties.set('msbuildprojectfullpath', projectPath);
        this.properties.set('msbuildprojectdirectory', directoryOf(projectPath));
        this.properties.set('msbuildprojectfile', projectFile);
        this.properties.set('msbuildprojectname', extensionIndex > 0 ? projectFile.slice(0, extensionIndex) : projectFile);
        this.properties.set('msbuildprojectextension', extensionIndex > 0 ? projectFile.slice(extensionIndex) : '');
        for (const name of toolsetProperties) {
            this.properties.set(name.toLowerCase(), undefined);
        }
    }

    public get projectDirectory(): string {
        return directoryOf(this.projectPath);
    }

    /** The file whose content is being evaluated, which `MSBuildThisFile*` describe. */
    public get currentFile(): string {
        return this.files[this.files.length - 1] ?? this.projectPath;
    }

    public enterFile(filePath: string): void {
        this.files.push(filePath);
    }

    public exitFile(): void {
        this.files.pop();
    }

    public setProperty(name: string, value: string | undefined): void {
        this.properties.set(name.toLowerCase(), value);
    }

    /** A property's value: '' when never set (as in MSBuild), undefined when set to something unknown. */
    public getProperty(name: string): string | undefined {
        const key = name.toLowerCase();
        if (thisFileProperties.has(key)) {
            const file = this.currentFile;
            const base = fileName(file);
            const extensionIndex = base.lastIndexOf('.');
            switch (key) {
                case 'msbuildthisfile': return base;
                case 'msbuildthisfiledirectory': return directoryWithSlash(file);
                case 'msbuildthisfiledirectorynoroot': return directoryWithSlash(file).replace(/^\/([a-zA-Z]:\/)?/, '');
                case 'msbuildthisfileextension': return extensionIndex > 0 ? base.slice(extensionIndex) : '';
                case 'msbuildthisfilefullpath': return file;
                default: return extensionIndex > 0 ? base.slice(0, extensionIndex) : base;
            }
        }

        return this.properties.has(key) ? this.properties.get(key) : '';
    }

    /** Expands `$(...)` references. Undefined when any part cannot be evaluated or items are referenced. */
    public async expand(text: string): Promise<string | undefined> {
        let result = '';
        let index = 0;
        while (index < text.length) {
            const start = text.indexOf('$(', index);
            const item = findItemReference(text, index, start === -1 ? text.length : start);
            if (item) {
                return undefined;
            }
            if (start === -1) {
                result += text.slice(index);
                break;
            }

            result += text.slice(index, start);
            const end = findClosingParenthesis(text, start + 1);
            if (end === -1) {
                return undefined;
            }

            const value = await this.evaluateProperty(text.slice(start + 2, end).trim());
            if (value === undefined) {
                return undefined;
            }

            result += value;
            index = end + 1;
        }

        return result;
    }

    private async evaluateProperty(body: string): Promise<string | undefined> {
        if (/^[A-Za-z_][\w-]*$/.test(body)) {
            return this.getProperty(body);
        }

        const staticCall = /^\[([\w.]+)\]::(\w+)\s*\(([\s\S]*)\)$/.exec(body);
        if (staticCall !== null) {
            const argumentsText = staticCall[3]!;
            if (findClosingParenthesis(`(${argumentsText})`, 0) !== argumentsText.length + 1) {
                return undefined; // a call followed by member access, which is not supported
            }

            const values = await this.evaluateArguments(argumentsText);
            return values === undefined ? undefined : this.callStatic(staticCall[1]!, staticCall[2]!, values);
        }

        const instanceCall = /^([A-Za-z_][\w-]*)\.(\w+)\s*\(([\s\S]*)\)$/.exec(body);
        if (instanceCall !== null) {
            const target = this.getProperty(instanceCall[1]!);
            const values = await this.evaluateArguments(instanceCall[3]!);
            return target === undefined || values === undefined ? undefined : callString(target, instanceCall[2]!, values);
        }

        return undefined;
    }

    private async evaluateArguments(text: string): Promise<string[] | undefined> {
        const values: string[] = [];
        for (const argument of splitArguments(text)) {
            const trimmed = argument.trim();
            const quoted = /^(['"`])([\s\S]*)\1$/.exec(trimmed);
            const value = await this.expand(quoted === null ? trimmed : quoted[2]!);
            if (value === undefined) {
                return undefined;
            }
            values.push(value);
        }

        return values;
    }

    private async callStatic(type: string, method: string, values: string[]): Promise<string | undefined> {
        const typeName = type.toLowerCase();
        const name = method.toLowerCase();
        const fullPath = (value: string): string => resolvePath(value, this.projectDirectory);
        // Path.Combine: later absolute parts replace what came before; nothing is normalized.
        const combine = (parts: readonly string[]): string => parts.reduce((combined, part) => {
            const segment = part.replace(/\\/g, '/');
            if (segment.length === 0) {
                return combined;
            }
            if (combined.length === 0 || /^(\/|[a-zA-Z]:\/)/.test(segment)) {
                return segment;
            }

            return combined.endsWith('/') ? combined + segment : `${combined}/${segment}`;
        }, '');

        if (typeName === 'msbuild') {
            switch (name) {
                case 'getpathoffileabove': {
                    const found = await this.findFileAbove(values[0] ?? '', values[1] ?? directoryWithSlash(this.currentFile));
                    return found ?? '';
                }
                case 'getdirectorynameoffileabove': {
                    const found = await this.findFileAbove(values[1] ?? '', values[0] ?? directoryWithSlash(this.currentFile));
                    return found === undefined ? '' : directoryOf(found);
                }
                case 'normalizedirectory': {
                    const normalized = fullPath(combine(values));
                    return normalized.endsWith('/') ? normalized : `${normalized}/`;
                }
                case 'normalizepath':
                    return fullPath(combine(values));
                case 'ensuretrailingslash':
                    return values[0] === undefined || values[0].length === 0 || /[\\/]$/.test(values[0]) ? values[0] ?? '' : `${values[0]}/`;
                case 'valueordefault':
                    return values[0] !== undefined && values[0].length > 0 ? values[0] : values[1] ?? '';
                case 'escape':
                case 'unescape':
                    return values[0] ?? '';
                default:
                    return undefined;
            }
        }

        if (typeName === 'system.io.path') {
            switch (name) {
                case 'combine': return combine(values);
                case 'getfullpath': return values[0] === undefined ? undefined : fullPath(values[0]);
                case 'getdirectoryname': return values[0] === undefined ? undefined : directoryOf(values[0].replace(/\\/g, '/'));
                case 'getfilename': return values[0] === undefined ? undefined : fileName(values[0].replace(/\\/g, '/'));
                default: return undefined;
            }
        }

        if (typeName === 'system.string') {
            switch (name) {
                case 'copy': return values[0] ?? '';
                case 'concat': return values.join('');
                default: return undefined;
            }
        }

        return undefined;
    }

    private async findFileAbove(name: string, startDirectory: string): Promise<string | undefined> {
        if (name.length === 0) {
            return undefined;
        }

        let directory = resolvePath(startDirectory, this.projectDirectory).replace(/\/+$/, '') || '/';
        while (true) {
            const candidate = joinPath(directory, name);
            if (await this.fileSystem.readFile(candidate) !== undefined) {
                return candidate;
            }

            const parent = directoryOf(directory);
            if (parent === directory) {
                return undefined;
            }
            directory = parent;
        }
    }

    /** True, false, or undefined when the condition cannot be decided. */
    public async evaluateCondition(condition: string): Promise<boolean | undefined> {
        try {
            const parser = new ConditionParser(tokenize(condition), this);
            const result = await parser.parseExpression();
            return parser.atEnd ? result : undefined;
        }
        catch {
            return undefined;
        }
    }

    public async pathExists(value: string): Promise<boolean> {
        return value.trim().length > 0 && await this.fileSystem.exists(resolvePath(value, this.projectDirectory).replace(/\/+$/, ''));
    }
}

function callString(target: string, method: string, values: readonly string[]): string | undefined {
    switch (method.toLowerCase()) {
        case 'trim': return target.trim();
        case 'trimend': return values.length === 0 ? target.trimEnd() : trimCharacters(target, values.join(''), false, true);
        case 'trimstart': return values.length === 0 ? target.trimStart() : trimCharacters(target, values.join(''), true, false);
        case 'tolower':
        case 'tolowerinvariant': return target.toLowerCase();
        case 'toupper':
        case 'toupperinvariant': return target.toUpperCase();
        case 'replace': return values.length === 2 ? target.split(values[0]!).join(values[1]!) : undefined;
        default: return undefined;
    }
}

function trimCharacters(value: string, characters: string, start: boolean, end: boolean): string {
    let first = 0;
    let last = value.length;
    while (start && first < last && characters.includes(value[first]!)) {
        first++;
    }
    while (end && last > first && characters.includes(value[last - 1]!)) {
        last--;
    }

    return value.slice(first, last);
}

/** True when `@(` or `%(` appears between `from` and `to` (item and metadata references). */
function findItemReference(text: string, from: number, to: number): boolean {
    const segment = text.slice(from, to);
    return segment.includes('@(') || segment.includes('%(');
}

/** The index of the `)` matching the `(` at `openIndex`, skipping quoted text; -1 when unbalanced. */
export function findClosingParenthesis(text: string, openIndex: number): number {
    let depth = 0;
    let quote: string | undefined;
    for (let index = openIndex; index < text.length; index++) {
        const character = text[index]!;
        if (quote !== undefined) {
            if (character === quote) {
                quote = undefined;
            }
        }
        else if (character === '\'' || character === '"' || character === '`') {
            quote = character;
        }
        else if (character === '(') {
            depth++;
        }
        else if (character === ')') {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

/** Splits a property-function argument list at top-level commas. */
function splitArguments(text: string): string[] {
    if (text.trim().length === 0) {
        return [];
    }

    const parts: string[] = [];
    let depth = 0;
    let quote: string | undefined;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        const character = text[index]!;
        if (quote !== undefined) {
            if (character === quote) {
                quote = undefined;
            }
        }
        else if (character === '\'' || character === '"' || character === '`') {
            quote = character;
        }
        else if (character === '(') {
            depth++;
        }
        else if (character === ')') {
            depth--;
        }
        else if (character === ',' && depth === 0) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

// ------------------------------------------------------------------------------------------------
// Conditions
// ------------------------------------------------------------------------------------------------

type Token =
    | { readonly kind: 'string'; readonly value: string }
    | { readonly kind: 'word'; readonly value: string }
    | { readonly kind: 'operator'; readonly value: '==' | '!=' | '<' | '>' | '<=' | '>=' }
    | { readonly kind: 'punctuation'; readonly value: '(' | ')' | ',' | '!' };

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;
    while (index < text.length) {
        const character = text[index]!;
        if (/\s/.test(character)) {
            index++;
            continue;
        }

        const two = text.slice(index, index + 2);
        if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
            tokens.push({ kind: 'operator', value: two });
            index += 2;
            continue;
        }
        if (character === '<' || character === '>') {
            tokens.push({ kind: 'operator', value: character });
            index++;
            continue;
        }
        if (character === '(' || character === ')' || character === ',' || character === '!') {
            tokens.push({ kind: 'punctuation', value: character });
            index++;
            continue;
        }

        if (character === '\'' || character === '"') {
            // Quoted strings may contain property functions with their own quotes: $([MSBuild]::X('a')).
            let end = index + 1;
            while (end < text.length && text[end] !== character) {
                if ((text[end] === '$' || text[end] === '@' || text[end] === '%') && text[end + 1] === '(') {
                    const close = findClosingParenthesis(text, end + 1);
                    if (close === -1) {
                        throw new Error('Unbalanced parentheses.');
                    }
                    end = close + 1;
                    continue;
                }
                end++;
            }
            if (end >= text.length) {
                throw new Error('Unterminated string.');
            }
            tokens.push({ kind: 'string', value: text.slice(index + 1, end) });
            index = end + 1;
            continue;
        }

        if ((character === '$' || character === '@' || character === '%') && text[index + 1] === '(') {
            const close = findClosingParenthesis(text, index + 1);
            if (close === -1) {
                throw new Error('Unbalanced parentheses.');
            }
            tokens.push({ kind: 'string', value: text.slice(index, close + 1) });
            index = close + 1;
            continue;
        }

        const word = /^[^\s()!=<>,'"]+/.exec(text.slice(index));
        if (word === null) {
            throw new Error(`Unexpected '${character}'.`);
        }
        tokens.push({ kind: 'word', value: word[0] });
        index += word[0].length;
    }

    return tokens;
}

function and(left: boolean | undefined, right: boolean | undefined): boolean | undefined {
    return left === false || right === false ? false : left === true && right === true ? true : undefined;
}

function or(left: boolean | undefined, right: boolean | undefined): boolean | undefined {
    return left === true || right === true ? true : left === false && right === false ? false : undefined;
}

class ConditionParser {
    private index = 0;

    public constructor(private readonly tokens: readonly Token[], private readonly evaluator: Evaluator) {
    }

    public get atEnd(): boolean {
        return this.index >= this.tokens.length;
    }

    private peek(): Token | undefined {
        return this.tokens[this.index];
    }

    private isKeyword(keyword: string): boolean {
        const token = this.peek();
        return token?.kind === 'word' && token.value.toLowerCase() === keyword;
    }

    private expect(value: string): void {
        const token = this.tokens[this.index++];
        if (token === undefined || token.value !== value) {
            throw new Error(`Expected '${value}'.`);
        }
    }

    public async parseExpression(): Promise<boolean | undefined> {
        let result = await this.parseAnd();
        while (this.isKeyword('or')) {
            this.index++;
            result = or(result, await this.parseAnd());
        }
        return result;
    }

    private async parseAnd(): Promise<boolean | undefined> {
        let result = await this.parseUnary();
        while (this.isKeyword('and')) {
            this.index++;
            result = and(result, await this.parseUnary());
        }
        return result;
    }

    private async parseUnary(): Promise<boolean | undefined> {
        const token = this.peek();
        if (token?.kind === 'punctuation' && token.value === '!') {
            this.index++;
            const operand = await this.parseUnary();
            return operand === undefined ? undefined : !operand;
        }

        return this.parsePrimary();
    }

    private async parsePrimary(): Promise<boolean | undefined> {
        const token = this.tokens[this.index++];
        if (token === undefined) {
            throw new Error('Unexpected end of condition.');
        }

        if (token.kind === 'punctuation' && token.value === '(') {
            const result = await this.parseExpression();
            this.expect(')');
            return result;
        }

        const next = this.peek();
        if (token.kind === 'word' && next?.kind === 'punctuation' && next.value === '(') {
            return this.parseFunction(token.value);
        }

        if (token.kind !== 'string' && token.kind !== 'word') {
            throw new Error('Expected an operand.');
        }

        const operator = this.peek();
        if (operator?.kind !== 'operator') {
            const value = await this.evaluator.expand(token.value);
            const lowered = value?.toLowerCase();
            return lowered === 'true' || lowered === 'on' || lowered === 'yes'
                ? true
                : lowered === 'false' || lowered === 'off' || lowered === 'no' ? false : undefined;
        }

        this.index++;
        const right = this.tokens[this.index++];
        if (right === undefined || (right.kind !== 'string' && right.kind !== 'word')) {
            throw new Error('Expected an operand.');
        }

        const leftValue = await this.evaluator.expand(token.value);
        const rightValue = await this.evaluator.expand(right.value);
        if (leftValue === undefined || rightValue === undefined) {
            return undefined;
        }

        switch (operator.value) {
            case '==': return leftValue.toLowerCase() === rightValue.toLowerCase();
            case '!=': return leftValue.toLowerCase() !== rightValue.toLowerCase();
            default: {
                const left = Number(leftValue);
                const rightNumber = Number(rightValue);
                if (leftValue.trim() === '' || rightValue.trim() === '' || Number.isNaN(left) || Number.isNaN(rightNumber)) {
                    return undefined;
                }
                switch (operator.value) {
                    case '<': return left < rightNumber;
                    case '>': return left > rightNumber;
                    case '<=': return left <= rightNumber;
                    default: return left >= rightNumber;
                }
            }
        }
    }

    private async parseFunction(name: string): Promise<boolean | undefined> {
        this.expect('(');
        const values: (string | undefined)[] = [];
        while (!(this.peek()?.kind === 'punctuation' && this.peek()?.value === ')')) {
            const argument = this.tokens[this.index++];
            if (argument === undefined || (argument.kind !== 'string' && argument.kind !== 'word')) {
                throw new Error('Expected a function argument.');
            }
            values.push(await this.evaluator.expand(argument.value));
            if (this.peek()?.kind === 'punctuation' && this.peek()?.value === ',') {
                this.index++;
            }
        }
        this.expect(')');

        if (values.some(value => value === undefined)) {
            return undefined;
        }

        switch (name.toLowerCase()) {
            case 'exists':
                return this.evaluator.pathExists(values[0] ?? '');
            case 'hastrailingslash':
                return /[\\/]$/.test(values[0] ?? '');
            default:
                return undefined;
        }
    }
}
