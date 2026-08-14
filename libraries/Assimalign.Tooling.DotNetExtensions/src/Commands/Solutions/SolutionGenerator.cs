using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml;
using Assimalign.Tooling.DotNetExtensions.Framework;
using Assimalign.Tooling.DotNetExtensions.Internal;

namespace Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

/// <summary>
/// Generates an XML solution file ('.slnx') from a directory tree.
/// </summary>
/// <remarks>
/// A solution folder is emitted for every directory beneath the generation root. A directory that
/// contains a project file contributes that project and is not descended into; every other
/// directory contributes its files. When reference resolution is enabled, projects referenced by
/// name from outside the generation root are located across the repository and collected into a
/// single reference folder.
/// </remarks>
public sealed class SolutionGenerator
{
    // The project extensions that make a directory a project directory rather than a folder of
    // loose files.
    private static readonly string[] projectExtensions = [".csproj"];

    // Build output and version control directories never contribute valid reference candidates.
    private static readonly string[] excludedReferenceSegments =
    [
        "/bin/",
        "/obj/",
        "/.git/",
        "/.vs/",
        "/_out/",
        "/node_modules/"
    ];

    private readonly NewSolutionOptions options;
    private readonly IToolConsole console;
    private readonly GlobPattern[] ignorePatterns;
    private readonly Dictionary<string, string> referenceCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> unresolvedReferences = new(StringComparer.OrdinalIgnoreCase);
    private readonly string solutionPath;

    private Dictionary<string, string>? projectIndex;
    private int projectCount;

    public SolutionGenerator(NewSolutionOptions options, IToolConsole console)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(console);

        this.options = options;
        this.console = console;

