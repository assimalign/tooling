using Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

namespace Assimalign.Tooling.DotNetExtensions.Tests;

public class NewSolutionOptionsTests
{
    // A rooted directory spelled the way the running OS spells one. It never has to exist;
    // resolution is pure path arithmetic.
    private static readonly string RootedDirectory =
        Path.GetFullPath(Path.Combine(Path.GetTempPath(), "repo", "src"));

    [Fact]
    public void ResolvePath_SplitsASolutionFilePath()
    {
        (string directory, string fileName) = NewSolutionOptions.ResolvePath(
            Path.Combine(RootedDirectory, "Example.slnx"),
            null);

        Assert.Equal(RootedDirectory, directory);
        Assert.Equal("Example.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_TakesTheNameFromTheNameOption()
    {
        (string directory, string fileName) = NewSolutionOptions.ResolvePath(RootedDirectory, "Example");

        Assert.Equal(RootedDirectory, directory);
        Assert.Equal("Example.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_PrefersAnExplicitNameOverTheOneInThePath()
    {
        (_, string fileName) = NewSolutionOptions.ResolvePath(
            Path.Combine(RootedDirectory, "FromPath.slnx"),
            "FromName");

        Assert.Equal("FromName.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_KeepsAnExtensionAlreadyOnTheName()
    {
        (_, string fileName) = NewSolutionOptions.ResolvePath(RootedDirectory, "Example.slnx");

        Assert.Equal("Example.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_RootsARelativeDirectory()
    {
        (string directory, _) = NewSolutionOptions.ResolvePath(".", "Example");

        Assert.True(Path.IsPathRooted(directory));
        Assert.Equal(Path.TrimEndingDirectorySeparator(Directory.GetCurrentDirectory()), directory);
    }

    [Fact]
    public void ResolvePath_RootsASolutionFileNameWithNoDirectory()
    {
        (string directory, string fileName) = NewSolutionOptions.ResolvePath("Example.slnx", null);

        Assert.Equal(Path.TrimEndingDirectorySeparator(Directory.GetCurrentDirectory()), directory);
        Assert.Equal("Example.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_TrimsATrailingSeparatorFromTheDirectory()
    {
        (string directory, _) = NewSolutionOptions.ResolvePath(
            RootedDirectory + Path.DirectorySeparatorChar,
            "Example");

        Assert.Equal(RootedDirectory, directory);
    }

    [Fact]
    public void ResolvePath_ThrowsWhenNoNameCanBeDetermined()
    {
        Assert.Throws<ArgumentException>(() => NewSolutionOptions.ResolvePath(RootedDirectory, null));
    }

    [Fact]
    public void SolutionFilePath_JoinsTheDirectoryAndFileName()
    {
        NewSolutionOptions options = new()
        {
            SolutionDirectory = RootedDirectory,
            SolutionFileName = "Example.slnx"
        };

        Assert.Equal(Path.Combine(RootedDirectory, "Example.slnx"), options.SolutionFilePath);
    }
}
