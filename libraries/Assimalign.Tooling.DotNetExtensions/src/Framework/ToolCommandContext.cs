using System;
using System.CommandLine;
using System.Threading;

namespace Assimalign.Tooling.DotNetExtensions.Framework;

/// <summary>
/// Everything a command needs while it executes: the parsed command line, the console it writes
/// to, and the token that is signaled when the process is interrupted.
/// </summary>
public sealed class ToolCommandContext
{
    public ToolCommandContext(ParseResult parseResult, IToolConsole console, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(parseResult);
        ArgumentNullException.ThrowIfNull(console);

        ParseResult = parseResult;
        Console = console;
        CancellationToken = cancellationToken;
    }

    /// <summary>
    /// The parsed command line.
    /// </summary>
    public ParseResult ParseResult { get; }

    /// <summary>
    /// The console the command writes to.
    /// </summary>
    public IToolConsole Console { get; }

    /// <summary>
    /// Signaled when the process receives an interrupt.
    /// </summary>
    public CancellationToken CancellationToken { get; }

    /// <summary>
    /// Gets the value bound to an option.
    /// </summary>
    public T? GetValue<T>(Option<T> option)
    {
        return ParseResult.GetValue(option);
    }

    /// <summary>
    /// Gets the value bound to an argument.
    /// </summary>
    public T? GetValue<T>(Argument<T> argument)
    {
        return ParseResult.GetValue(argument);
    }

    /// <summary>
    /// Gets the value bound to a required argument.
    /// </summary>
    public T GetRequiredValue<T>(Argument<T> argument)
    {
        return ParseResult.GetRequiredValue(argument);
    }
}
