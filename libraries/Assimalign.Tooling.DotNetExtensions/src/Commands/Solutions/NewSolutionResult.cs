using System.Collections.Generic;
using System.IO;

namespace Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

/// <summary>
/// The outcome of a solution generation run.
/// </summary>
public sealed class NewSolutionResult
{
    /// <summary>
    /// The generated solution file.
    /// </summary>
    public required FileInfo File { get; init; }

    /// <summary>
    /// The number of projects written into the solution.
    /// </summary>
    public int ProjectCount { get; init; }

    /// <summary>
    /// The number of external project references written into the reference folder.
    /// </summary>
    public int ReferenceCount { get; init; }

    /// <summary>
    /// The references that could not be located under the search root.
    /// </summary>
    public IReadOnlyList<string> UnresolvedReferences { get; init; } = [];
}