        solutionPath = options.SolutionDirectory;
        ignorePatterns = options.IgnorePaths.Select(GlobPattern.Parse).ToArray();
    }

    /// <summary>
    /// Generates the solution file.
    /// </summary>
    public NewSolutionResult Generate()
    {
        string filePath = options.SolutionFilePath;

        if (!Directory.Exists(solutionPath))
        {
            throw new DirectoryNotFoundException($"The directory '{solutionPath}' does not exist.");
        }

        // Unless '--force' is specified an existing solution file is never overwritten.
        if (!options.Force && File.Exists(filePath))
        {
            throw new IOException($"The solution file '{filePath}' already exists. Use '--force' to overwrite it.");
        }

        console.WriteVerbose($"Creating .NET solution file: {filePath}");

        StringBuilder builder = new();

        builder.AppendTabbedLine(0, "<Solution>");
        builder.AppendTabbedLine(1, "<Configurations>");
        builder.AppendTabbedLine(2, "<Platform Name=\"Any CPU\" />");
        builder.AppendTabbedLine(2, "<Platform Name=\"x64\" />");
        builder.AppendTabbedLine(2, "<Platform Name=\"x86\" />");
        builder.AppendTabbedLine(1, "</Configurations>");

        WriteFolders(solutionPath, builder);
        WriteReferenceFolder(builder);

        builder.AppendTabbedLine(0, "</Solution>");

        File.WriteAllText(filePath, builder.ToString(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        console.WriteVerbose($"Created .NET solution file: {filePath}");

        return new NewSolutionResult
        {
            File = new FileInfo(filePath),
            ProjectCount = projectCount,
            ReferenceCount = referenceCache.Count,
            UnresolvedReferences = [.. unresolvedReferences]
        };
    }

    private void WriteFolders(string path, StringBuilder builder)
    {
        string solutionFolderName = GetSolutionFolderName(path);
        string[] entries = Directory.GetFileSystemEntries(path);

        FileInfo[] files = entries
            .Select(entry => new FileInfo(entry))
            .Where(file => file.Exists && !IsSolutionFile(file) && !IsIgnored(file.FullName))
            .ToArray();

        DirectoryInfo[] directories = entries
            .Select(entry => new DirectoryInfo(entry))
            .Where(directory => directory.Exists && !directory.Attributes.HasFlag(FileAttributes.Hidden) && !IsIgnored(directory.FullName))
            .ToArray();

        if (directories.Length == 0 && files.Length == 0)
        {
            return;
        }

        // A directory holding a project file represents that project, not a folder of files.
        bool hasProject = files.Any(IsProjectFile);

        builder.AppendTabbed(1, $"<Folder Name=\"{XmlAttributeText.Escape(solutionFolderName)}\"");

        if (files.Length > 0)
        {
            builder.AppendLine(">");

            if (hasProject)
            {
                FileInfo file = files.First(IsProjectFile);

                builder.AppendTabbedLine(2, $"<Project Path=\"{XmlAttributeText.Escape(GetSolutionRelativePath(file.FullName))}\" />");

                projectCount++;

                if (options.IncludeReferences)
                {
                    ResolveReferences(file.FullName);
                }
            }
            else
            {
                foreach (FileInfo file in files)
                {
                    builder.AppendTabbedLine(2, $"<File Path=\"{XmlAttributeText.Escape(GetSolutionRelativePath(file.FullName))}\" />");
                }
            }

            builder.AppendTabbedLine(1, "</Folder>");
        }
        else
        {
            builder.AppendLine(" />");
        }

        if (!hasProject)
        {
            foreach (DirectoryInfo directory in directories)
            {
                WriteFolders(directory.FullName, builder);
            }
        }
    }

    private void WriteReferenceFolder(StringBuilder builder)
    {
        if (referenceCache.Count == 0)
        {
            return;
        }

        string solutionFolderName = string.Concat(GetSolutionFolderName(solutionPath), options.ReferenceFolderName, "/");

        builder.AppendTabbedLine(1, $"<Folder Name=\"{XmlAttributeText.Escape(solutionFolderName)}\" >");

        foreach (KeyValuePair<string, string> reference in referenceCache)
        {
            builder.AppendTabbedLine(2, $"<Project Path=\"{XmlAttributeText.Escape(reference.Value)}\" />");
        }

        builder.AppendTabbedLine(1, "</Folder>");
    }

    /// <summary>
    /// Maps a directory on disk onto the name of the solution folder representing it.
    /// </summary>
    private string GetSolutionFolderName(string path)
    {
        string solutionFolderRoot;

        // When no root folder is supplied the name of the generation root is used.
        if (!string.IsNullOrEmpty(options.SolutionRootFolder))
        {
            solutionFolderRoot = options.SolutionRootFolder.Trim('/').Trim('\\');
        }
        else
        {
            string? parent = Directory.GetParent(solutionPath)?.FullName;

            solutionFolderRoot = parent is null
                ? solutionPath
                : solutionPath.Replace(parent, string.Empty).Trim('/').Trim('\\');
        }

        string solutionFolderName = Path.Join(solutionFolderRoot, GetRelativeSegment(path)).Replace('\\', '/');

        if (options.Groups.Count > 0 && FindGroup(solutionFolderRoot, solutionFolderName) is { } group)
        {
            string grouped = string.Concat(
                $"/{solutionFolderRoot}/{group.Folder}",
                $"/{solutionFolderName.TrimStart('/')}".Replace($"/{solutionFolderRoot}", string.Empty));

            console.WriteVerbose($"Grouped '/{solutionFolderName.TrimStart('/')}' under '{grouped}'.");

            solutionFolderName = grouped;
        }

        if (!solutionFolderName.StartsWith('/'))
        {
            solutionFolderName = string.Concat("/", solutionFolderName);
        }

        if (!solutionFolderName.EndsWith('/'))
        {
            solutionFolderName = string.Concat(solutionFolderName, "/");
        }

        return solutionFolderName;
    }

    private SolutionFolderGroup? FindGroup(string solutionFolderRoot, string solutionFolderName)
    {
        foreach (SolutionFolderGroup group in options.Groups)
        {
            foreach (string path in group.Paths)
            {
                string value = string.Concat($"{solutionFolderRoot}{path}".Trim('/').Trim('\\'), "/");

                // A prefix longer than the candidate can never match it.
                if (value.Length > solutionFolderName.Length + 1)
                {
                    continue;
                }

                if ($"{solutionFolderName}/".StartsWith(value, StringComparison.OrdinalIgnoreCase))
                {
                    return group;
                }
            }
        }

        return null;
    }

    /// <summary>
    /// Walks the project references of a project, adding every project resolved outside the
    /// generation root to the reference folder.
    /// </summary>
    private void ResolveReferences(string projectPath)
    {
        IReadOnlyList<string> includes;

        try
        {
            includes = MSBuildProjectFile.GetIncludes(projectPath, options.ReferenceElementNames);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or XmlException)
        {
            // A locked, missing, or malformed project file must not abort the whole solution
            // generation - warn and keep resolving the remaining references.
            console.WriteWarning($"Unable to read project references from '{projectPath}': {exception.Message}");

            return;
        }

        Dictionary<string, string> index = GetProjectIndex();

        foreach (string include in includes)
        {
            // Skip references already resolved, or already known to be unresolvable. The negative
            // cache is what stops a missing reference from being searched for repeatedly.
            if (referenceCache.ContainsKey(include) || unresolvedReferences.Contains(include))
            {
                continue;
            }

            if (index.TryGetValue(include, out string? referencePath))
            {
                referenceCache[include] = Path.GetRelativePath(solutionPath, referencePath).Replace('\\', '/');

                console.WriteVerbose($"Resolved project reference '{include}' -> {referenceCache[include]}");

                // Resolve the references of the resolved project. The cache check above doubles as
                // the cycle guard for circular references.
                ResolveReferences(referencePath);
            }
            else
            {
                unresolvedReferences.Add(include);

                console.WriteVerbose($"Project reference '{include}' was not found under the search root or is excluded by '--ignore'; skipping.");
            }
        }
    }

    /// <summary>
    /// Builds, once per run, a lookup of candidate reference projects keyed by project name.
    /// Candidates are every project beneath the search root, excluding projects that already live
    /// inside the generation root, projects in build output or version control directories, and
    /// projects matching an '--ignore' pattern.
    /// </summary>
    private Dictionary<string, string> GetProjectIndex()
    {
        if (projectIndex is not null)
        {
            return projectIndex;
        }

        Dictionary<string, string> index = new(StringComparer.OrdinalIgnoreCase);

        string searchRoot = GetReferenceSearchRoot(solutionPath);

        // Projects inside the generation root are emitted by the folder pass, so they must not be
        // duplicated as external references.
        string solutionPrefix = string.Concat(
            Path.TrimEndingDirectorySeparator(solutionPath),
            Path.DirectorySeparatorChar);

        EnumerationOptions enumeration = new()
        {
            IgnoreInaccessible = true,
            RecurseSubdirectories = true
        };

        foreach (string extension in projectExtensions)
        {
            foreach (string projectFile in Directory.EnumerateFiles(searchRoot, $"*{extension}", enumeration))
            {
                if (projectFile.StartsWith(solutionPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (IsExcludedReferencePath(projectFile))
                {
                    continue;
                }

                // '--ignore' excludes reference candidates the same way it excludes solution
                // entries. Filtering here rather than at resolution time also keeps an ignored
                // project from shadowing a same named candidate in first-match-wins below.
                if (IsIgnored(projectFile))
                {
                    continue;
                }

                string projectName = Path.GetFileNameWithoutExtension(projectFile);

                // First match wins when several projects share a file name.
                if (!index.ContainsKey(projectName))
                {
                    index[projectName] = projectFile;
                }
            }
        }

        console.WriteVerbose($"Indexed {index.Count} candidate reference project(s) under '{searchRoot}'.");

        return projectIndex = index;
    }

    /// <summary>
    /// Resolves the directory the reference search is bounded to. Prefers the repository root (the
    /// nearest ancestor containing a '.git' entry) so the search can never walk the entire drive;
    /// when the solution is not inside a git repository the search is bounded to the generation
    /// root's immediate parent directory.
    /// </summary>
    private static string GetReferenceSearchRoot(string solutionPath)
    {
        DirectoryInfo? parent = Directory.GetParent(solutionPath);

        if (parent is null)
        {
            // The solution lives at a drive root; there is nothing above it to search.
            return solutionPath;
        }

        for (DirectoryInfo? current = parent; current is not null; current = current.Parent)
        {
            string gitPath = Path.Combine(current.FullName, ".git");

            if (Directory.Exists(gitPath) || File.Exists(gitPath))
            {
                return current.FullName;
            }
        }

        return parent.FullName;
    }

    private static bool IsExcludedReferencePath(string path)
    {
        string normalized = path.Replace('\\', '/');

        return excludedReferenceSegments.Any(segment => normalized.Contains(segment, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsProjectFile(FileInfo file)
    {
        return projectExtensions.Contains(file.Extension, StringComparer.OrdinalIgnoreCase);
    }

    private static bool IsSolutionFile(FileInfo file)
    {
        return string.Equals(file.Extension, ".slnx", StringComparison.OrdinalIgnoreCase)
            || string.Equals(file.Extension, ".sln", StringComparison.OrdinalIgnoreCase);
    }

    private bool IsIgnored(string path)
    {
        return ignorePatterns.Any(pattern => pattern.IsMatch(path));
    }

    private string GetRelativeSegment(string path)
    {
        return string.Equals(path, solutionPath, StringComparison.OrdinalIgnoreCase)
            ? string.Empty
            : Path.GetRelativePath(solutionPath, path);
    }

    private string GetSolutionRelativePath(string path)
    {
        return Path.GetRelativePath(solutionPath, path).Replace('\\', '/');
    }
}
