import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { parseXml } from '../src/core/parser';
import { SchemaSet } from '../src/core/schema';
import { validateDocument } from '../src/core/validation';
import { bundledSchemaPath, fixturesDirectory, loadBundledSchema, loadFixtures } from './helpers';

function messages(text: string, schemas: SchemaSet | undefined): string[] {
    return validateDocument(parseXml(text), schemas).map(diagnostic => diagnostic.message);
}

const valid = `<library xmlns="urn:library" xmlns:x="urn:extra" version="1">
  <name>City</name>
  <book id="b1" status="active" available="true">
    <title>XML</title>
    <author>A</author>
    <format>paperback</format>
    <note lang="en">Signed</note>
    <extra x:anything="1"><x:custom/></extra>
  </book>
  <magazine id="m1"><title>Monthly</title></magazine>
</library>`;

describe('validateDocument', () => {
    it('accepts a valid document', async () => {
        assert.deepEqual(messages(valid, await loadFixtures('library.xsd')), []);
    });

    it('reports elements that are not allowed and missing required children', async () => {
        const result = messages('<library xmlns="urn:library" version="1"><book id="b"><title/><author/><bogus/></book></library>', await loadFixtures('library.xsd'));

        assert.deepEqual(result, [
            'Element \'bogus\' is not allowed in \'book\'.',
            'Element \'library\' is missing required child element \'name\'.'
        ]);
    });

    it('reports unknown, missing, and invalid attributes', async () => {
        const result = messages('<library xmlns="urn:library"><name/><book id="b" status="lost" colour="red"><title/><author/></book></library>', await loadFixtures('library.xsd'));

        assert.deepEqual(result, [
            'Element \'library\' is missing required attribute \'version\'.',
            'Value \'lost\' is not valid for attribute \'status\'. Expected one of: active, retired.',
            'Attribute \'colour\' is not allowed on \'book\'.'
        ]);
    });

    it('reports an invalid enumerated element value', async () => {
        const result = messages('<library xmlns="urn:library" version="1"><name/><book id="b"><title/><author/><format>scroll</format></book></library>', await loadFixtures('library.xsd'));

        assert.deepEqual(result, ['Value \'scroll\' is not valid for \'format\'. Expected one of: hardcover, paperback.']);
    });

    it('reports a root element the schema does not declare', async () => {
        assert.deepEqual(messages('<shelf xmlns="urn:library"/>', await loadFixtures('library.xsd')), [
            'Element \'shelf\' is not declared as a root element in namespace \'urn:library\'.'
        ]);
    });

    it('stays silent for namespaces no schema governs', async () => {
        assert.deepEqual(messages('<anything xmlns="urn:unknown"><x y="z"/></anything>', await loadFixtures('library.xsd')), []);
    });

    it('does not validate content admitted only by a skip wildcard', async () => {
        const schemas = new SchemaSet();
        const { readSchemaDocument } = await import('../src/core/schema');
        schemas.add(readSchemaDocument(
            '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">'
            + '<xs:element name="r"><xs:complexType><xs:sequence>'
            + '<xs:any processContents="skip" minOccurs="0" maxOccurs="unbounded"/>'
            + '</xs:sequence></xs:complexType></xs:element>'
            + '<xs:element name="strict"><xs:complexType/></xs:element>'
            + '</xs:schema>',
            'file:///r.xsd'));

        assert.deepEqual(messages('<r><strict unexpected="1"><child/></strict></r>', schemas), []);
    });

    it('reports undeclared prefixes without a schema', () => {
        assert.deepEqual(messages('<p:root/>', undefined), ['The namespace prefix \'p\' is not declared.']);
    });

    it('stays silent when a referenced type cannot be resolved', async () => {
        const schemas = new SchemaSet();
        const { readSchemaDocument } = await import('../src/core/schema');
        schemas.add(readSchemaDocument(
            '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:o="urn:other"><xs:element name="r" type="o:Missing"/></xs:schema>',
            'file:///r.xsd'));

        assert.deepEqual(messages('<r><anything/></r>', schemas), []);
    });

    it('accepts the bundled schema and the test fixtures against the bundled schema', async () => {
        const schemas = await loadBundledSchema();
        const files = [
            bundledSchemaPath,
            path.join(fixturesDirectory, 'library.xsd'),
            path.join(fixturesDirectory, 'common.xsd')
        ];

        for (const file of files) {
            assert.deepEqual(messages(fs.readFileSync(file, 'utf8'), schemas), [], file);
        }
    });

    it('reports XSD authoring mistakes with the bundled schema', async () => {
        const result = messages(
            '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="yes">'
            + '<xs:element type="xs:string"/><xs:sequence/></xs:schema>',
            await loadBundledSchema());

        assert.deepEqual(result, [
            'Value \'yes\' is not valid for attribute \'elementFormDefault\'. Expected one of: qualified, unqualified.',
            'Element \'xs:element\' is missing required attribute \'name\'.',
            'Element \'xs:sequence\' is not allowed in \'xs:schema\'.'
        ]);
    });
});
