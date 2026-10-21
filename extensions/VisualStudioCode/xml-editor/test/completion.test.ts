import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CompletionSuggestion, getCompletions } from '../src/core/completion';
import { parseXml } from '../src/core/parser';
import { SchemaSet } from '../src/core/schema';
import { cursor, loadBundledSchema, loadFixtures } from './helpers';

function complete(textWithCursor: string, schemas: SchemaSet | undefined, knownNamespaces: string[] = []): CompletionSuggestion[] {
    const { text, offset } = cursor(textWithCursor);
    return getCompletions(parseXml(text), offset, schemas, { knownNamespaces });
}

function labels(suggestions: readonly CompletionSuggestion[]): string[] {
    return suggestions.map(suggestion => suggestion.label);
}

const header = '<library xmlns="urn:library" version="1">';

describe('element completion', () => {
    it('offers root elements and declares their namespace', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestions = complete('<|', schemas);

        // book and magazine substitute for item, so they belong inside library, not at the root.
        assert.deepEqual(labels(suggestions), ['library']);
        const library = suggestions.find(suggestion => suggestion.label === 'library')!;
        assert.equal(library.insertText, 'library xmlns="urn:library" version="${1}"$2>$0</library>');
        assert.equal(library.isSnippet, true);
        assert.equal(library.documentation, 'A collection of books.');
    });

    it('offers children in content-model order, required first, without abstract heads', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestions = complete(`${header}\n  <|\n</library>`, schemas)
            .filter(suggestion => suggestion.kind === 'element')
            .sort((left, right) => left.sortText!.localeCompare(right.sortText!));

        assert.deepEqual(labels(suggestions), ['name', 'book', 'magazine']);
        assert.match(suggestions[0]!.detail!, /required/);
    });

    it('stops offering an element once its maxOccurs is reached', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestions = complete(`${header}<name>n</name><|</library>`, schemas);

        assert.ok(!labels(suggestions).includes('name'));
        assert.ok(labels(suggestions).includes('book'));
    });

    it('writes only the name when renaming an existing tag', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestion = complete(`${header}<bo|ok id="1"></book></library>`, schemas).find(candidate => candidate.label === 'book')!;

        assert.equal(suggestion.insertText, 'book');
        assert.equal(suggestion.isSnippet, false);
    });

    it('uses the declared prefix of the namespace', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestions = complete('<l:library xmlns:l="urn:library" version="1"><|</l:library>', schemas);

        assert.ok(labels(suggestions).includes('l:name'));
    });

    it('falls back to element names used in the document without a schema', () => {
        const suggestions = complete('<root><alpha/><beta/><|</root>', undefined);

        assert.deepEqual(labels(suggestions.filter(suggestion => suggestion.kind === 'element')).sort(), ['alpha', 'beta', 'root']);
    });

    it('offers the end tag of an unclosed parent', () => {
        assert.ok(labels(complete('<root><a><|', undefined)).includes('/a'));
    });
});

describe('end tag completion', () => {
    it('completes the innermost open element after </', () => {
        const suggestions = complete('<root><child></|', undefined);

        assert.deepEqual(suggestions.map(suggestion => suggestion.insertText), ['child>']);
    });

    it('does not duplicate an existing >', () => {
        const suggestions = complete('<root><child></ch|></root>', undefined);

        assert.deepEqual(suggestions.map(suggestion => suggestion.insertText), ['child']);
    });
});

describe('attribute completion', () => {
    it('offers declared attributes, required first, with value snippets', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestions = complete(`${header}<book |></book></library>`, schemas)
            .filter(suggestion => !suggestion.label.startsWith('xmlns'))
            .sort((left, right) => left.sortText!.localeCompare(right.sortText!));

        assert.deepEqual(labels(suggestions), ['id', 'available', 'status']);
        assert.equal(suggestions[0]!.insertText, 'id="$1"');
        assert.equal(suggestions.find(suggestion => suggestion.label === 'status')!.retrigger, true);
    });

    it('omits attributes that are already present', async () => {
        const schemas = await loadFixtures('library.xsd');
        assert.ok(!labels(complete(`${header}<book id="1" |></book></library>`, schemas)).includes('id'));
    });

    it('offers xsi attributes once the namespace is declared', () => {
        const suggestions = complete('<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" |/>', undefined);

        assert.ok(labels(suggestions).includes('xsi:schemaLocation'));
        assert.ok(labels(suggestions).includes('xsi:noNamespaceSchemaLocation'));
    });

    it('offers to declare xmlns:xsi when it is missing', () => {
        const suggestion = complete('<root |/>', undefined).find(candidate => candidate.label === 'xmlns:xsi')!;

        assert.equal(suggestion.insertText, 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"$0');
    });
});

