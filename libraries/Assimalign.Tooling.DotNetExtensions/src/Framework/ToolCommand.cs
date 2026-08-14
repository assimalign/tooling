using System;
using System.Collections.Generic;
using System.CommandLine;
using System.Threading;
using System.Threading.Tasks;

namespace Assimalign.Tooling.DotNetExtensions.Framework;

/// <summary>
/// The base type for every command exposed by the tool. A command owns its own options, its own
/// subcommands and its own execution; registering it against a parent is all that is required to
/// surface it on the command line.
/// </summary>
public abstract class ToolCommand
{
    private readonly List<ToolCommand> subcommands = new();
    private readonly List<string> aliases = new();

    protected ToolCommand(string name, string description)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        Name = name;
        Description = description ?? string.Empty;
    }

    /// <summary>
    /// The token used to invoke the command.
    /// </summary>
    public string Name { get; }

    /// <summary>
    /// The description rendered in help output.
    /// </summary>
    public string Description { get; }

    /// <summary>
    /// Alternate tokens that invoke the command.
    /// </summary>
    public IReadOnlyList<string> Aliases => aliases;

    /// <summary>
    /// The commands nested underneath this command.
    /// </summary>
    public IReadOnlyList<ToolCommand> Subcommands => subcommands;

    /// <summary>
    /// Whether the command performs work of its own. Commands that only group subcommands report
    /// <see langword="false"/> so that invoking them bare renders help instead of doing nothing.
    /// </summary>
    protected virtual bool IsInvokable => true;

    /// <summary>
    /// Builds the underlying <see cref="Command"/>, including every registered subcommand.
    /// </summary>
    public Command Build()
    {
        Command command = new(Name, Description);

        foreach (string alias in aliases)
        {
            command.Aliases.Add(alias);
        }

        Configure(command);

        foreach (ToolCommand subcommand in subcommands)
        {
            command.Subcommands.Add(subcommand.Build());
        }

        if (IsInvokable)
        {
            command.SetAction(InvokeAsync);
        }

        return command;
    }

    /// <summary>
    /// Registers an alternate token that invokes the command.
    /// </summary>
    protected void AddAlias(string alias)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(alias);

        aliases.Add(alias);
    }

    /// <summary>
    /// Nests a command underneath this command.
    /// </summary>
    protected TCommand AddCommand<TCommand>(TCommand subcommand)
        where TCommand : ToolCommand
    {
        ArgumentNullException.ThrowIfNull(subcommand);

        subcommands.Add(subcommand);

        return subcommand;
    }

    /// <summary>
    /// Adds the arguments and options the command accepts.
    /// </summary>
    protected virtual void Configure(Command command) { }

    /// <summary>
    /// Executes the command. Exceptions thrown here are reported through the console and turned
    /// into a non-zero exit code, so implementations are free to throw for invalid input.
    /// </summary>
    protected abstract Task<int> ExecuteAsync(ToolCommandContext context);

    private async Task<int> InvokeAsync(ParseResult parseResult, CancellationToken cancellationToken)
    {
        ToolCommandContext context = new(parseResult, ToolConsole.Create(parseResult), cancellationToken);

        try
        {
            return await ExecuteAsync(context).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            context.Console.WriteError($"'{Name}' was canceled.");

            return ToolExitCode.Canceled;
        }
        catch (Exception exception)
        {
            context.Console.WriteError(exception.Message);
            context.Console.WriteVerbose(exception.ToString());

            return ToolExitCode.Error;
        }
    }
}
