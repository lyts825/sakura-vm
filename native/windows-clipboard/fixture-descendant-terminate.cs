using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

// Test-only: hold one exact process HANDLE, verify its creation time and private
// fixture image, then terminate it. Never enumerate or kill by executable name.
internal static class OwnedDescendantTerminate
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low, High; }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder image, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static int Main(string[] args)
    {
        if (args.Length != 3) return 92;
        uint pid = UInt32.Parse(args[0], CultureInfo.InvariantCulture);
        ulong expected = UInt64.Parse(args[1], CultureInfo.InvariantCulture);
        IntPtr process = OpenProcess(0x00100000 | 0x1000 | 1, false, pid);
        if (process == IntPtr.Zero) return 93;
        try
        {
            FileTime created, exited, kernel, user;
            if (!GetProcessTimes(process, out created, out exited, out kernel, out user) ||
                (((ulong)created.High << 32) | created.Low) != expected) return 94;
            StringBuilder image = new StringBuilder(32768);
            uint size = 32768;
            if (!QueryFullProcessImageName(process, 0, image, ref size) ||
                !String.Equals(image.ToString(), args[2], StringComparison.OrdinalIgnoreCase) ||
                WaitForSingleObject(process, 0) != 0x102) return 95;
            if (!TerminateProcess(process, 91) || WaitForSingleObject(process, 10000) != 0) return 96;
            uint code;
            if (!GetExitCodeProcess(process, out code) || code != 91) return 97;
            Console.WriteLine("{\"pid\":" + pid + ",\"created\":\"" + expected + "\",\"exitCode\":91,\"exactHandleVerified\":true}");
            return 0;
        }
        finally { CloseHandle(process); }
    }
}
