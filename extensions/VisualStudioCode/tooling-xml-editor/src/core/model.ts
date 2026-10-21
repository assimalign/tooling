/**
 * Binds the elements of an instance document to the declarations of a schema set.
 */

import {
    XSI_NAMESPACE,
    XmlDocument,
    XmlElement,
    attributeNamespace,
    elementNamespace,
    lookupNamespace,
    splitQualifiedName
} from './parser';
import {
    ElementDeclaration,
    ResolvedAttribute,
    ResolvedAttributes,
    ResolvedChildren,
    SchemaSet,
    TypeDefinition,
    componentKey,
    wildcardAllows
} from './schema';

export class DocumentModel {
    private readonly declarations = new Map<XmlElement, ElementDeclaration | undefined>();

    public constructor(public readonly document: XmlDocument, public readonly schemas: SchemaSet) {
    }

    /**
     * The declaration governing an element. The root is looked up globally; a child is looked up in
     * its parent's content model, then through the parent's wildcards, and finally as a global
     * element so that a partially understood document still gets help below the gap.
     */
    public declarationOf(element: XmlElement): ElementDeclaration | undefined {
        if (this.declarations.has(element)) {
            return this.declarations.get(element);
        }

        const declaration = this.resolveDeclaration(element);
        this.declarations.set(element, declaration);
        return declaration;
    }

    private resolveDeclaration(element: XmlElement): ElementDeclaration | undefined {
        const namespace = elementNamespace(element);
        if (namespace === undefined) {
            return undefined;
        }

        const { localName } = splitQualifiedName(element.name);
        const key = componentKey(namespace, localName);
        const parent = element.parent;
        if (parent !== undefined) {
            const children = this.childrenOf(parent);
            const child = children?.elements.get(key);
            if (child !== undefined) {
                return child.declaration;
            }
        }

        return this.schemas.element(namespace, localName);
    }

    /** The type of an element, honoring `xsi:type`. */
    public typeOf(element: XmlElement): TypeDefinition | undefined {
        for (const attribute of element.attributes) {
            if (attribute.value !== undefined
                && splitQualifiedName(attribute.name).localName === 'type'
                && attributeNamespace(element, attribute) === XSI_NAMESPACE) {
                const { prefix, localName } = splitQualifiedName(attribute.value.trim());
                const namespace = lookupNamespace(element, prefix);
                const type = namespace === undefined ? undefined : this.schemas.resolveType(componentKey(namespace, localName));
                if (type !== undefined) {
                    return type;
                }
            }
        }

        const declaration = this.declarationOf(element);
        return declaration === undefined ? undefined : this.schemas.typeOf(declaration);
    }

    public childrenOf(element: XmlElement): ResolvedChildren | undefined {
        const type = this.typeOf(element);
        return type === undefined ? undefined : this.schemas.childrenOf(type);
    }

    public attributesOf(element: XmlElement): ResolvedAttributes | undefined {
        const type = this.typeOf(element);
        return type === undefined ? undefined : this.schemas.attributesOf(type);
    }

    public attributeDeclaration(element: XmlElement, attributeName: string): ResolvedAttribute | undefined {
        const attribute = element.attributes.find(candidate => candidate.name === attributeName);
        const { prefix, localName } = splitQualifiedName(attributeName);
        const namespace = attribute !== undefined
            ? attributeNamespace(element, attribute)
            : prefix === '' ? '' : lookupNamespace(element, prefix);
        if (namespace === undefined) {
            return undefined;
        }

        const resolved = this.attributesOf(element)?.attributes.get(componentKey(namespace, localName));
        if (resolved !== undefined) {
            return resolved;
        }

        // Attributes admitted by a wildcard are described by their global declaration, if any.
        const global = this.schemas.globalAttributes().find(candidate => candidate.namespace === namespace && candidate.name === localName);
        return global === undefined
            ? undefined
            : { declaration: global, use: 'optional', defaultValue: undefined, fixedValue: undefined, documentation: global.documentation };
    }

    /** True when a wildcard of the parent admits elements of `namespace`. */
    public wildcardAdmits(children: ResolvedChildren, namespace: string): boolean {
        return children.wildcards.some(wildcard => wildcardAllows(wildcard, namespace));
    }
}
