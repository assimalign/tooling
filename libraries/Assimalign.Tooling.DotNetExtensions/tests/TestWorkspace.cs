namespace Assimalign.Tooling.DotNetExtensions.Tests;

/// <summary>
/// A throwaway directory tree that tests generate solutions from.
/// </summary>
internal sealed class TestWorkspace : IDisposable
{
    public TestWorkspace()
    {
        Root = Path.Join(Path.GetTempPath(), "assimalign-cli-tests", Guid.NewGuid().ToString("n"));

        Directory.CreateDirectory(Root);
    }

    /// <summary>
    /// The rooted path of the workspace.
    /// </summary>
    public string Root { get; }

    /// <summary>
    /// Creates a file, and every directory leading to it, from a workspace relative path.
    /// </summary>
    public string AddFile(string relativePath, string content = "")
    {
        string path = Resolve(relativePath);

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        File.WriteAllText(path, content);

        return path;
    }

    /// <summary>
    /// Creates a project file that references the supplied projects by name.
    /// </summary>
    public string AddProject(string relativePath, params string[] references)
    {
        string items = string.Join(
            Environment.NewLine,
            references.Select(reference => $"    <CohesionProjectReference Include=\"{reference}\" />"));

        return AddFile(
            relativePath,
            $"""
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
            {items}
              </ItemGroup>
            </Project>
            """);
    }

    /// <summary>
    /// Creates a directory from a workspace relative path.
    /// </summary>
    public string AddDirectory(string relativePath)
    {
        string path = Resolve(relativePath);

        Directory.CreateDirectory(path);

        return path;
    }

    /// <summary>
    /// Roots a workspace relative path. Tests spell paths with '\', which is a separator on
    /// Windows but an ordinary filename character everywhere else, so it is translated to
    /// whatever the running OS separates directories with.
    /// </summary>
    public string Resolve(string relativePath)
    {
        return Path.Join(Root, relativePath.Replace('\\', Path.DirectorySeparatorChar));
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
            // A leaked temp directory must never fail a test run.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
