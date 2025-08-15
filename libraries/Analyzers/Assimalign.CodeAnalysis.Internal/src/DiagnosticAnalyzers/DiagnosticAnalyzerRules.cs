using Microsoft.CodeAnalysis;
using System;
using System.Collections.Generic;
using System.Text;

namespace Assimalign.CodeAnalysis.Internal;

internal static class DiagnosticAnalyzerRules
{
    public static readonly DiagnosticDescriptor InvalidAsyncMethodName = new DiagnosticDescriptor(
        id: "AA0001",
        title: "Invalid Async Method Name",
        messageFormat: "The method name {0}  must end in Async",
        category: "Naming",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    public static readonly DiagnosticDescriptor InvalidAsyncMethodName2 = new DiagnosticDescriptor(
        id: "AA0001",
        title: "Invalid Async Method Name",
        messageFormat: "The method name {0}  must end in Async",
        category: "Naming",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);
}
