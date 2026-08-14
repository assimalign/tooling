using Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

namespace Assimalign.Tooling.DotNetExtensions.Tests;

public class NewSolutionOptionsTests
{
    [Fact]
    public void ResolvePath_SplitsASolutionFilePath()
    {
        (string directory, string fileName) = NewSolutionOptions.ResolvePath(@"C:\repo\src\Example.slnx", null);

        Assert.Equal(@"C:\repo\src", directory);
        Assert.Equal("Example.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_TakesTheNameFromTheNameOption()
    {
        (string directory, string fileName) = NewSolutionOptions.ResolvePath(@"C:\repo\src", "Example");

        Assert.Equal(@"C:\repo\src", directory);
        Assert.Equal("Example.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_PrefersAnExplicitNameOverTheOneInThePath()
    {
        (_, string fileName) = NewSolutionOptions.ResolvePath(@"C:\repo\src\FromPath.slnx", "FromName");

        Assert.Equal("FromName.slnx", fileName);
    }

    [Fact]
    public void ResolvePath_KeepsAnExtensionAlreadyOnTheName()
    {
        (_, string fileName) = NewSolutionOptions.ResolvePath(@"C:\repo\src", "Example.slnx");

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
        (string directory, _) = NewSolutionOptions.ResolvePath(@"C:\repo\src\", "Example");

        Assert.Equal(@"C:\repo\src", directory);
    }

    [Fact]
    public void ResolvePath_ThrowsWhenNoNameCanBeDetermined()
    {
        Assert.Throws<ArgumentException>(() => NewSolutionOptions.ResolvePath(@"C:\repo\src", null));
    }

    [Fact]
    public void SolutionFilePath_JoinsTheDirectoryAndFileName()
    {
        NewSolutionOptions options = new()
        {
            SolutionDirectory = @"C:\repo\src",
            SolutionFileName = "Example.slnx"
        };

        Assert.Equal(@"C:\repo\src\Example.slnx", options.SolutionFilePath);
    }
}
