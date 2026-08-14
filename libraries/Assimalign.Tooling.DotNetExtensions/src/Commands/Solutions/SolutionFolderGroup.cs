using System;
using System.Collections.Generic;
using System.Linq;

namespace Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

/// <summary>
/// Re-parents a set of source directories underneath a single solution folder, letting the
/// generated solution present a different shape to the one on disk.
/// </summary>
public sealed class SolutionFolderGroup
{
    public SolutionFolderGroup(string folder, IEnumerable<string> paths)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folder);
        ArgumentNullException.ThrowIfNull(paths);

        Folder = folder.Replace('\\', '/').Trim('/');

        if (Folder.Length == 0)
        {
            throw new ArgumentException("A solution folder name is required.", nameof(folder));
        }

        // Paths are compared against solution folder names, which are always slash delimited and
        // always carry a leading and trailing separator.
        Paths = paths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => string.Concat("/", path.Replace('\\', '/').Trim('/'), "/"))
            .ToArray();

        if (Paths.Count == 0)
        {
            throw new ArgumentException($"At least one path is required for the '{Folder}' group.", nameof(paths));
        }
    }

    /// <summary>
    /// The solution folder the matched paths are nested under.
    /// </summary>
    public string Folder { get; }

    /// <summary>
    /// The solution relative paths that belong to the group.
    /// </summary>
    public IReadOnlyList<string> Paths { get; }
}
