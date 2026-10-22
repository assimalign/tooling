# Changelog

## 0.1.0

- Initial preview. Adds MSBuild IntelliSense on top of the Assimalign XML Editor:
  - the static MSBuild schema, generated from dotnet/msbuild v18.11.0;
  - custom properties, items, metadata, and tasks discovered by following each file's import chain,
    including the implicit `Directory.Build.props` and `Directory.Build.targets`;
  - the **MSBuild: Show Import Chain** command.
