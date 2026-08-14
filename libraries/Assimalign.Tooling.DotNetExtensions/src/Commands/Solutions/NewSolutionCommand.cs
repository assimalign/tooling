using System;
using System.Collections.Generic;
using System.CommandLine;
using System.CommandLine.Parsing;
using System.Threading.Tasks;
using Assimalign.Tooling.DotNetExtensions.Framework;

namespace Assimalign.Tooling.DotNetExtensions.Commands.Solutions;

/// <summary>
/// 'dotnet extensions sln new' - generates an XML solution file from a directory tree.
/// </summary>
public sealed class NewSolutionCommand : ToolCommand
{
    private const char GroupFolderSeparator = '=';
    private static readonly char[] GroupPathSeparators = [';', ','];

    private readonly Argument<string> pathArgument = new("path")
    {
        Description = "The directory the solution is generated from. May instead name the solution file itself ('./src/Example.slnx'), in which case its directory is used."
    };

    private readonly Option<string?> nameOption = new("--name", "-n")
    {
        Description = "The name of the solution file. The '.slnx' extension is added when omitted."
    };

    private readonly Option<string?> rootFolderOption = new("--root-folder")
    {
        Description = "The root solution folder every generated folder is nested under. Defaults to the name of the generated directory."
    };

    private readonly Option<bool> includeReferencesOption = new("--include-references")
    {
        Description = "Resolves project references pointing outside the generated directory and adds them to the solution."
    };

    private readonly Option<string> referenceFolderOption = new("--reference-folder")
    {
        Description = "The solution folder resolved references are placed in.",
        DefaultValueFactory = _ => NewSolutionOptions.DefaultReferenceFolderName
    };

    private readonly Option<string[]> referenceElementOption = new("--reference-element")
    {
        Description = "The project item element whose 'Include' names a referenced project.",
        DefaultValueFactory = _ => [NewSolutionOptions.DefaultReferenceElementName],
        AllowMultipleArgumentsPerToken = true
    };

    private readonly Option<bool> forceOption = new("--force", "-f")
    {
        Description = "Overwrites the solution file when it already exists."
    };

    private readonly Option<string[]> ignoreOption = new("--ignore")
    {
        Description = "Wildcard patterns excluding files and directories. A pattern without a separator ('bin') matches any file or directory of that name; a pattern with one ('src/**/samples') matches the whole path.",
        AllowMultipleArgumentsPerToken = true
    };

    private readonly Option<SolutionFolderGroup[]> groupOption = new("--group")
    {
        Description = "Nests directories under an additional solution folder, as '<folder>=<path>[;<path>]'. Repeatable.",
        CustomParser = ParseGroups,
        DefaultValueFactory = _ => []
    };

    public NewSolutionCommand()
        : base("new", "Generates an XML based (.slnx) solution file from a directory tree.")
    {
        AddAlias("create");
    }

    protected override void Configure(Command command)
    {
        command.Arguments.Add(pathArgument);
        command.Options.Add(nameOption);
        command.Options.Add(rootFolderOption);
        command.Options.Add(includeReferencesOption);
        command.Options.Add(referenceFolderOption);
        command.Options.Add(referenceElementOption);
        command.Options.Add(forceOption);
        command.Options.Add(ignoreOption);
        command.Options.Add(groupOption);
    }

    protected override Task<int> ExecuteAsync(ToolCommandContext context)
    {
        (string directory, string fileName) = NewSolutionOptions.ResolvePath(
            context.GetRequiredValue(pathArgument),
            context.GetValue(nameOption));

        NewSolutionOptions options = new()
        {
            SolutionDirectory = directory,
            SolutionFileName = fileName,
            SolutionRootFolder = context.GetValue(rootFolderOption),
            IncludeReferences = context.GetValue(includeReferencesOption),
            ReferenceFolderName = context.GetValue(referenceFolderOption) ?? NewSolutionOptions.DefaultReferenceFolderName,
            ReferenceElementNames = context.GetValue(referenceElementOption) ?? [NewSolutionOptions.DefaultReferenceElementName],
            Force = context.GetValue(forceOption),
            IgnorePaths = context.GetValue(ignoreOption) ?? [],
            Groups = context.GetValue(groupOption) ?? []
        };

        NewSolutionResult result = new SolutionGenerator(options, context.Console).Generate();

        // References that resolve to a project already inside the solution are reported as
        // unresolved by design, so the individual misses are diagnostic output rather than
        // warnings. '--verbose' names each one.
        context.Console.WriteVerbose(
            $"Wrote {result.ProjectCount} project(s) and {result.ReferenceCount} reference(s); {result.UnresolvedReferences.Count} reference(s) were not resolved.");

        context.Console.WriteLine(result.File.FullName);

        return Task.FromResult(ToolExitCode.Success);
    }

    /// <summary>
    /// Parses '--group Frameworks=/frameworks;/sdks' into a <see cref="SolutionFolderGroup"/>.
    /// </summary>
    private static SolutionFolderGroup[] ParseGroups(ArgumentResult result)
    {
        List<SolutionFolderGroup> groups = new();

        foreach (Token token in result.Tokens)
        {
            string value = token.Value;
            int separator = value.IndexOf(GroupFolderSeparator);

            if (separator <= 0 || separator == value.Length - 1)
            {
                result.AddError($"'{value}' is not a valid '--group' value. Expected '<folder>{GroupFolderSeparator}<path>[;<path>]'.");

                continue;
            }

            string folder = value[..separator];
            string[] paths = value[(separator + 1)..]
                .Split(GroupPathSeparators, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            try
            {
                groups.Add(new SolutionFolderGroup(folder, paths));
            }
            catch (ArgumentException exception)
            {
                result.AddError($"'{value}' is not a valid '--group' value. {exception.Message}");
            }
        }

        return groups.ToArray();
    }
}
