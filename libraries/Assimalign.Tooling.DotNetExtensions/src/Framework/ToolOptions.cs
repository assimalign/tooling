using System.CommandLine;

namespace Assimalign.Tooling.DotNetExtensions.Framework;

/// <summary>
/// Options that apply to every command in the tool.
/// </summary>
public static class ToolOptions
{
    /// <summary>
    /// Enables the diagnostic output a command writes through
    /// <see cref="IToolConsole.WriteVerbose(string)"/>. This is the equivalent of the '-Verbose'
    /// common parameter on the PowerShell cmdlets the tool replaces.
    /// </summary>
    public static readonly Option<bool> Verbose = new("--verbose")
    {
        Description = "Writes diagnostic output while the command runs.",
        Recursive = true
    };
}
