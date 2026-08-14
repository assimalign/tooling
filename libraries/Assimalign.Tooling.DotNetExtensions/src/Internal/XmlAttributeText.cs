namespace Assimalign.Tooling.DotNetExtensions.Internal;

internal static class XmlAttributeText
{
    /// <summary>
    /// Escapes the characters that cannot appear inside a double quoted XML attribute value. Paths
    /// containing '&amp;' are rare but they would otherwise produce a solution file no XML reader
    /// can load.
    /// </summary>
    public static string Escape(string value)
    {
        if (value.IndexOfAny(['&', '<', '>', '"']) < 0)
        {
            return value;
        }

        return value
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;");
    }
}
