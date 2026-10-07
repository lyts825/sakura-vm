/**
 * 模块职责（中文）：测试专用托管清理入口只取得一个指定 PID 的句柄，核验创建时间和完整私有映像后终止及等待，不枚举或按名称清理。
 * Module responsibilities (English): The test-only managed cleanup entry opens one specified PID handle, verifies creation time/full private image before termination/waiting and never enumerates or cleans by name.
 */
/** 托管后代清理夹具，使用指定的进程身份和 Windows 句柄接口验证结束及等待流程。 */
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
    /** 中文：按 PID 和请求权限取得精确进程句柄；调用者随后验证创建时间和映像，不能仅凭 PID 终止。 English: Open an exact process handle by PID/requested rights; callers then verify creation time/image rather than terminate by PID alone. 参数声明 / Declared parameters: uint access, bool inherit, uint pid. */
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    /** 中文：读取精确进程句柄的创建/退出时间和 CPU 时间，输出参数仅在成功时用于身份核验。 English: Read creation/exit/CPU times from an exact process handle, using outputs for identity validation only on success. 参数声明 / Declared parameters: IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user. */
    private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    /** 中文：从精确进程句柄取得完整映像路径，按输入缓冲容量更新实际长度，失败不作为身份匹配。 English: Read the full image path from an exact process handle, updating actual length from buffer capacity and never treating failure as an identity match. 参数声明 / Declared parameters: IntPtr process, uint flags, StringBuilder image, ref uint size. */
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder image, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    /** 中文：通过已核验的精确进程句柄请求指定退出码，成功只表示终止已请求，仍需等待退出。 English: Request a chosen exit code through an already-verified exact process handle; success indicates a termination request and still requires waiting for exit. 参数声明 / Declared parameters: IntPtr process, uint code. */
    private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")]
    /** 中文：在给定毫秒上限内等待句柄信号，返回等待状态；调用者区分超时、成功与失败。 English: Wait for a handle signal within the supplied millisecond bound and return wait status, distinguishing success/timeout/failure. 参数声明 / Declared parameters: IntPtr handle, uint milliseconds. */
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    /** 中文：通过精确句柄读取进程退出码，调用者在确认退出后比较目标码。 English: Read a process exit code through its exact handle, comparing expected codes only after confirmed exit. 参数声明 / Declared parameters: IntPtr process, out uint code. */
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")]
    /** 中文：关闭所持有的内核句柄，不用于释放映射地址或伪句柄；布尔值报告结果。 English: Close an owned kernel handle rather than a mapped address/pseudo-handle, returning API success. 参数声明 / Declared parameters: IntPtr handle. */
    private static extern bool CloseHandle(IntPtr handle);

    /** 中文：解析 PID、创建时间和完整映像，取得一个精确句柄并反复核验后终止、等待指定退出码；finally 关闭句柄，不枚举进程。 English: Parse PID/creation time/full image, acquire one exact handle and verify before termination/waiting for the expected exit code; close in finally without process enumeration. 参数声明 / Declared parameters: string[] args. */
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
