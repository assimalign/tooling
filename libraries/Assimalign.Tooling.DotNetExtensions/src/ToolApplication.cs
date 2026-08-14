using System;
using System.Collections.Generic;
using System.CommandLine;
using System.Threading;
using System.Threading.Tasks;
using Assimalign.Tooling.DotNetExtensions.Commands.Solutions;
using Assimalign.Tooling.DotNetExtensions.Framework;

namespace Assimalign.Tooling.DotNetExtensions;

/// <summary>
/// The composition root of the tool. Every command the tool exposes is registered here; adding a
/// new top level command is a single <see cref="Add(ToolCommand)"/> call against a
/// <see cref="ToolCommand"/> implementation.
/// </summary>
public sealed class ToolApplication
{
    private readonly List<ToolCommand> commands = new();

    private ToolApplication() { }

    /// <summary>
    /// The description rendered at the top of the tool's help output.
    /// </summary>
    public const string Description = "Assimalign tooling that extends the .NET CLI.";

    /// <summary>
    /// The commands registered against the application.
    /// </summary>
    public IReadOnlyList<ToolCommand> Commands => commands;

    /// <summary>
    /// Creates an application pre-loaded with every command shipped by the tool.
    /// </summary>
    public static ToolApplication Create()
    {
        return new ToolApplication()
            .Add(new SolutionCommand());
    }

    /// <summary>
    /// Creates an application with no commands registered. Intended for tests and for hosts that
    /// want to expose a subset of the tool.
    /// </summary>
    public static ToolApplication CreateEmpty()
    {
        return new ToolApplication();
    }

    /// <summary>
    /// Registers a top level command.
    /// </summary>
    public ToolApplication Add(ToolCommand command)
    {
        ArgumentNullException.ThrowIfNull(command);

        commands.Add(command);

        return this;
    }

    /// <summary>
    /// Builds the command line surface of the tool.
    /// </summary>
    public RootCommand Build()
    {
        RootCommand root = new(Description);

        root.Options.Add(ToolOptions.Verbose);

        foreach (ToolCommand command in commands)
        {
            root.Subcommands.Add(command.Build());
        }

        return root;
    }

    /// <summary>
    /// Parses and executes the provided arguments, returning the process exit code.
    /// </summary>
    public Task<int> RunAsync(string[] args, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(args);

        return Build().Parse(args).InvokeAsync(new InvocationConfiguration(), cancellationToken);
    }
}
