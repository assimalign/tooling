namespace Assimalign.Tooling.DotNetExtensions.Framework;

/// <summary>
/// The output surface available to a command. Modeled on the write methods of a PowerShell cmdlet
/// so that migrated cmdlet logic keeps reporting the same way.
/// </summary>
public interface IToolConsole
{
    /// <summary>
    /// Whether diagnostic output is being written.
    /// </summary>
    bool IsVerbose { get; }

    /// <summary>
    /// Writes a line to standard output.
    /// </summary>
    void WriteLine(string message = "");

    /// <summary>
    /// Writes a diagnostic line to standard output when verbose output is enabled.
    /// </summary>
    void WriteVerbose(string message);

    /// <summary>
    /// Writes a warning to standard error. A warning never fails the command.
    /// </summary>
    void WriteWarning(string message);

    /// <summary>
    /// Writes an error to standard error.
    /// </summary>
    void WriteError(string message);
}
