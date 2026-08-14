using System.Threading.Tasks;

namespace Assimalign.Tooling.DotNetExtensions;

internal static class Program
{
    private static Task<int> Main(string[] args)
    {
        return ToolApplication.Create().RunAsync(args);
    }
}
