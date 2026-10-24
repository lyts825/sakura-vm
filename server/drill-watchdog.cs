// 模块职责：独立持有原 VM 的 Windows 句柄；控制器冻结时仍执行不可延长的截止停止。
// Module purpose: Holds the original Windows process handle and enforces deadlines without controller IPC.
using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class DrillWatchdog {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
  static long Identity(IntPtr handle) {
    long created, exited, kernel, user;
    if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) throw new IOException("process-times:" + Marshal.GetLastWin32Error());
    return created;
  }
  // 仅按已打开句柄观察和终止，不重新按 PID 取得权限。
  // Observe and terminate only the validated handle; never reacquire by PID.
  public static int Main(string[] args) {
    IntPtr target = IntPtr.Zero, controller = IntPtr.Zero;
    try {
      if (args.Length == 2 && args[0] == "identity") {
        int queryPid = Int32.Parse(args[1]);
        target = OpenProcess(0x00100000 | 0x1000, false, queryPid);
        if (target == IntPtr.Zero || WaitForSingleObject(target,0) == 0) throw new IOException("process-not-live");
        Console.WriteLine("{\"pid\":" + queryPid + ",\"created\":\"" + Identity(target) + "\"}"); return 0;
      }
      if (args.Length != 9) throw new ArgumentException("pid created controllerPid controllerCreated faultDeadline runDeadline nonce receipt mailbox");
      int pid = Int32.Parse(args[0]); long created = Int64.Parse(args[1]);
      int parentPid = Int32.Parse(args[2]); long parentCreated = Int64.Parse(args[3]);
      long fault = Int64.Parse(args[4]), end = Int64.Parse(args[5]);
      string nonce = args[6], receipt = Path.GetFullPath(args[7]), mailbox = Path.GetFullPath(args[8]);
      if (!System.Text.RegularExpressions.Regex.IsMatch(nonce, "^[a-f0-9]{64}$") || pid == parentPid || fault <= Now() || end < fault || end - Now() > 1200000)
        throw new ArgumentException("invalid-fixed-budget");
      target = OpenProcess(0x00100000 | 0x1000 | 1, false, pid);
      controller = OpenProcess(0x00100000 | 0x1000, false, parentPid);
      if (target == IntPtr.Zero || controller == IntPtr.Zero || Identity(target) != created || Identity(controller) != parentCreated)
        throw new IOException("original-identity-mismatch");
      using (FileStream output = new FileStream(receipt, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
        int watchdogPid = Process.GetCurrentProcess().Id;
        long watchdogCreated = Identity(Process.GetCurrentProcess().Handle);
        Action<string,string> emit = (kind, reason) => {
          string json = "{\"kind\":\"" + kind + "\",\"reason\":\"" + reason + "\",\"at\":" + Now() + ",\"pid\":" + pid + ",\"created\":\"" + created + "\",\"watchdogPid\":" + watchdogPid + ",\"watchdogCreated\":\"" + watchdogCreated + "\",\"faultDeadline\":" + fault + ",\"runDeadline\":" + end + "}\n";
          byte[] bytes = System.Text.Encoding.UTF8.GetBytes(json); output.Write(bytes,0,bytes.Length); output.Flush(true);
        };
        emit("ready", "handle-held");
        bool cleared = false; string stopReason = null;
        var clock = Stopwatch.StartNew(); long wall = Now(), faultRemaining = fault-wall, endRemaining = end-wall;
        while (true) {
          if (WaitForSingleObject(target,0) == 0) { emit("stopped", stopReason ?? "original-exited"); return 0; }
          if (WaitForSingleObject(controller,0) == 0) stopReason = "controller-exited";
          string message = "";
          try { if (File.Exists(mailbox)) message = File.ReadAllText(mailbox); } catch(IOException) {}
          if (message == nonce + " contain") stopReason = "contain-requested";
          if (!cleared && message == nonce + " withdrawn" && Now() <= fault && clock.ElapsedMilliseconds <= faultRemaining) { cleared = true; emit("withdrawn", "core-observed-absence"); }
          // 墙钟与单调钟取先到者，休眠或时钟变化不能延长权能。
          // The first wall/monotonic deadline wins; suspend or clock adjustment cannot extend authority.
          if (!cleared && (Now() >= fault || clock.ElapsedMilliseconds >= faultRemaining)) stopReason = "fault-deadline";
          if (Now() >= end || clock.ElapsedMilliseconds >= endRemaining) stopReason = "run-deadline";
          if (stopReason != null) {
            emit("stopping", stopReason);
            if (!TerminateProcess(target, 1460) && WaitForSingleObject(target,0) != 0) { emit("unknown", "terminate-failed"); return 3; }
            if (WaitForSingleObject(target, 3000) != 0) { emit("unknown", "exit-unconfirmed"); return 4; }
            emit("stopped", stopReason); return 0;
          }
          Thread.Sleep(25);
        }
      }
    } catch(Exception e) { Console.Error.WriteLine(e.GetType().Name + ":" + e.Message); return 2; }
    finally { if (target != IntPtr.Zero) CloseHandle(target); if (controller != IntPtr.Zero) CloseHandle(controller); }
  }
}
