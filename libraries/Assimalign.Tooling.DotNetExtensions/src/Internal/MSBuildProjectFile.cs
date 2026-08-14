using System;
using System.Collections.Generic;
using System.IO;
using System.Xml.Linq;

namespace Assimalign.Tooling.DotNetExtensions.Internal;

/// <summary>
/// Minimal reader over an MSBuild project file. Elements are matched on local name so that both
/// SDK style projects and legacy projects carrying the MSBuild XML namespace are handled.
/// </summary>
internal static class MSBuildProjectFile
{
    /// <summary>
    /// Reads the 'Include' value of every item matching one of the supplied element names.
    /// </summary>
    public static IReadOnlyList<string> GetIncludes(string projectPath, IReadOnlyCollection<string> elementNames)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(projectPath);
        ArgumentNullException.ThrowIfNull(elementNames);

        List<string> includes = new();

        if (elementNames.Count == 0)
        {
            return includes;
        }

        using FileStream stream = File.Open(projectPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);

        XDocument document = XDocument.Load(stream);

        foreach (XElement element in document.Descendants())
        {
            if (!Contains(elementNames, element.Name.LocalName))
            {
                continue;
            }

            string? include = element.Attribute("Include")?.Value;

            // Ignore malformed item entries that carry no Include.
            if (string.IsNullOrWhiteSpace(include))
            {
                continue;
            }

            includes.Add(include.Trim());
        }

        return includes;
    }

    private static bool Contains(IReadOnlyCollection<string> elementNames, string localName)
    {
        foreach (string elementName in elementNames)
        {
            if (string.Equals(elementName, localName, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
