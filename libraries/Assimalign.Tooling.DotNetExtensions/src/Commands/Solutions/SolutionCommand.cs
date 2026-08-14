using Assimalign.Tooling.DotNetExtensions.Framework;

namespace Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

/// <summary>
/// The 'sln' command group, named to match the .NET CLI's own 'dotnet sln'.
/// </summary>
public sealed class SolutionCommand : ToolCommandGroup
{
    public SolutionCommand()
        : base("sln", "Commands for generating and maintaining .NET solution files.")
    {
        AddAlias("solution");

        AddCommand(new NewSolutionCommand());
    }
}
