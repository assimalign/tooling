import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SchemaLoader, componentKey, readSchemaDocument } from '../src/core/schema';
import { fixtureUri, loadFixtures } from './helpers';

const library = 'urn:library';

describe('readSchemaDocument', () => {
    it('reads global components and documentation', () => {
        const document = readSchemaDocument(
            '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t">'
            + '<xs:element name="a" type="xs:string"><xs:annotation><xs:documentation>\n    First line.\n      Indented.\n  </xs:documentation></xs:annotation></xs:element>'
            + '</xs:schema>',
            'file:///t.xsd');

        const element = document.elements.get(componentKey('urn:t', 'a'))!;
        assert.equal(element.documentation, 'First line.\n  Indented.');
        assert.equal(element.typeName, componentKey('http://www.w3.org/2001/XMLSchema', 'string'));
    });

    it('reports a document that is not a schema', () => {
        const document = readSchemaDocument('<root/>', 'file:///x.xsd');
        assert.equal(document.problems.length, 1);
    });
});

describe('SchemaSet', () => {
    it('follows a chameleon include into the including namespace', async () => {
        const schemas = await loadFixtures('library.xsd');

        assert.deepEqual(schemas.problems, []);
        assert.ok(schemas.resolveType(componentKey(library, 'statusType')));
    });

    it('resolves extension content, substitution groups, and abstract heads', async () => {
        const schemas = await loadFixtures('library.xsd');
        const libraryType = schemas.typeOf(schemas.element(library, 'library')!);
        const children = schemas.childrenOf(libraryType);

        assert.deepEqual([...children.elements.keys()], [
            componentKey(library, 'name'),
            componentKey(library, 'book'),
            componentKey(library, 'magazine')
        ]);
        assert.equal(children.elements.get(componentKey(library, 'name'))!.required, true);
        assert.equal(children.elements.get(componentKey(library, 'book'))!.required, false);

        const bookChildren = schemas.childrenOf(schemas.typeOf(schemas.element(library, 'book')!));
        assert.deepEqual([...bookChildren.elements.keys()].map(key => key.slice(key.indexOf('}') + 1)), ['title', 'author', 'format', 'note', 'extra']);
    });

    it('collects attributes through extension and attribute groups', async () => {
        const schemas = await loadFixtures('library.xsd');
        const attributes = schemas.attributesOf(schemas.typeOf(schemas.element(library, 'book')!));

        assert.equal(attributes.complete, true);
        assert.deepEqual([...attributes.attributes.values()].map(attribute => [attribute.declaration.name, attribute.use]), [
            ['id', 'required'],
            ['status', 'optional'],
            ['available', 'optional']
        ]);
    });

    it('lists enumerations of restricted, built-in, and union types', async () => {
        const schemas = await loadFixtures('library.xsd');
        const status = schemas.resolveType(componentKey(library, 'statusType'));
        const boolean = schemas.resolveType(componentKey('http://www.w3.org/2001/XMLSchema', 'boolean'));

        assert.deepEqual(schemas.enumerations(status?.kind === 'simple' ? status : undefined).map(value => value.value), ['active', 'retired']);
        assert.deepEqual(schemas.enumerations(boolean?.kind === 'simple' ? boolean : undefined).map(value => value.value), ['true', 'false']);
    });

    it('records unreadable schemas as problems instead of failing', async () => {
        const loader = new SchemaLoader(uri => uri.endsWith('missing.xsd') ? Promise.reject(new Error('not found')) : Promise.resolve(
            '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:import namespace="urn:x" schemaLocation="missing.xsd"/></xs:schema>'));
        const schemas = await loader.load(['file:///root.xsd']);

        assert.equal(schemas.problems.length, 1);
        assert.match(schemas.problems[0]!.message, /not found/);
        assert.equal(schemas.problems[0]!.uri, 'file:///missing.xsd');
    });

    it('caches loaded sets until cleared', async () => {
        let reads = 0;
        const loader = new SchemaLoader(() => {
            reads++;
            return Promise.resolve('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>');
        });

        await loader.load([fixtureUri('a.xsd')]);
        await loader.load([fixtureUri('a.xsd')]);
        assert.equal(reads, 1);

        loader.clear();
        await loader.load([fixtureUri('a.xsd')]);
        assert.equal(reads, 2);
    });
});
