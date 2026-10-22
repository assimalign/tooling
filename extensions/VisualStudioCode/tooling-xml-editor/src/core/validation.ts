/**
 * Well-formedness, namespace, and structural schema validation.
 *
 * Schema checks are deliberately conservative: an element or attribute is only reported as not
 * allowed when the governing content model was fully resolved and has no matching wildcard, so an
 * unresolvable import or an unsupported construct produces silence rather than a false error.
 * Particle order and cardinality beyond "required" and facets other than enumerations are not checked.
 */

import { DocumentModel } from './model';
import {
    XML_NAMESPACE,
    XMLNS_NAMESPACE,
    XSI_NAMESPACE,
    XmlDiagnostic,
    XmlDocument,
    XmlElement,
    attributeNamespace,
    childElements,
    elementNamespace,
    forEachElement,
    splitQualifiedName,
    textContent
} from './parser';
import { SchemaSet, componentKey, wildcardAllows } from './schema';

export function validateDocument(document: XmlDocument, schemas: SchemaSet | undefined): XmlDiagnostic[] {
    const diagnostics: XmlDiagnostic[] = [...document.diagnostics];
    validateNamespaces(document, diagnostics);

    if (schemas !== undefined && document.root !== undefined) {
        const model = new DocumentModel(document, schemas);
        const root = document.root;
        const namespace = elementNamespace(root);
        if (namespace !== undefined && schemas.governs(namespace)) {
            if (model.declarationOf(root) === undefined) {
                diagnostics.push(error(root, `Element '${root.name}' is not declared as a root element${namespace ? ` in namespace '${namespace}'` : ''}.`));
            }
            else {
                validateElement(model, root, diagnostics);
            }
        }
        else if (namespace !== undefined) {
            // The root is not governed (for example an unknown wrapper); still check governed islands below it.
            validateGovernedDescendants(model, root, diagnostics);
        }
    }

    return diagnostics;
}

function error(element: XmlElement, message: string): XmlDiagnostic {
    return { start: element.nameStart, end: Math.max(element.nameEnd, element.nameStart + 1), message, severity: 'error' };
}

function validateNamespaces(document: XmlDocument, diagnostics: XmlDiagnostic[]): void {
    forEachElement(document.children, element => {
        if (element.name.length > 0 && elementNamespace(element) === undefined) {
            const { prefix } = splitQualifiedName(element.name);
            diagnostics.push(error(element, `The namespace prefix '${prefix}' is not declared.`));
        }

        for (const attribute of element.attributes) {
            if (attributeNamespace(element, attribute) === undefined) {
                const { prefix } = splitQualifiedName(attribute.name);
                diagnostics.push({
                    start: attribute.nameStart,
                    end: attribute.nameEnd,
                    message: `The namespace prefix '${prefix}' is not declared.`,
                    severity: 'error'
                });
            }
        }
    });
}

function validateGovernedDescendants(model: DocumentModel, element: XmlElement, diagnostics: XmlDiagnostic[]): void {
    for (const child of childElements(element)) {
        const namespace = elementNamespace(child);
        if (namespace !== undefined && namespace !== '' && model.schemas.governs(namespace) && model.declarationOf(child) !== undefined) {
            validateElement(model, child, diagnostics);
        }
        else {
            validateGovernedDescendants(model, child, diagnostics);
        }
    }
}

