using System.Text;
using Assimalign.Tooling.DotNetExtensions.Commands.Solutions;
using Assimalign.Tooling.DotNetExtensions.Framework;

namespace Assimalign.Tooling.DotNetExtensions.Tests;

public class SolutionGeneratorTests
{
    [Fact]
    public void Generate_WritesTheConfigurationsHeader()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");

        string content = Generate(workspace, "src");

        Assert.StartsWith(
            """
            <Solution>
            	<Configurations>
            		<Platform Name="Any CPU" />
            		<Platform Name="x64" />
            		<Platform Name="x86" />
            	</Configurations>
            """.ReplaceLineEndings(),
            content.ReplaceLineEndings());

        Assert.EndsWith("</Solution>" + Environment.NewLine, content);
    }

    [Fact]
    public void Generate_NamesTheRootFolderAfterTheDirectory()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");

        Assert.Contains("<Folder Name=\"/src/\">", Generate(workspace, "src"));
    }

    [Fact]
    public void Generate_UsesTheSuppliedRootFolder()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");

        string content = Generate(workspace, "src", options => options with { SolutionRootFolder = "Libraries" });

        Assert.Contains("<Folder Name=\"/Libraries/\">", content);
    }

    [Fact]
    public void Generate_WritesLooseFilesAsFileEntries()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\Directory.Build.props");
        workspace.AddFile(@"src\docs\OVERVIEW.md");

        string content = Generate(workspace, "src");

        Assert.Contains("<File Path=\"Directory.Build.props\" />", content);
        Assert.Contains("<Folder Name=\"/src/docs/\">", content);
        Assert.Contains("<File Path=\"docs/OVERVIEW.md\" />", content);
    }

    [Fact]
    public void Generate_WritesAProjectDirectoryAsAProjectEntryAndStopsDescending()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"src\App\App.csproj");
        workspace.AddFile(@"src\App\Program.cs");
        workspace.AddFile(@"src\App\nested\Deep.cs");

        string content = Generate(workspace, "src");

        Assert.Contains("<Project Path=\"App/App.csproj\" />", content);
        Assert.DoesNotContain("Program.cs", content);
        Assert.DoesNotContain("nested", content);
    }

    [Fact]
    public void Generate_WritesAnEmptyDirectoryAsASelfClosedFolder()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");
        workspace.AddDirectory(@"src\assets\images");

        string content = Generate(workspace, "src");

        Assert.Contains("<Folder Name=\"/src/assets/\" />", content);
        Assert.DoesNotContain("/src/assets/images/", content);
    }

    [Fact]
    public void Generate_ExcludesSolutionFilesFromFileEntries()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");
        workspace.AddFile(@"src\Other.slnx");
        workspace.AddFile(@"src\Legacy.sln");

        string content = Generate(workspace, "src");

        Assert.Contains("README.md", content);
        Assert.DoesNotContain("Other.slnx", content);
        Assert.DoesNotContain("Legacy.sln", content);
    }

    [Fact]
    public void Generate_ExcludesPathsMatchingAnIgnorePattern()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");
        workspace.AddFile(@"src\scratch.tmp");
        workspace.AddFile(@"src\samples\Sample.md");

        string content = Generate(workspace, "src", options => options with { IgnorePaths = ["*.tmp", "samples"] });

        Assert.Contains("README.md", content);
        Assert.DoesNotContain("scratch.tmp", content);
        Assert.DoesNotContain("samples", content);
    }

    [Fact]
    public void Generate_NestsGroupedDirectoriesUnderTheGroupFolder()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"src\Sql.Client\Sql.Client.csproj");
        workspace.AddProject(@"src\Core.Runtime\Core.Runtime.csproj");

        string content = Generate(workspace, "src", options => options with
        {
            Groups = [new SolutionFolderGroup("Models/Sql", ["Sql.Client"])]
        });

        Assert.Contains("<Folder Name=\"/src/Models/Sql/Sql.Client/\">", content);
        Assert.Contains("<Folder Name=\"/src/Core.Runtime/\">", content);
    }

    [Fact]
    public void Generate_ResolvesReferencesFromOutsideTheSolutionDirectory()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"repo\src\App\App.csproj", "Lib");
        workspace.AddProject(@"repo\libs\Lib\Lib.csproj");

        string content = Generate(workspace, @"repo\src", options => options with { IncludeReferences = true });

        Assert.Contains("<Folder Name=\"/src/refs/\" >", content);
        Assert.Contains("<Project Path=\"../libs/Lib/Lib.csproj\" />", content);
    }

    [Fact]
    public void Generate_ResolvesReferencesTransitively()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"repo\src\App\App.csproj", "Lib");
        workspace.AddProject(@"repo\libs\Lib\Lib.csproj", "Deep");
        workspace.AddProject(@"repo\libs\Deep\Deep.csproj", "Lib");

        string content = Generate(workspace, @"repo\src", options => options with { IncludeReferences = true });

        Assert.Contains("<Project Path=\"../libs/Lib/Lib.csproj\" />", content);
        Assert.Contains("<Project Path=\"../libs/Deep/Deep.csproj\" />", content);
    }

    [Fact]
    public void Generate_UsesTheSuppliedReferenceFolderName()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"repo\src\App\App.csproj", "Lib");
        workspace.AddProject(@"repo\libs\Lib\Lib.csproj");

        string content = Generate(workspace, @"repo\src", options => options with
        {
            IncludeReferences = true,
            ReferenceFolderName = "dependencies"
        });

        Assert.Contains("<Folder Name=\"/src/dependencies/\" >", content);
    }

    [Fact]
    public void Generate_ExcludesReferenceCandidatesInBuildOutputDirectories()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"repo\src\App\App.csproj", "Lib");
        workspace.AddProject(@"repo\libs\obj\Lib\Lib.csproj");

        string content = Generate(workspace, @"repo\src", options => options with { IncludeReferences = true });

        Assert.DoesNotContain("refs", content);
    }

    [Fact]
    public void Generate_SkipsReferencesWhenNotRequested()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"repo\src\App\App.csproj", "Lib");
        workspace.AddProject(@"repo\libs\Lib\Lib.csproj");

        Assert.DoesNotContain("refs", Generate(workspace, @"repo\src"));
    }

    [Fact]
    public void Generate_ReadsReferencesFromTheSuppliedElementName()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(
            @"repo\src\App\App.csproj",
            """
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <ToolingProjectReference Include="Lib" />
              </ItemGroup>
            </Project>
            """);

        workspace.AddProject(@"repo\libs\Lib\Lib.csproj");

        string content = Generate(workspace, @"repo\src", options => options with
        {
            IncludeReferences = true,
            ReferenceElementNames = ["ToolingProjectReference"]
        });

        Assert.Contains("<Project Path=\"../libs/Lib/Lib.csproj\" />", content);
    }

    [Fact]
    public void Generate_ReportsCounts()
    {
        using TestWorkspace workspace = new();

        workspace.AddProject(@"repo\src\App\App.csproj", "Lib", "Missing");
        workspace.AddProject(@"repo\src\Api\Api.csproj");
        workspace.AddProject(@"repo\libs\Lib\Lib.csproj");

        NewSolutionResult result = new SolutionGenerator(
            CreateOptions(workspace, @"repo\src") with { IncludeReferences = true },
            ToolConsole.Null).Generate();

        Assert.Equal(2, result.ProjectCount);
        Assert.Equal(1, result.ReferenceCount);
        Assert.Equal(new[] { "Missing" }, result.UnresolvedReferences.ToArray());
    }

    [Fact]
    public void Generate_ThrowsWhenTheSolutionAlreadyExists()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");
        workspace.AddFile(@"src\Example.slnx", "existing");

        Assert.Throws<IOException>(() => Generate(workspace, "src"));
    }

    [Fact]
    public void Generate_OverwritesAnExistingSolutionWhenForced()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");
        workspace.AddFile(@"src\Example.slnx", "existing");

        Assert.Contains("<Solution>", Generate(workspace, "src", options => options with { Force = true }));
    }

    [Fact]
    public void Generate_ThrowsWhenTheDirectoryDoesNotExist()
    {
        using TestWorkspace workspace = new();

        Assert.Throws<DirectoryNotFoundException>(() => Generate(workspace, "missing"));
    }

    [Fact]
    public void Generate_WritesUtf8WithoutAByteOrderMark()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\README.md");

        NewSolutionResult result = new SolutionGenerator(CreateOptions(workspace, "src"), ToolConsole.Null).Generate();
        byte[] bytes = File.ReadAllBytes(result.File.FullName);

        Assert.NotEqual(Encoding.UTF8.Preamble.ToArray(), bytes.Take(3).ToArray());
    }

    [Fact]
    public void Generate_EscapesXmlSpecialCharactersInPaths()
    {
        using TestWorkspace workspace = new();

        workspace.AddFile(@"src\a & b\README.md");

        string content = Generate(workspace, "src");

        Assert.Contains("<Folder Name=\"/src/a &amp; b/\">", content);
        Assert.Contains("<File Path=\"a &amp; b/README.md\" />", content);
    }

    private static string Generate(
        TestWorkspace workspace,
        string relativeDirectory,
        Func<NewSolutionOptions, NewSolutionOptions>? configure = null)
    {
        NewSolutionOptions options = CreateOptions(workspace, relativeDirectory);

        if (configure is not null)
        {
            options = configure(options);
        }

        return File.ReadAllText(new SolutionGenerator(options, ToolConsole.Null).Generate().File.FullName);
    }

    private static NewSolutionOptions CreateOptions(TestWorkspace workspace, string relativeDirectory)
    {
        return new NewSolutionOptions
        {
            SolutionDirectory = Path.Join(workspace.Root, relativeDirectory),
            SolutionFileName = "Example.slnx"
        };
    }
}
