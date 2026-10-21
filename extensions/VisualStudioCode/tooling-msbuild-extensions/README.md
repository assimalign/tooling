# Assimalign MSBuild Extensions

MSBuild IntelliSense for `.csproj`, `.vbproj`, `.fsproj`, `.proj`, `.props`, and `.targets` files.
It builds on [Assimalign XML Editor](../tooling-xml-editor), which installs with it and supplies
the completion, hover, validation, and formatting. This extension supplies what those features know
about MSBuild, from two sources:

- **The MSBuild schema.** About 500 properties, 75 item types, and 120 tasks with Microsoft's
  documentation, generated from the official schema in dotnet/msbuild. See [The static schema](#the-static-schema).
- **Your repository's own vocabulary.** The extension follows the file's import chain and offers
  every custom property, item type (with its metadata), and task (with its parameters) that the
  chain defines or uses. Documentation comes from the XML comment above each definition.

No settings are needed.

## The import chain

When you open an MSBuild file, the extension evaluates the files MSBuild would evaluate around it,
in MSBuild's order:

1. The nearest `Directory.Build.props` and `Directory.Packages.props` at or above the file's folder.
2. The file itself.
3. The nearest `Directory.Build.targets`.

These are the files an SDK-style project in that folder would get. Each file's `<Import>` elements
are followed as it is read:

- Properties are evaluated along the way. An import such as
  `$(ViuRepositoryDirectory)sdks\Foo.targets` therefore resolves against the value an earlier file set.
- Conditions are evaluated as well, so an import guarded by
  `'$(UseFeature)' == 'true' and Exists(...)` is skipped unless something sets `UseFeature`.

For example, opening viu's `libraries/Runtime/Directory.Build.props` resolves 21 files:

```
libraries/Runtime/Directory.Build.props        this file
libraries/Directory.Build.props                → Directory.Build.props → build/Build.props
build/Targets/Build.{Global,TargetFramework,Branding,Version}.props
libraries/Runtime/Directory.Build.targets      implicit
libraries/Directory.Build.targets              → Directory.Build.targets → build/Build.targets
build/Targets/Build.{Packaging,References.*,LanguageServer,StaticWebAssets,DevTools,Css.*}.targets
```

Run **MSBuild: Show Import Chain** to see the list for the current file, why each file is there,
and any imports that were not followed and why. Unsaved edits to open files count right away;
changes on disk are picked up as files are saved.

### What it evaluates

- **Properties.** `$(Name)`, the `MSBuildThisFile*` and `MSBuildProject*` properties, and properties
  set by earlier files. A property no file sets is empty, as in MSBuild.
- **Property functions.** `[MSBuild]::GetPathOfFileAbove`, `GetDirectoryNameOfFileAbove`,
  `NormalizeDirectory`, `NormalizePath`, `EnsureTrailingSlash`, and `ValueOrDefault`;
  `[System.IO.Path]::Combine`, `GetFullPath`, `GetDirectoryName`, and `GetFileName`;
  `[System.String]::Copy` and `Concat`; and `Trim`, `TrimStart`, `TrimEnd`, `Replace`, `ToLower`, and
  `ToUpper` on a property.
- **Conditions.** `==`, `!=`, `<`, `>`, `<=`, `>=`, `and`, `or`, `!`, parentheses, `Exists()`, and
  `HasTrailingSlash()`.
- **Imports.** Relative and absolute paths, wildcards (`Targets\*.props`, `**`), `ImportGroup`, and
  `Choose`/`When`/`Otherwise`.

### What it does not evaluate

Anything else makes the affected import not followed, never guessed:

- SDK imports (`Sdk="..."`). The static schema already covers the SDK's vocabulary.
- Toolset locations such as `$(MSBuildToolsPath)` and `$(VSToolsPath)`.
- Environment variables, item and metadata references, and other functions.

A condition it cannot decide counts as true, so a branch is never hidden for lack of understanding.

### Private names and files nothing imports

Names starting with `_` are private by MSBuild convention, for example
`_ViuCssLinkHostPageBuildFallback`. They are offered only in a file that defines or uses them itself.

A file that nothing imports is not part of any chain. viu's `build/Targets/Build.Browser.Router.targets`
is an example: it is packed into a NuGet package as `buildTransitive` rather than imported. To offer
the vocabulary of such files anyway, list them in `msbuildExtensions.importChain.additionalFiles`:

```jsonc
// .vscode/settings.json
{
  "msbuildExtensions.importChain.additionalFiles": ["build/Targets/*.targets"]
}
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `msbuildExtensions.fileExtensions` | `.csproj`, `.vbproj`, `.fsproj`, `.proj`, `.props`, `.targets` | Files that get MSBuild IntelliSense. |
| `msbuildExtensions.importChain.enabled` | `true` | Offer the vocabulary of the import chain. When off, only the static schema is used. |
| `msbuildExtensions.importChain.implicitImports` | `true` | Include the nearest `Directory.Build.props`, `Directory.Packages.props`, and `Directory.Build.targets`. |
| `msbuildExtensions.importChain.additionalFiles` | `[]` | Glob patterns, relative to the workspace folder, of files to include even though nothing imports them. |

The XML editor's settings (`xmlEditor.format.*`, `xmlEditor.validation.enabled`, …) apply to MSBuild
files too. Schemas registered in `xmlEditor.schemas` are added to the ones this extension supplies.

## Validation

Validation reports mistakes such as an unknown attribute on a known element, a missing required
attribute, or a missing required parameter of a task registered with a `ParameterGroup`. Custom
names are never errors, because MSBuild accepts any property, item, metadata, or task name.

Across 183 real MSBuild files from the viu and tooling repositories, validation reports no false
errors.

## The static schema

`schemas/` is generated by `scripts/Update-MSBuildSchema.ps1` from Microsoft's MSBuild schema in
[dotnet/msbuild](https://github.com/dotnet/msbuild) (MIT; see `schemas/LICENSE.txt`). The release
tag is pinned in the script. Used unmodified, the upstream schema produced 185 false errors across 163
real MSBuild files from viu and tooling, so the script changes it:

| Upstream | Generated |
| --- | --- |
| Targets the `msbuild/2003` namespace, which SDK-style projects do not declare | No namespace. `Microsoft.Build.Namespaced.xsd` uses a chameleon include to put the same components in the 2003 namespace for legacy projects. |
| Only listed property, item, and task names are allowed | Skip wildcards admit any name, as MSBuild does. |
| Item metadata written as attributes (`<Compile Link="..."/>`) is not allowed | Item types accept any attribute. |
| Boolean and enumerated properties allow no `Condition` and only the listed literal values | Every property accepts `Condition` and `Label`. Values are suggested but not enforced, so `$(Expressions)` are valid. |
| The `MSBuild` task's `RemoveProperties` parameter is missing | Declared. |

An element next to an overlapping wildcard is valid XSD 1.1 but not 1.0. A strict XSD 1.0 processor
such as `System.Xml.Schema` therefore rejects these files; they are meant for editors.

Each edit the script makes must match an exact number of times, so it fails rather than silently
producing a different schema when upstream changes. To regenerate it:

```powershell
./scripts/Update-MSBuildSchema.ps1 -Tag v18.11.0
```

## Development

The extension compiles against the XML editor's API types through a TypeScript project reference. It
loads none of the XML editor's code at run time except through the API object.

```sh
(cd ../tooling-xml-editor && npm ci)
npm ci
npm test                 # builds both packages, then runs the unit tests
npm run test:integration # launches VS Code with both extensions against test/fixtures
```

Press F5 (**Run MSBuild Extensions (with XML Editor)**) to open `test/fixtures` in a development host
with both extensions loaded. `test/fixtures/repo` mirrors viu's layout.
