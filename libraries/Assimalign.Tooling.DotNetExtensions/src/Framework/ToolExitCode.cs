namespace Assimalign.Tooling.DotNetExtensions.Framework;

/// <summary>
/// The process exit codes returned by the tool.
/// </summary>
public static class ToolExitCode
{
    /// <summary>
    /// The command completed.
    /// </summary>
    public const int Success = 0;

    /// <summary>
    /// The command failed.
    /// </summary>
    public const int Error = 1;

    /// <summary>
    /// The command was interrupted.
    /// </summary>
    public const int Canceled = 130;
}
