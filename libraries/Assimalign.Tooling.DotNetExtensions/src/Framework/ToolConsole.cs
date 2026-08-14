using System;
using System.CommandLine;
using System.IO;

namespace Assimalign.Tooling.DotNetExtensions.Framework;

/// <summary>
/// The default <see cref="IToolConsole"/>, writing to a pair of text writers and colorizing output
/// when the writers are attached to a terminal.
/// </summary>
public sealed class ToolConsole : IToolConsole
{
    private readonly TextWriter output;
    private readonly TextWriter error;
    private readonly bool useColor;

    public ToolConsole(TextWriter output, TextWriter error, bool isVerbose, bool useColor)
    {
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(error);

        this.output = output;
        this.error = error;
        this.useColor = useColor;

        IsVerbose = isVerbose;
    }

    /// <summary>
    /// A console that discards everything written to it.
    /// </summary>
    public static ToolConsole Null { get; } = new(TextWriter.Null, TextWriter.Null, isVerbose: false, useColor: false);

    /// <inheritdoc />
    public bool IsVerbose { get; }

    /// <summary>
    /// Creates a console bound to the streams of the invocation, honoring the global '--verbose'
    /// option. A command tree built without <see cref="ToolOptions.Verbose"/> in it simply reports
    /// no diagnostic output.
    /// </summary>
    public static ToolConsole Create(ParseResult parseResult)
    {
        ArgumentNullException.ThrowIfNull(parseResult);

        InvocationConfiguration? configuration = parseResult.InvocationConfiguration;

        TextWriter output = configuration?.Output ?? Console.Out;
        TextWriter error = configuration?.Error ?? Console.Error;

        bool isVerbose = parseResult.GetResult(ToolOptions.Verbose) is not null
            && parseResult.GetValue(ToolOptions.Verbose);

        return new ToolConsole(output, error, isVerbose, IsColorSupported(output, error));
    }

    /// <inheritdoc />
    public void WriteLine(string message = "")
    {
        output.WriteLine(message);
    }

    /// <inheritdoc />
    public void WriteVerbose(string message)
    {
        if (!IsVerbose)
        {
            return;
        }

        Write(output, ConsoleColor.DarkGray, "verbose: ", message);
    }

    /// <inheritdoc />
    public void WriteWarning(string message)
    {
        Write(error, ConsoleColor.Yellow, "warning: ", message);
    }

    /// <inheritdoc />
    public void WriteError(string message)
    {
        Write(error, ConsoleColor.Red, "error: ", message);
    }

    private void Write(TextWriter writer, ConsoleColor color, string prefix, string message)
    {
        if (!useColor)
        {
            writer.WriteLine(string.Concat(prefix, message));

            return;
        }

        ConsoleColor previous = Console.ForegroundColor;

        Console.ForegroundColor = color;

        try
        {
            writer.WriteLine(string.Concat(prefix, message));
        }
        finally
        {
            Console.ForegroundColor = previous;
        }
    }

    // Colorizing a redirected stream writes escape sequences into whatever consumes it, and the
    // NO_COLOR convention lets a user opt out entirely. Color is driven off the process console,
    // so writers the host has substituted are never colorized.
    private static bool IsColorSupported(TextWriter output, TextWriter error)
    {
        if (!ReferenceEquals(output, Console.Out) || !ReferenceEquals(error, Console.Error))
        {
            return false;
        }

        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("NO_COLOR")))
        {
            return false;
        }

        return !Console.IsOutputRedirected && !Console.IsErrorRedirected;
    }
}
