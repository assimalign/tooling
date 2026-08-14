using System.CommandLine;
using Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

namespace Assimalign.Tooling.DotNetExtensions.Tests;

public class NewSolutionCommandTests
{
    [Fact]
    public void Parse_AcceptsTheDocumentedInvocation()
    {
        ParseResult result = Parse(@"sln new C:\repo\src --name Example --include-references --force --ignore bin --ignore obj");

        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Parse_ExposesTheCommandUnderItsAlias()
    {
        // 'solution' aliases the 'sln' group; 'create' aliases 'new'.
        Assert.Empty(Parse(@"solution create C:\repo\src -n Example").Errors);
    }

    [Fact]
    public void Parse_RequiresAPath()
    {
        Assert.NotEmpty(Parse("sln new").Errors);
    }

    [Fact]
    public void Parse_AcceptsMultipleIgnorePatternsPerToken()
    {
        ParseResult result = Parse(@"sln new C:\repo\src -n Example --ignore bin obj");

        Assert.Empty(result.Errors);
    }

    [Theory]
    [InlineData("Models/Sql=Sql.Client")]
    [InlineData("Models/Sql=/Sql.Client;/Sql.Storage")]
    [InlineData(@"Models/Sql=\Sql.Client,\Sql.Storage")]
    public void Parse_AcceptsGroupValues(string group)
    {
        Assert.Empty(Parse($@"sln new C:\repo\src -n Example --group {group}").Errors);
    }

    [Theory]
    [InlineData("Models/Sql")]
    [InlineData("=Sql.Client")]
    [InlineData("Models/Sql=")]
    public void Parse_RejectsMalformedGroupValues(string group)
    {
        Assert.NotEmpty(Parse($@"sln new C:\repo\src -n Example --group {group}").Errors);
    }

    [Fact]
    public void Parse_DefaultsTheReferenceFolderAndElement()
    {
        Command command = new SolutionCommand().Build().Subcommands.Single(subcommand => subcommand.Name == "new");
        ParseResult result = command.Parse(@"C:\repo\src -n Example");

        Assert.Equal(NewSolutionOptions.DefaultReferenceFolderName, result.GetValue<string>("--reference-folder"));
        Assert.Equal(
            new[] { NewSolutionOptions.DefaultReferenceElementName },
            result.GetValue<string[]>("--reference-element") ?? []);
    }

    private static ParseResult Parse(string commandLine)
    {
        return ToolApplication.Create().Build().Parse(commandLine);
    }
}
