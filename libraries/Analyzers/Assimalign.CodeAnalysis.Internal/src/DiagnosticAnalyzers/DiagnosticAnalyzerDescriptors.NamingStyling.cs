using Microsoft.CodeAnalysis;
using System;
using System.Collections.Generic;
using System.Text;

namespace Assimalign.CodeAnalysis.Internal;

internal static partial class DiagnosticAnalyzerDescriptors
{
    /*
     
     
     */
    public static readonly DiagnosticDescriptor AA0001 = new DiagnosticDescriptor(
        id: "AA0001",
        title: "Methods that return Task must end in Async",
        messageFormat: "The method name {0}.{1} must end in Async",
        category: "Naming",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);
}
