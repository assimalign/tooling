using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;
using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Text;

namespace Assimalign.CodeAnalysis.Internal;

//[DiagnosticAnalyzer(LanguageNames.CSharp)]
internal class UseCancellationTokenWithAsyncDiagnosticAnalyzer : DiagnosticAnalyzer
{
    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => 
        throw new NotImplementedException();

    public override void Initialize(AnalysisContext context)
    {
        throw new NotImplementedException();
    }
}
