# Assimalign XML Editor

XML support for Visual Studio Code: schema-driven IntelliSense, hover documentation, validation, and
a content-preserving formatter. It runs entirely inside the extension host with no Java, .NET, or
other runtime to install, and it is enabled for `.xml` and `.xsd` files by default.

## Features

- **Completion** for element names (in content-model order, required elements first), attributes
  (required first, with value placeholders), enumerated attribute and element values, `xmlns`
  namespace URIs, `xsi:*` attributes, and end tags. Without a schema, element names, attribute
  names, and attribute values already used in the document are offered instead.
- **Auto-closing tags**: typing `>` inserts `</name>`, and typing `</` completes the open element.
- **Hover** shows the `xs:documentation` of elements, attributes, and enumeration values, along with
  the type, default, and whether an attribute is required.
- **Validation** reports well-formedness errors, undeclared namespace prefixes, and schema errors:
  undeclared elements and attributes, missing required attributes and child elements, and values
  outside an enumeration. Schemas that cannot be loaded are reported on the document.
- **Formatting** (`Format Document`, or format on save) re-indents element-only content using the
  editor's tab size and spaces/tabs setting.
- **XML Schema authoring**: `.xsd` files get completion, hover, and validation from a bundled
  description of the XSD vocabulary, plus completion of built-in types and the schema's own named
  types, elements, groups, and attribute groups in `type`, `base`, `ref`, and similar attributes.

## Registering schemas

A document gets its schemas from, in order:

1. `xmlEditor.schemas` entries whose `fileMatch` matches the document.
2. `xmlEditor.schemas` entries whose `namespace` the document declares.
3. `xsi:schemaLocation` and `xsi:noNamespaceSchemaLocation` in the document, unless a setting already
   maps that namespace (so a setting can redirect a remote schema to a local copy).

Schemas are registered in the user `settings.json` or a workspace's `.vscode/settings.json`; both use
the same shape. Use **XML: Associate Schema with Current File** from the Command Palette to write an
entry for you.

```jsonc
// .vscode/settings.json
{
  "xmlEditor.schemas": [
    {
      // Relative to the workspace folder. A pattern without "/" matches the file name anywhere.
      "fileMatch": ["config/*.xml", "app.manifest.xml"],
      "url": "./schemas/app.xsd"
    },
    {
      // Any document declaring xmlns="urn:example:orders" (or a prefix for it) uses this schema.
      "namespace": "urn:example:orders",
      "url": "${workspaceFolder}/schemas/orders.xsd"
    },
    {
      "fileMatch": ["**/*.feed.xml"],
      "url": "https://example.com/schemas/feed.xsd"
    }
  ]
}
```

`url` accepts a path relative to the workspace folder, an absolute path, `${workspaceFolder}/...`,
`~/...` or `${userHome}/...`, a `file://` URI, or an `http(s)://` URL. Included and imported schemas
are followed from there. Schemas are cached; the cache is cleared whenever an `.xsd` file in the
workspace is saved or changes on disk, when these settings change, and by **XML: Reload Schemas**.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `xmlEditor.fileExtensions` | `[".xml", ".xsd"]` | Extensions the editor serves. Extensions VS Code does not already treat as XML also need a `files.associations` entry, for example `"*.manifest": "xml"`. |
| `xmlEditor.schemas` | `[]` | Schema associations, as above. |
| `xmlEditor.validation.enabled` | `true` | Report well-formedness, namespace, and schema errors. |
| `xmlEditor.schemaLocation.enabled` | `true` | Use `xsi:schemaLocation` hints in documents. |
| `xmlEditor.schemaDownload.enabled` | `true` | Allow `http(s)` schemas to be downloaded. Never applies in untrusted workspaces. |
| `xmlEditor.completion.autoCloseTags` | `true` | Insert end tags as you type. |
| `xmlEditor.format.enabled` | `true` | Enable the formatter. |
| `xmlEditor.format.splitAttributes` | `false` | One attribute per line when an element has several. |
| `xmlEditor.format.selfCloseEmptyElements` | `false` | Rewrite `<a></a>` as `<a />`. |
| `xmlEditor.format.spaceBeforeSelfClose` | `true` | Write `<a />` rather than `<a/>`. |
| `xmlEditor.format.preserveBlankLines` | `true` | Keep one blank line where the source had blank lines between elements. |

The extension also sets defaults for the `[xml]` language so completion opens while typing, including
inside attribute values: `editor.quickSuggestions` is on for code and strings, and
`editor.suggest.insertMode` is `replace`. Override either under `"[xml]"` in your settings.

## How formatting treats content

The formatter only rewrites whitespace that sits between markup in element-only content and between
attributes. Text-only and mixed content, attribute values, comments, CDATA sections, processing
instructions, and anything under `xml:space="preserve"` are written back exactly as they were. A
document that is not well-formed is left unchanged, with the reason shown in the status bar.

## Limits of validation

Validation is structural and errs toward silence. It does not check the order or exact count of
child elements, facets other than enumerations (patterns, lengths, ranges, numeric formats), identity
constraints (`xs:key`, `xs:unique`), or DTDs. When part of a schema cannot be resolved (an import
that fails to load, an unsupported construct), the affected content is not reported rather than
reported falsely.

## Workspace trust

In an untrusted workspace, schemas are never downloaded, and `xmlEditor.schemas` and
`xmlEditor.schemaDownload.enabled` are read from user settings only.

## Development

```sh
npm ci
npm test                 # compile and run unit tests (node:test)
npm run test:integration # launch VS Code with the extension and run end-to-end checks
npm run package          # build a .vsix
```

`npm run test:integration` downloads VS Code into `.vscode-test/`; on Linux without a display run it
under `xvfb-run -a`. Set `VSCODE_TEST_VERSION` (for example `1.85.2`) to test a specific version.
Press F5 in this folder to launch an Extension Development Host.

Releases are published by `.github/workflows/extension-vscode-xml-editor.yml` when `version` in
`package.json` is not yet on the Marketplace; see that workflow for details.
