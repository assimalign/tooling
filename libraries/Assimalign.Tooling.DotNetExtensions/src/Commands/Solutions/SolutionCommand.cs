using Assimalign.Tooling.DotNetExtensions.Framework;

namespace Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

/// <summary>
/// The 'solution' command group.
/// </summary>
public sealed class SolutionCommand : ToolCommandGroup
{
    public SolutionCommand()
        : base("solution", "Commands for generating and maintaining .NET solution files.")
    {
        AddAlias("sln");

        AddCommand(new NewSolutionCommand());
    }
}
