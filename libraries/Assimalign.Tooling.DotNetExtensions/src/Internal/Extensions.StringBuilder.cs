using System.Text;

namespace Assimalign.Tooling.DotNetExtensions.Internal;

internal static class StringBuilderExtensions
{
    public static StringBuilder AppendTabs(this StringBuilder builder, int tabs)
    {
        for (int i = 0; i < tabs; i++)
        {
            builder.Append('\t');
        }

        return builder;
    }

    public static StringBuilder AppendTabbed(this StringBuilder builder, int tabs, string value)
    {
        return builder.AppendTabs(tabs).Append(value);
    }

    public static StringBuilder AppendTabbedLine(this StringBuilder builder, int tabs, string value)
    {
        return builder.AppendTabs(tabs).AppendLine(value);
    }
}
