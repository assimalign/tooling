using System.Threading.Tasks;

namespace Assimalign.Tooling.DotNetExtensions.Framework;

/// <summary>
/// A command that exists only to group related subcommands, such as the 'solution' in
/// 'dotnet assimalign solution new'. Invoking it without a subcommand renders help.
/// </summary>
public abstract class ToolCommandGroup : ToolCommand
{
    protected ToolCommandGroup(string name, string description)
        : base(name, description) { }

    protected sealed override bool IsInvokable => false;

    protected sealed override Task<int> ExecuteAsync(ToolCommandContext context)
    {
        return Task.FromResult(ToolExitCode.Error);
    }
}
