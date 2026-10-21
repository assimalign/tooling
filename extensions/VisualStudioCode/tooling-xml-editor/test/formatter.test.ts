import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAutoCloseText } from '../src/core/autoClose';
import { FormatOptions, defaultFormatOptions, formatXml } from '../src/core/formatter';
import { getHover } from '../src/core/hover';
import { parseXml } from '../src/core/parser';
import { cursor, loadFixtures } from './helpers';

function format(text: string, options: Partial<FormatOptions> = {}): string {
    const result = formatXml(text, { ...defaultFormatOptions, ...options });
    assert.equal(result.kind, 'formatted');
    return result.kind === 'formatted' ? result.text : '';
}

describe('formatXml', () => {
    it('indents element-only content', () => {
        assert.equal(
            format('<?xml version="1.0"?>\n<root><a>\n<b   x="1"    y=\'2\'/></a>   <c></c></root>\n'),
            '<?xml version="1.0"?>\n<root>\n  <a>\n    <b x="1" y=\'2\' />\n  </a>\n  <c></c>\n</root>\n');
    });

    it('keeps text-only and mixed content exactly as written', () => {
        assert.equal(
            format('<root><t>  spaced  text </t><p>Hello <b>bold</b> world</p></root>'),
            '<root>\n  <t>  spaced  text </t>\n  <p>Hello <b>bold</b> world</p>\n</root>');
    });

    it('keeps comments, CDATA, and processing instructions', () => {
        assert.equal(
            format('<root><!-- note --><?pi data?><d><![CDATA[ <raw> ]]></d></root>'),
            '<root>\n  <!-- note -->\n  <?pi data?>\n  <d><![CDATA[ <raw> ]]></d>\n</root>');
    });

    it('honors xml:space="preserve"', () => {
        assert.equal(
            format('<root><pre xml:space="preserve">\n  <a/>\n</pre></root>'),
            '<root>\n  <pre xml:space="preserve">\n  <a/>\n</pre>\n</root>');
    });

    it('splits attributes when asked', () => {
        assert.equal(
            format('<root a="1" b="2"><c d="3"/></root>', { splitAttributes: true }),
            '<root\n  a="1"\n  b="2">\n  <c d="3" />\n</root>');
    });

    it('self-closes empty elements when asked', () => {
        assert.equal(format('<root><a></a><b>\n</b></root>', { selfCloseEmptyElements: true, spaceBeforeSelfClose: false }), '<root>\n  <a/>\n  <b/>\n</root>');
    });

    it('keeps one blank line between elements', () => {
        assert.equal(format('<root>\n<a/>\n\n\n<b/>\n</root>'), '<root>\n  <a />\n\n  <b />\n</root>');
        assert.equal(format('<root>\n<a/>\n\n\n<b/>\n</root>', { preserveBlankLines: false }), '<root>\n  <a />\n  <b />\n</root>');
    });

    it('uses the requested indentation and line ending', () => {
        assert.equal(format('<root><a/></root>\r\n', { indent: '\t', newline: '\r\n' }), '<root>\r\n\t<a />\r\n</root>\r\n');
    });

    it('is idempotent', () => {
        const once = format('<root><a x="1"><b/>\n\n<c>t</c></a></root>\n');
        assert.equal(format(once), once);
    });

    it('refuses a document that is not well-formed', () => {
        const result = formatXml('<root><a></root>');
        assert.equal(result.kind, 'notWellFormed');
    });
});

describe('getAutoCloseText', () => {
    it('closes a start tag after >', () => {
        const { text, offset } = cursor('<root><item>|</root>');
        assert.equal(getAutoCloseText(text, offset), '</item>');
    });

    it('does nothing for self-closing tags, existing end tags, or > inside a value', () => {
        for (const sample of ['<root><item/>|</root>', '<root><item>|</item></root>', '<root a="x>|"></root>']) {
            const { text, offset } = cursor(sample);
            assert.equal(getAutoCloseText(text, offset), undefined, sample);
        }
    });

    it('completes the open element after </', () => {
        const { text, offset } = cursor('<root><item>text</|</root>');
        assert.equal(getAutoCloseText(text, offset), 'item>');
    });
});

describe('getHover', () => {
    it('describes elements, attributes, and enumerated values', async () => {
        const schemas = await loadFixtures('library.xsd');
        const hoverAt = (sample: string) => {
            const { text, offset } = cursor(sample);
            return getHover(parseXml(text), offset, schemas)?.contents;
        };

        assert.equal(hoverAt('<lib|rary xmlns="urn:library" version="1"/>'), '`library`\n\nA collection of books.');
        assert.match(hoverAt('<library xmlns="urn:library" version="1"><book i|d="1"/></library>')!, /\*\*Required\.\*\*[\s\S]*Unique identifier\./);
        assert.equal(hoverAt('<library xmlns="urn:library" version="1"><book status="act|ive"/></library>'), 'Can be borrowed.');
    });
});
