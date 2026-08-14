using System;
using System.Collections.Generic;
using System.IO;

namespace Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

/// <summary>
/// The inputs to <see cref="SolutionGenerator"/>.
/// </summary>
public sealed record NewSolutionOptions
{
    /// <summary>
    /// The solution file extension this tool generates.
    /// </summary>
    public const string SolutionExtension = ".slnx";

    /// <summary>
    /// The default name of the solution folder external references are written into.
    /// </summary>
    public const string DefaultReferenceFolderName = "refs";

    /// <summary>
    /// The default project item element whose 'Include' names an external project reference.
    /// </summary>
    public const string DefaultReferenceElementName = "CohesionProjectReference";

    /// <summary>
    /// The rooted directory the solution is generated from and written to.
    /// </summary>
    public required string SolutionDirectory { get; init; }

    /// <summary>
    /// The file name of the solution, including its extension.
    /// </summary>
    public required string SolutionFileName { get; init; }

    /// <summary>
    /// The name of the root solution folder every generated folder is nested under. Defaults to
    /// the name of <see cref="SolutionDirectory"/>.
    /// </summary>
    public string? SolutionRootFolder { get; init; }

    /// <summary>
    /// Whether project references pointing outside <see cref="SolutionDirectory"/> are resolved
    /// and added to the solution.
    /// </summary>
    public bool IncludeReferences { get; init; }

    /// <summary>
    /// The solution folder resolved references are written into.
    /// </summary>
    public string ReferenceFolderName { get; init; } = DefaultReferenceFolderName;

    /// <summary>
    /// The project item elements whose 'Include' names an external project reference.
    /// </summary>
    public IReadOnlyList<string> ReferenceElementNames { get; init; } = [DefaultReferenceElementName];

    /// <summary>
    /// Whether an existing solution file is overwritten.
    /// </summary>
    public bool Force { get; init; }

    /// <summary>
    /// Wildcard patterns excluding files and directories from the solution.
    /// </summary>
    public IReadOnlyList<string> IgnorePaths { get; init; } = [];

    /// <summary>
    /// Groups that re-parent source directories underneath a single solution folder.
    /// </summary>
    public IReadOnlyList<SolutionFolderGroup> Groups { get; init; } = [];

    /// <summary>
    /// The full path of the solution file.
    /// </summary>
    public string SolutionFilePath => Path.Join(SolutionDirectory, SolutionFileName);

    /// <summary>
    /// Splits the '&lt;path&gt;' argument into the directory the solution is generated from and the
    /// name of the solution file. The path may name the solution file directly
    /// ('./src/Assimalign.Tooling.slnx'), in which case its directory is the generation root;
    /// otherwise <paramref name="name"/> supplies the file name.
    /// </summary>
    /// <exception cref="ArgumentException">Neither the path nor the name yields a file name.</exception>
    public static (string Directory, string FileName) ResolvePath(string path, string? name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        string directory;
        string? fileName = null;

        if (path.EndsWith(SolutionExtension, StringComparison.OrdinalIgnoreCase))
        {
            fileName = Path.GetFileName(path);
            directory = Path.GetDirectoryName(path) is { Length: > 0 } parent ? parent : ".";
        }
        else
        {
            directory = path;
        }

        // An explicit name always wins over one carried by the path.
        if (!string.IsNullOrWhiteSpace(name))
        {
            fileName = name.Trim();
        }

        if (string.IsNullOrWhiteSpace(fileName))
        {
            throw new ArgumentException(
                "A solution file name is required. Provide it as part of the path ('./src/Example.slnx') or with '--name'.");
        }

        if (!fileName.EndsWith(SolutionExtension, StringComparison.OrdinalIgnoreCase))
        {
            fileName = string.Concat(fileName, SolutionExtension);
        }

        // Relative paths are rooted up front because the generated solution is written in terms of
        // paths relative to this directory.
        directory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory));

        return (directory, fileName);
    }
}
