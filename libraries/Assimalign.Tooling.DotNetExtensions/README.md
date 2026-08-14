# Assimalign.Tooling.DotNetExtensions

A .NET tool that extends the .NET CLI with the `assimalign` verb. Installing it globally puts
`dotnet-assimalign` on the `PATH`, which is how the .NET CLI resolves `dotnet assimalign <command>`.

```
libraries/Assimalign.Tooling.DotNetExtensions
├── src
│   ├── ToolApplication.cs        # composition root: every top level command is registered here
│   ├── Framework/                # the command model: ToolCommand, context, console, exit codes
│   ├── Commands/                 # one folder per command group
│   └── Internal/                 # helpers not part of the tool's public surface
└── tests
```

## Install

```powershell
dotnet pack libraries/Assimalign.Tooling.DotNetExtensions/src -c Release
dotnet tool install --global --add-source _out/packages Assimalign.Tooling.DotNetExtensions
```

During development the built executable can be run directly out of
`libraries/Assimalign.Tooling.DotNetExtensions/src/bin/Debug/net10.0/dotnet-extension.exe`.

## Commands

### `solution new`

Generates an XML based (`.slnx`) solution file from a directory tree. This is the port of the
`New-CohesionDotnetSolution` PowerShell cmdlet, and produces byte identical output.

```powershell
dotnet assimalign solution new ./libraries/Core/Assimalign.Cohesion.Core.slnx `
    --root-folder Core `
    --include-references `
    --force `
    --ignore "**/.claude/worktrees/**" `
    --ignore _out
```

| Option | Cmdlet parameter | Behavior |
| --- | --- | --- |
| `<path>` | `-SolutionPath` | The directory the solution is generated from. Naming the `.slnx` file directly uses its directory as the generation root. |
| `--name`, `-n` | `-SolutionName` | The solution file name. `.slnx` is appended when omitted, and an explicit name wins over one carried by the path. |
| `--root-folder` | `-SolutionRootFolder` | The root solution folder everything is nested under. Defaults to the name of the generated directory. |
| `--include-references` | `-IncludeReferences` | Resolves references to projects living outside the generated directory and collects them into one folder. |
| `--reference-folder` | `-ReferenceFolderName` | The folder resolved references are placed in. Defaults to `refs`. |
| `--reference-element` | *(new)* | The project item element whose `Include` names a referenced project. Defaults to `CohesionProjectReference`. |
| `--force`, `-f` | `-Force` | Overwrites an existing solution file. |
| `--ignore` | `-IgnorePaths` | Wildcard patterns excluding files and directories. Repeatable. |
| `--group` | `-Grouping` | Nests directories under an additional solution folder, as `<folder>=<path>[;<path>]`. Repeatable. |
| `--verbose` | `-Verbose` | Writes the diagnostic output the cmdlet wrote through `WriteVerbose`. |

How the tree is walked:

- A directory holding a project file contributes that project and is **not** descended into.
- Any other directory contributes its files, or is emitted as an empty folder.
- Hidden directories and `.sln`/`.slnx` files are always skipped; `bin` and `obj` are not, so pass
  `--ignore` for anything else that should stay out.

Reference resolution indexes every `*.csproj` under the repository root (the nearest ancestor
holding a `.git` entry, otherwise the generated directory's parent), skipping build output,
version control directories, and anything matching `--ignore`. References are followed
transitively, and a reference resolving to a project already inside the solution is left out
because the folder pass already emitted it.

**Ignore patterns.** `*` matches within a path segment, `**` matches across segments, `?` matches a
single character, and `[abc]`/`[a-z]`/`[!abc]` match a character set. A pattern *without* a
separator matches any path segment, so `--ignore bin` excludes every directory named `bin`; a
pattern *with* one matches the whole path, so use `--ignore "**/bin/**"` to exclude their contents
by path. Matching is case insensitive and `\` and `/` are equivalent.

## Adding a command

1. Add a folder under `src/Commands` for the group.
2. Derive the leaf command from `ToolCommand`: declare its `Argument`/`Option` fields, add them in
   `Configure`, and do the work in `ExecuteAsync`. Throwing from `ExecuteAsync` is fine — the base
   class reports the message and returns a non-zero exit code.
3. Group related commands by deriving from `ToolCommandGroup` and calling `AddCommand`.
4. Register the top level command in `ToolApplication.Create`.

Keep the work itself out of the command type — `NewSolutionCommand` only maps parsed arguments onto
`NewSolutionOptions` and hands them to `SolutionGenerator`, which is what makes the behavior
testable without going through the command line.