function validateElement(model: DocumentModel, element: XmlElement, diagnostics: XmlDiagnostic[]): void {
    const schemas = model.schemas;
    const type = model.typeOf(element);
    if (type === undefined) {
        return;
    }

    validateAttributes(model, element, diagnostics);

    const children = schemas.childrenOf(type);
    const elementChildren = childElements(element);
    const present = new Set<string>();
    for (const child of elementChildren) {
        const namespace = elementNamespace(child);
        if (namespace === undefined) {
            continue;
        }

        const key = componentKey(namespace, splitQualifiedName(child.name).localName);
        present.add(key);
        if (children.elements.has(key)) {
            validateElement(model, child, diagnostics);
        }
        else if (children.wildcards.some(wildcard => wildcardAllows(wildcard, namespace))) {
            // Lax (and, conservatively, strict) processing: validate what the loaded schemas know,
            // accept what they do not. Content admitted only by skip wildcards is never validated.
            const validated = children.wildcards.some(wildcard => wildcardAllows(wildcard, namespace) && wildcard.processContents !== 'skip');
            if (validated && model.declarationOf(child) !== undefined && schemas.governs(namespace)) {
                validateElement(model, child, diagnostics);
            }
        }
        else if (children.complete) {
            const simple = type.kind === 'simple' || type.simpleContent;
            diagnostics.push(error(child, simple
                ? `Element '${element.name}' cannot contain child elements.`
                : `Element '${child.name}' is not allowed in '${element.name}'.`));
        }
    }

    if (children.complete) {
        for (const [key, child] of children.elements) {
            if (child.required && !present.has(key)) {
                diagnostics.push(error(element, `Element '${element.name}' is missing required child element '${child.declaration.name}'.`));
            }
        }
    }

    if (elementChildren.length === 0 && !isNil(element)) {
        const simpleType = schemas.simpleTypeOf(type);
        if (schemas.isClosedEnumeration(simpleType)) {
            const value = textContent(model.document, element).trim();
            const allowed = schemas.enumerations(simpleType).map(enumeration => enumeration.value);
            if (!allowed.includes(value)) {
                diagnostics.push(error(element, `Value '${value}' is not valid for '${element.name}'. Expected one of: ${allowed.join(', ')}.`));
            }
        }
    }
}

function isNil(element: XmlElement): boolean {
    return element.attributes.some(attribute =>
        attribute.value === 'true'
        && splitQualifiedName(attribute.name).localName === 'nil'
        && attributeNamespace(element, attribute) === XSI_NAMESPACE);
}

function validateAttributes(model: DocumentModel, element: XmlElement, diagnostics: XmlDiagnostic[]): void {
    const schemas = model.schemas;
    const resolved = model.attributesOf(element);
    if (resolved === undefined) {
        return;
    }

    const present = new Set<string>();
    for (const attribute of element.attributes) {
        const namespace = attributeNamespace(element, attribute);
        if (namespace === undefined || namespace === XMLNS_NAMESPACE || namespace === XSI_NAMESPACE) {
            continue;
        }

        const key = componentKey(namespace, splitQualifiedName(attribute.name).localName);
        present.add(key);
        const declaration = resolved.attributes.get(key);
        if (declaration === undefined) {
            const admitted = resolved.anyAttribute !== undefined && wildcardAllows(resolved.anyAttribute, namespace);
            if (!admitted && resolved.complete && namespace !== XML_NAMESPACE) {
                diagnostics.push({
                    start: attribute.nameStart,
                    end: attribute.nameEnd,
                    message: `Attribute '${attribute.name}' is not allowed on '${element.name}'.`,
                    severity: 'error'
                });
            }
            continue;
        }

        if (attribute.value === undefined || attribute.valueStart === undefined || attribute.valueEnd === undefined) {
            continue;
        }

        const type = schemas.attributeType(declaration.declaration);
        const value = attribute.value.trim();
        const allowed = schemas.enumerations(type).map(enumeration => enumeration.value);
        const valid = declaration.fixedValue !== undefined
            ? value === declaration.fixedValue
            : !schemas.isClosedEnumeration(type) || allowed.includes(value);
        if (!valid) {
            diagnostics.push({
                start: attribute.valueStart,
                end: attribute.valueEnd,
                message: declaration.fixedValue !== undefined
                    ? `Attribute '${attribute.name}' must have the fixed value '${declaration.fixedValue}'.`
                    : `Value '${value}' is not valid for attribute '${attribute.name}'. Expected one of: ${allowed.join(', ')}.`,
                severity: 'error'
            });
        }
    }

    if (resolved.complete) {
        for (const [key, attribute] of resolved.attributes) {
            if (attribute.use === 'required' && !present.has(key)) {
                diagnostics.push(error(element, `Element '${element.name}' is missing required attribute '${attribute.declaration.name}'.`));
            }
        }
    }
}
