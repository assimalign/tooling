using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis;
using System;
using System.Linq;
using System.Collections.Generic;
using System.Text;
using Microsoft.CodeAnalysis.CSharp;
using System.Collections.Immutable;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System.Xml.Linq;

namespace Assimalign.CodeAnalysis.Internal;


[DiagnosticAnalyzer(LanguageNames.CSharp)]
public class InvalidAsyncMethodNameDiagnosticAnalyzer : DiagnosticAnalyzer
{
    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(DiagnosticAnalyzerRules.InvalidAsyncMethodName);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterSyntaxNodeAction(static context =>
        {
            var declaration = (MethodDeclarationSyntax)context.Node;

            // Fast check: if name already ends with Async, skip.
            if (declaration.Identifier.ValueText.EndsWith("Async", StringComparison.Ordinal))
            {
                return;
            }

            var methodSymbol = context.SemanticModel.GetDeclaredSymbol(declaration, context.CancellationToken);

            if (methodSymbol is null)
            {
                return;
            }

            // Only consider methods (exclude accessors, etc.)
            if (methodSymbol.MethodKind != MethodKind.Ordinary)
            {
                return;
            }

            // Return type must be Task or Task<T> (System.Threading.Tasks)
            if (methodSymbol.ReturnType is INamedTypeSymbol returnType &&
                returnType.Name == "Task" &&
                returnType.ContainingNamespace?.ToDisplayString() == "System.Threading.Tasks")
            {
                // Report diagnostic if name does not end with Async
                context.ReportDiagnostic(Diagnostic.Create(
                    DiagnosticAnalyzerRules.InvalidAsyncMethodName,
                    declaration.Identifier.GetLocation(),
                    methodSymbol.Name));
            }


        }, SyntaxKind.MethodDeclaration);
    }
}
