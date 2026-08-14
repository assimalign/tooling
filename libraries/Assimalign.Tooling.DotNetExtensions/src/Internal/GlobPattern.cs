using System;
using System.Text;
using System.Text.RegularExpressions;

namespace Assimalign.Tooling.DotNetExtensions.Internal;

/// <summary>
/// A single wildcard pattern matched against a file system path.
/// </summary>
/// <remarks>
/// <para>Supported syntax:</para>
/// <list type="bullet">
///   <item><description>'*' matches any run of characters within a single path segment.</description></item>
///   <item><description>'**' matches any run of characters across path segments.</description></item>
///   <item><description>'?' matches a single character within a path segment.</description></item>
///   <item><description>'[abc]' and '[a-z]' match a single character from a set; '[!abc]' negates the set.</description></item>
/// </list>
/// <para>
/// A pattern containing a separator is matched against the whole path; a pattern without one is
/// matched against each path segment, so '--ignore bin' excludes every directory named 'bin'
/// while '--ignore **/bin/**' excludes their contents by full path. Matching is case insensitive
/// and both separator characters are treated as equivalent.
/// </para>
/// </remarks>
internal sealed class GlobPattern
{
    private const string RegexMetaCharacters = @".$^{[(|)*+?\";

    private readonly Regex regex;
    private readonly bool matchesSegment;

    private GlobPattern(string pattern, Regex regex, bool matchesSegment)
    {
        Pattern = pattern;
        this.regex = regex;
        this.matchesSegment = matchesSegment;
    }

    /// <summary>
    /// The pattern this instance was parsed from.
    /// </summary>
    public string Pattern { get; }

    /// <summary>
    /// Parses a wildcard pattern.
    /// </summary>
    public static GlobPattern Parse(string pattern)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(pattern);

        string normalized = Normalize(pattern).Trim('/');

        if (normalized.Length == 0)
        {
            throw new ArgumentException($"'{pattern}' is not a valid path pattern.", nameof(pattern));
        }

        Regex regex = new(Translate(normalized), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        return new GlobPattern(pattern, regex, !normalized.Contains('/'));
    }

    /// <summary>
    /// Determines whether a path is matched by the pattern.
    /// </summary>
    public bool IsMatch(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        string normalized = Normalize(value).TrimEnd('/');

        if (!matchesSegment)
        {
            return regex.IsMatch(normalized);
        }

        foreach (string segment in normalized.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (regex.IsMatch(segment))
            {
                return true;
            }
        }

        return false;
    }

    public override string ToString()
    {
        return Pattern;
    }

    private static string Normalize(string value)
    {
        return value.Replace('\\', '/');
    }

    private static string Translate(string pattern)
    {
        StringBuilder builder = new();

        builder.Append('^');

        for (int index = 0; index < pattern.Length; index++)
        {
            char character = pattern[index];

            switch (character)
            {
                case '*':
                    if (index + 1 < pattern.Length && pattern[index + 1] == '*')
                    {
                        index++;

                        // '**/' has to be able to match zero segments so that '**/bin' matches a
                        // 'bin' sitting directly under the search root.
                        if (index + 1 < pattern.Length && pattern[index + 1] == '/')
                        {
                            index++;

                            builder.Append("(?:.*/)?");
                        }
                        else
                        {
                            builder.Append(".*");
                        }
                    }
                    else
                    {
                        builder.Append("[^/]*");
                    }

                    break;

                case '?':
                    builder.Append("[^/]");

                    break;

                case '[':
                    index = AppendCharacterSet(pattern, index, builder);

                    break;

                default:
                    AppendLiteral(builder, character);

                    break;
            }
        }

        builder.Append('$');

        return builder.ToString();
    }

    private static int AppendCharacterSet(string pattern, int index, StringBuilder builder)
    {
        int close = pattern.IndexOf(']', index + 1);

        // An unterminated set is not a set at all; treat the bracket as a literal.
        if (close < 0)
        {
            AppendLiteral(builder, '[');

            return index;
        }

        string content = pattern.Substring(index + 1, close - index - 1);
        bool negated = content.Length > 0 && (content[0] == '!' || content[0] == '^');

        if (negated)
        {
            content = content[1..];
        }

        if (content.Length == 0)
        {
            AppendLiteral(builder, '[');

            return index;
        }

        builder.Append('[');

        if (negated)
        {
            builder.Append('^');
        }

        foreach (char character in content)
        {
            if (character is '\\' or ']' or '^')
            {
                builder.Append('\\');
            }

            builder.Append(character);
        }

        builder.Append(']');

        return close;
    }

    private static void AppendLiteral(StringBuilder builder, char character)
    {
        if (RegexMetaCharacters.Contains(character))
        {
            builder.Append('\\');
        }

        builder.Append(character);
    }
}
