import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XmlElement,
    childElements,
    elementNamespace,
    parseXml,
    prefixForNamespace,
    schemaLocationHints
} from '../src/core/parser';

describe('parseXml', () => {
    it('builds a tree with offsets for a well-formed document', () => {
        const text = '<?xml version="1.0"?>\n<root a="1" b=\'2\'><child/>text<!-- c --><![CDATA[x]]></root>\n';
        const document = parseXml(text);

        assert.deepEqual(document.diagnostics, []);
        const root = document.root!;
        assert.equal(root.name, 'root');
        assert.deepEqual(root.attributes.map(attribute => [attribute.name, attribute.value, attribute.quote]), [['a', '1', '"'], ['b', '2', '\'']]);
        assert.deepEqual(root.children.map(child => child.kind), ['element', 'text', 'comment', 'cdata']);
        assert.equal(text.slice(root.start, root.end), '<root a="1" b=\'2\'><child/>text<!-- c --><![CDATA[x]]></root>');
        assert.equal((root.children[0] as XmlElement).selfClosing, true);
    });

    it('reports unclosed elements and keeps their children', () => {
        const document = parseXml('<root><a><b></b></root>');

        assert.deepEqual(document.diagnostics.map(diagnostic => diagnostic.message), ['Element \'a\' is not closed.']);
        const a = childElements(document.root!)[0]!;
        assert.equal(a.endTagStart, undefined);
        assert.equal(childElements(a)[0]!.name, 'b');
        assert.notEqual(document.root!.endTagStart, undefined);
    });

    it('reports stray end tags, duplicate attributes, and unquoted values', () => {
        const messages = parseXml('<root a="1" a="2" b=3></x></root>').diagnostics.map(diagnostic => diagnostic.message);

        assert.deepEqual(messages, [
            'Attribute \'a\' is specified more than once.',
            'The value of attribute \'b\' must be quoted.',
            'Unexpected end tag \'</x>\'; no element \'x\' is open.'
        ]);
    });

    it('tolerates a start tag that is still being typed', () => {
        const document = parseXml('<root>\n  <item name="a\n</root>');
        const item = childElements(document.root!)[0]!;

        assert.equal(item.name, 'item');
        assert.equal(item.startTagEnd, undefined);
        assert.equal(item.attributes[0]!.valueTerminated, false);
        assert.notEqual(document.root!.endTagStart, undefined, 'the parent still closes');
    });

    it('rejects a second root, text outside the root, and a late XML declaration', () => {
        const messages = parseXml('text<a/><b/>\n<?xml version="1.0"?>').diagnostics.map(diagnostic => diagnostic.message);

        assert.ok(messages.includes('Only one root element is allowed.'));
        assert.ok(messages.includes('Text is not allowed outside the root element.'));
        assert.ok(messages.includes('The XML declaration must be the first thing in the document.'));
    });

    it('skips a DOCTYPE with an internal subset', () => {
        const document = parseXml('<!DOCTYPE note [ <!ENTITY x "a>b"> ]>\n<note/>');

        assert.deepEqual(document.diagnostics, []);
        assert.equal(document.children[0]!.kind, 'declaration');
        assert.equal(document.root!.name, 'note');
    });
});

describe('namespaces', () => {
    it('resolves prefixes and the default namespace through ancestors', () => {
        const document = parseXml('<a xmlns="urn:one" xmlns:p="urn:two"><p:b><c/></p:b></a>');
        const b = childElements(document.root!)[0]!;
        const c = childElements(b)[0]!;

        assert.equal(elementNamespace(document.root!), 'urn:one');
        assert.equal(elementNamespace(b), 'urn:two');
        assert.equal(elementNamespace(c), 'urn:one');
        assert.equal(prefixForNamespace(c, 'urn:two'), 'p');
        assert.equal(prefixForNamespace(c, 'urn:one'), '');
        assert.equal(prefixForNamespace(c, 'urn:three'), undefined);
    });

    it('reports an undeclared prefix as unresolved', () => {
        assert.equal(elementNamespace(parseXml('<q:a/>').root!), undefined);
    });

    it('reads xsi schema location hints', () => {
        const document = parseXml(
            '<a xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            + 'xsi:schemaLocation="urn:one one.xsd  urn:two  two.xsd" xsi:noNamespaceSchemaLocation="none.xsd"/>');

        assert.deepEqual(schemaLocationHints(document), [
            { namespace: 'urn:one', location: 'one.xsd' },
            { namespace: 'urn:two', location: 'two.xsd' },
            { namespace: '', location: 'none.xsd' }
        ]);
    });
});
