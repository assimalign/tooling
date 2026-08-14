using Assimalign.Tooling.DotNetExtensions.Internal;

namespace Assimalign.Tooling.DotNetExtensions.Tests;

public class GlobPatternTests
{
    [Theory]
    // A pattern without a separator matches any segment of the path.
    [InlineData("bin", @"C:\repo\src\bin", true)]
    [InlineData("bin", @"C:\repo\src\bin\Debug\app.dll", true)]
    [InlineData("bin", @"C:\repo\src\binaries", false)]
    [InlineData("*.tmp", @"C:\repo\src\scratch.tmp", true)]
    [InlineData("*.tmp", @"C:\repo\src\scratch.txt", false)]
    // A pattern with a separator matches the whole path.
    [InlineData("**/bin/**", @"C:\repo\src\bin\Debug", true)]
    [InlineData("**/bin/**", @"C:\repo\src\bin", false)]
    [InlineData(@"**\.claude\worktrees\**", @"C:\repo\.claude\worktrees\one\two", true)]
    [InlineData(@"**\.claude\worktrees\**", @"C:\repo\.claude\other\one", false)]
    [InlineData(@"C:\repo\_out", @"C:\repo\_out", true)]
    [InlineData(@"C:\repo\_out", @"C:\repo\_output", false)]
    [InlineData("src/*/tests", @"C:\repo\src\one\tests", false)]
    [InlineData("**/src/*/tests", @"C:\repo\src\one\tests", true)]
    [InlineData("**/src/*/tests", @"C:\repo\src\one\two\tests", false)]
    // '**/' has to be able to match zero segments.
    [InlineData("**/Directory.Build.props", "Directory.Build.props", true)]
    // Single character and set matching.
    [InlineData("file?.cs", @"C:\repo\file1.cs", true)]
    [InlineData("file?.cs", @"C:\repo\file10.cs", false)]
    [InlineData("file[0-9].cs", @"C:\repo\file7.cs", true)]
    [InlineData("file[0-9].cs", @"C:\repo\filea.cs", false)]
    [InlineData("file[!0-9].cs", @"C:\repo\filea.cs", true)]
    public void IsMatch_MatchesExpectedPaths(string pattern, string path, bool expected)
    {
        Assert.Equal(expected, GlobPattern.Parse(pattern).IsMatch(path));
    }

    [Theory]
    [InlineData(@"**\sdks\Assimalign.Cohesion.Sdk*\**\*.props", @"C:\repo\sdks\Assimalign.Cohesion.Sdk.Core\build\a.props", true)]
    [InlineData(@"**\sdks\Assimalign.Cohesion.Sdk*\**\*.props", @"C:\repo\sdks\Assimalign.Cohesion.Sdk\a.props", true)]
    [InlineData(@"**\sdks\Assimalign.Cohesion.Sdk*\**\*.props", @"C:\repo\sdks\Other\a.props", false)]
    [InlineData(@"**\sdks\Assimalign.Cohesion.Sdk*\**\*.props", @"C:\repo\sdks\Assimalign.Cohesion.Sdk\a.targets", false)]
    public void IsMatch_HandlesRealWorldIgnorePatterns(string pattern, string path, bool expected)
    {
        Assert.Equal(expected, GlobPattern.Parse(pattern).IsMatch(path));
    }

    [Fact]
    public void IsMatch_IsCaseInsensitive()
    {
        Assert.True(GlobPattern.Parse("BIN").IsMatch(@"C:\repo\bin"));
    }

    [Fact]
    public void IsMatch_TreatsBothSeparatorsAsEquivalent()
    {
        Assert.True(GlobPattern.Parse("src/bin").IsMatch(@"src\bin"));
        Assert.True(GlobPattern.Parse(@"src\bin").IsMatch("src/bin"));
    }

    [Fact]
    public void IsMatch_TreatsDotAsALiteral()
    {
        Assert.False(GlobPattern.Parse("a.cs").IsMatch("abcs"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("/")]
    public void Parse_RejectsEmptyPatterns(string pattern)
    {
        Assert.Throws<ArgumentException>(() => GlobPattern.Parse(pattern));
    }

    [Fact]
    public void Parse_TreatsAnUnterminatedSetAsALiteral()
    {
        Assert.True(GlobPattern.Parse("a[bc").IsMatch("a[bc"));
    }
}