describe('attribute value completion', () => {
    it('offers enumerations with their documentation', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestions = complete(`${header}<book status="|"></book></library>`, schemas);

        assert.deepEqual(labels(suggestions), ['active', 'retired']);
        assert.equal(suggestions[0]!.detail, 'default');
        assert.equal(suggestions[0]!.documentation, 'Can be borrowed.');
    });

    it('offers true and false for xs:boolean', async () => {
        const schemas = await loadFixtures('library.xsd');
        assert.deepEqual(labels(complete(`${header}<book available="t|"></book></library>`, schemas)), ['true', 'false']);
    });

    it('adds quotes when the value has none yet', async () => {
        const schemas = await loadFixtures('library.xsd');
        const suggestions = complete(`${header}<book status=|></book></library>`, schemas);

        assert.equal(suggestions[0]!.insertText, '"active"');
    });

    it('offers registered namespaces for xmlns', () => {
        assert.deepEqual(labels(complete('<root xmlns="|"/>', undefined, ['urn:a', 'urn:b'])), ['urn:a', 'urn:b']);
    });

    it('falls back to values used in the document', () => {
        assert.deepEqual(labels(complete('<r><a k="one"/><a k="two"/><a k="|"/></r>', undefined)), ['one', 'two']);
    });
});

describe('content completion', () => {
    it('offers enumerations of a simple-typed element', async () => {
        const schemas = await loadFixtures('library.xsd');
        assert.deepEqual(labels(complete(`${header}<book id="b"><format>|</format></book></library>`, schemas)), ['hardcover', 'paperback']);
    });
});

describe('XML Schema authoring', () => {
    it('offers xs:schema at the root of an empty document', async () => {
        const schemas = await loadBundledSchema();
        assert.deepEqual(labels(complete('<|', schemas)), ['schema']);
    });

    it('offers schema children with documentation', async () => {
        const schemas = await loadBundledSchema();
        const suggestions = complete('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <|\n</xs:schema>', schemas);

        for (const expected of ['xs:element', 'xs:complexType', 'xs:simpleType', 'xs:import', 'xs:annotation']) {
            assert.ok(labels(suggestions).includes(expected), expected);
        }
        assert.match(suggestions.find(suggestion => suggestion.label === 'xs:element')!.documentation!, /global element/);
    });

    it('offers particles inside a sequence and facets inside a restriction', async () => {
        const schemas = await loadBundledSchema();
        const sequence = complete('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:complexType name="t"><xs:sequence><|</xs:sequence></xs:complexType></xs:schema>', schemas);
        const restriction = complete('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="t"><xs:restriction base="xs:string"><|</xs:restriction></xs:simpleType></xs:schema>', schemas);

        assert.deepEqual(labels(sequence.filter(suggestion => suggestion.kind === 'element')).sort(), ['xs:annotation', 'xs:any', 'xs:choice', 'xs:element', 'xs:group', 'xs:sequence']);
        assert.ok(labels(restriction).includes('xs:enumeration'));
        assert.ok(labels(restriction).includes('xs:maxLength'));
    });

    it('offers built-in and local types for type references', async () => {
        const schemas = await loadBundledSchema();
        const suggestions = complete(
            '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:t="urn:t" targetNamespace="urn:t">'
            + '<xs:complexType name="Person"/><xs:element name="p" type="|"/></xs:schema>',
            schemas);

        assert.ok(labels(suggestions).includes('t:Person'));
        assert.ok(labels(suggestions).includes('xs:string'));
    });

    it('offers enumerated attribute values from the bundled schema', async () => {
        const schemas = await loadBundledSchema();
        const suggestions = complete('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="|"/>', schemas);

        assert.deepEqual(labels(suggestions), ['qualified', 'unqualified']);
    });
});
