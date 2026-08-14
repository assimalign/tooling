using System.CommandLine;
using Assimalign.Tooling.DotNetExtensions.Framework;

namespace Assimalign.Tooling.DotNetExtensions.Tests;

public class ToolCommandTests
{
    [Fact]
    public void Execute_ReturnsTheExitCodeOfTheCommand()
    {
        StubCommand command = new(_ => 7);

        Assert.Equal(7, Invoke(command.Build(), "stub", out _, out _));
    }

    [Fact]
    public void Execute_ReceivesTheParsedArguments()
    {
        string? received = null;
        StubCommand command = new(context =>
        {
            received = context.GetValue(StubCommand.ValueOption);

            return ToolExitCode.Success;
        });

        Invoke(command.Build(), "stub --value hello", out _, out _);

        Assert.Equal("hello", received);
    }

    [Fact]
    public void Execute_ReportsAThrownExceptionAsAnError()
    {
        StubCommand command = new(_ => throw new InvalidOperationException("something broke"));

        int exitCode = Invoke(command.Build(), "stub", out _, out string error);

        Assert.Equal(ToolExitCode.Error, exitCode);
        Assert.Contains("error: something broke", error);
    }

    [Fact]
    public void Execute_WritesToTheStreamsOfTheInvocation()
    {
        StubCommand command = new(context =>
        {
            context.Console.WriteLine("out");
            context.Console.WriteWarning("careful");

            return ToolExitCode.Success;
        });

        Invoke(command.Build(), "stub", out string output, out string error);

        Assert.Contains("out", output);
        Assert.Contains("warning: careful", error);
    }

    [Fact]
    public void Execute_SuppressesDiagnosticOutputByDefault()
    {
        StubCommand command = new(context =>
        {
            context.Console.WriteVerbose("noisy");

            return ToolExitCode.Success;
        });

        // The verbose option only exists on a tree built by ToolApplication; a bare command tree
        // must still run rather than fail looking it up.
        Invoke(command.Build(), "stub", out string output, out _);

        Assert.DoesNotContain("noisy", output);
    }

    [Fact]
    public void Execute_WritesDiagnosticOutputWhenVerboseIsRequested()
    {
        StubCommand command = new(context =>
        {
            context.Console.WriteVerbose("noisy");

            return ToolExitCode.Success;
        });

        RootCommand root = ToolApplication.CreateEmpty().Add(command).Build();

        Invoke(root, "stub --verbose", out string output, out _);

        Assert.Contains("verbose: noisy", output);
    }

    [Fact]
    public void Build_NestsSubcommandsUnderAGroup()
    {
        RootCommand root = ToolApplication.CreateEmpty().Add(new StubGroup()).Build();

        Assert.Equal(ToolExitCode.Success, Invoke(root, "group stub", out _, out _));
    }

    [Fact]
    public void Build_RendersHelpForAGroupInvokedWithoutASubcommand()
    {
        RootCommand root = ToolApplication.CreateEmpty().Add(new StubGroup()).Build();

        Assert.NotEqual(ToolExitCode.Success, Invoke(root, "group", out _, out _));
    }

    [Fact]
    public void Build_ExposesAliases()
    {
        RootCommand root = ToolApplication.CreateEmpty().Add(new StubGroup()).Build();

        Assert.Equal(ToolExitCode.Success, Invoke(root, "grp stub", out _, out _));
    }

    private static int Invoke(Command command, string commandLine, out string output, out string error)
    {
        StringWriter outputWriter = new();
        StringWriter errorWriter = new();

        int exitCode = command.Parse(commandLine).Invoke(new InvocationConfiguration
        {
            Output = outputWriter,
            Error = errorWriter,
            EnableDefaultExceptionHandler = true
        });

        output = outputWriter.ToString();
        error = errorWriter.ToString();

        return exitCode;
    }

    private sealed class StubCommand : ToolCommand
    {
        public static readonly Option<string> ValueOption = new("--value");

        private readonly Func<ToolCommandContext, int> execute;

        public StubCommand(Func<ToolCommandContext, int> execute)
            : base("stub", "A command used by the framework tests.")
        {
            this.execute = execute;
        }

        protected override void Configure(Command command)
        {
            command.Options.Add(ValueOption);
        }

        protected override Task<int> ExecuteAsync(ToolCommandContext context)
        {
            return Task.FromResult(execute(context));
        }
    }

    private sealed class StubGroup : ToolCommandGroup
    {
        public StubGroup()
            : base("group", "A group used by the framework tests.")
        {
            AddAlias("grp");

            AddCommand(new StubCommand(_ => ToolExitCode.Success));
        }
    }
}
