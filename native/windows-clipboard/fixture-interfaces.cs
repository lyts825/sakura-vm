/**
 * 模块职责（中文）：离线 WinForms/WPF 夹具在 CLR 启动前由原生端设置私有 station；核验 station 与 Job 后在 STA 消息线程执行真实控件/API，后台管道以一问一答避免跨线程框架访问。
 * Module responsibilities (English): Offline WinForms/WPF fixtures receive a private station from native launch before CLR; verify station/Job then run real controls/APIs on STA while a request-reply pipe thread avoids cross-thread framework access.
 */
/** 离线 WinForms/WPF 剪贴板夹具，由原生启动器在 CLR 启动前配置私有 window station。 */
// Offline .NET Framework/modern .NET WinForms/WPF ordinary clipboard probe. The native
// owned launcher assigns the private window station before the CLR starts.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
#if !NETCOREAPP
using System.Web.Script.Serialization;
#endif

internal static class ClipboardInterfacesFixture
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ObjectFlags { public int Inherit; public int Reserved; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Message { public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam; public uint Time; public int X; public int Y; public uint Private; }
    /** 中文：取得当前进程已绑定的 station，夹具用它核对启动器已设置私有环境。 English: Obtain the process's current station to verify the launcher's private environment. */
    [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    /** 中文：调用 GetUserObjectInformationW 读取有界用户对象名称并输出所需字节数。 English: Call GetUserObjectInformationW to read a bounded user-object name and required byte count. 参数声明 / Declared parameters: IntPtr handle, int index, StringBuilder value, uint size, out uint required. */
    private static extern bool GetObjectName(IntPtr handle, int index, StringBuilder value, uint size, out uint required);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", SetLastError = true)]
    /** 中文：读取用户对象标志结构以核对 station 不是交互可见对象，输出所需长度。 English: Read user-object flags to verify the station is noninteractive and report required size. 参数声明 / Declared parameters: IntPtr handle, int index, out ObjectFlags value, uint size, out uint required. */
    private static extern bool GetObjectFlags(IntPtr handle, int index, out ObjectFlags value, uint size, out uint required);
    /** 中文：返回当前原生线程 ID，用于 GUI 消息投递和同线程来源证据。 English: Return the native thread ID for GUI message delivery and same-thread provenance evidence. */
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    /** 中文：取得当前进程伪句柄用于身份查询，调用者不关闭该伪句柄。 English: Obtain the current-process pseudo-handle for identity queries without closing it. */
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    /** 中文：查询精确进程是否属于指定 Job 或任意 Job，API 成功与成员输出分别判断。 English: Query exact-process membership in a specified/any Job, judging API success separately from the membership output. 参数声明 / Declared parameters: IntPtr process, IntPtr job, out bool inJob. */
    [DllImport("kernel32.dll")] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool inJob);
    /** 中文：读取精确进程句柄的创建/退出时间和 CPU 时间，输出参数仅在成功时用于身份核验。 English: Read creation/exit/CPU times from an exact process handle, using outputs for identity validation only on success. 参数声明 / Declared parameters: IntPtr process, out FileTime created, out FileTime exit, out FileTime kernel, out FileTime user. */
    [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exit, out FileTime kernel, out FileTime user);
    /** 中文：从当前 GUI 线程取匹配消息，返回正数、零退出或负数错误，维持 STA 消息循环。 English: Get matching GUI-thread messages, returning positive/zero quit/negative error values to drive the STA loop. 参数声明 / Declared parameters: out Message message, IntPtr window, uint from, uint to. */
    [DllImport("user32.dll", EntryPoint = "GetMessageW")] private static extern int GetMessage(out Message message, IntPtr window, uint from, uint to);
    /** 中文：按窗口和消息范围观察或移除队列消息，也用于提前建立当前线程队列。 English: Peek/remove queued messages by window/range, also creating the current thread's queue before use. 参数声明 / Declared parameters: out Message message, IntPtr window, uint from, uint to, uint remove. */
    [DllImport("user32.dll", EntryPoint = "PeekMessageW")] private static extern bool PeekMessage(out Message message, IntPtr window, uint from, uint to, uint remove);
    /** 中文：将键盘消息翻译为字符消息，不替代实际 DispatchMessage 分发。 English: Translate keyboard messages into character messages without replacing DispatchMessage delivery. 参数声明 / Declared parameters: ref Message message. */
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    /** 中文：调用消息目标窗口过程，返回过程结果，供 GUI 线程正常处理控件消息。 English: Call a message target's window procedure and return its result for normal GUI control processing. 参数声明 / Declared parameters: ref Message message. */
    [DllImport("user32.dll", EntryPoint = "DispatchMessageW")] private static extern IntPtr DispatchMessage(ref Message message);
    /** 中文：向指定线程投递命令或退出消息，布尔值表明是否进入队列，线程先建立队列。 English: Post a command/quit message to a specified thread and report enqueue success, requiring an existing thread queue. 参数声明 / Declared parameters: uint thread, uint message, UIntPtr wparam, IntPtr lparam. */
    [DllImport("user32.dll", EntryPoint = "PostThreadMessageW")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wparam, IntPtr lparam);
    /** 中文：读取窗口类名到给定容量缓冲区，返回写入字符数用于控件类型证据。 English: Read a window class name into bounded storage and return character count for control-type evidence. 参数声明 / Declared parameters: IntPtr window, StringBuilder name, int count. */
    [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    /** 中文：判断窗口句柄目前是否仍有效，用于确认旧控件销毁而非复用其状态。 English: Test whether a window handle is currently valid to confirm old-control destruction rather than reuse its state. 参数声明 / Declared parameters: IntPtr window. */
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    /** 中文：查询窗口可见性作为夹具 UI 证据，不改变窗口状态。 English: Query window visibility as fixture UI evidence without changing it. 参数声明 / Declared parameters: IntPtr window. */
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    /** 中文：查询已经加载的模块而不增加引用计数，用于策略存在性和运行时证据。 English: Query an already-loaded module without increasing references for policy-presence/runtime evidence. 参数声明 / Declared parameters: string name. */
    [DllImport("kernel32.dll", EntryPoint = "GetModuleHandleW", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    /** 中文：读取给定加载模块的完整路径至有界缓冲区，返回字符数用于 CLR/策略来源记录。 English: Read a loaded module's full path into bounded storage and return character count for CLR/policy provenance evidence. 参数声明 / Declared parameters: IntPtr module, StringBuilder path, int count. */
    [DllImport("kernel32.dll", EntryPoint = "GetModuleFileNameW", CharSet = CharSet.Unicode)] private static extern int GetModuleFileName(IntPtr module, StringBuilder path, int count);
    private static readonly Queue<string> Commands = new Queue<string>();
    private static readonly AutoResetEvent Replied = new AutoResetEvent(false);
#if !NETCOREAPP
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
#endif
    private static object cached;
    private static string framework;
    private static System.Windows.Forms.TextBox formsTextBox;
    private static System.Windows.Controls.TextBox wpfTextBox;
    private static System.Windows.Window wpfWindow;
    private static string PolicyName { /** 中文：按当前进程指针位数返回 x86 或 x64 策略 DLL 文件名，不加载模块。 English: Return the x86/x64 policy DLL filename from current pointer width without loading the module. */ get { return IntPtr.Size == 4 ? "SakuraClipboardPolicy-x86.dll" : "SakuraClipboardPolicy.dll"; } }
    private static IntPtr UiHandle { /** 中文：取得已创建 WinForms TextBox 或 WPF 窗口的 HWND，尚无 UI 时返回零，不在此访问器中创建窗口。 English: Obtain the existing WinForms TextBox/WPF HWND or zero before UI exists, without creating a window in this accessor. */ get { return formsTextBox != null ? formsTextBox.Handle : wpfWindow == null ? IntPtr.Zero : new System.Windows.Interop.WindowInteropHelper(wpfWindow).Handle; } }
    /** 中文：有界读取当前 UI 窗口类名，无句柄时返回空，用于真实控件证据。 English: Read the current UI class name boundedly or return empty without a handle, providing real-control evidence. */
    private static string UiClass()
    {
        StringBuilder name = new StringBuilder(256); if (UiHandle != IntPtr.Zero) GetClassName(UiHandle, name, 256); return name.ToString();
    }
    /** 中文：把操作结果、当前文本/选区和窗口生命周期、策略 DLL 存在性合并为证据字典，不改变控件。 English: Combine result/current text/selection/window lifetime/policy DLL presence into an evidence dictionary without mutating controls. 参数声明 / Declared parameters: bool ok, uint error, string exception. */
    private static Dictionary<string, object> UiSnapshot(bool ok, uint error, string exception)
    {
        bool forms = formsTextBox != null;
        return new Dictionary<string, object> { { "ok", ok }, { "error", error }, { "exception", exception },
            { "text", forms ? formsTextBox.Text : wpfTextBox == null ? "" : wpfTextBox.Text },
            { "selectionStart", forms ? formsTextBox.SelectionStart : wpfTextBox == null ? 0 : wpfTextBox.SelectionStart },
            { "selectionLength", forms ? formsTextBox.SelectionLength : wpfTextBox == null ? 0 : wpfTextBox.SelectionLength },
            { "selectedText", forms ? formsTextBox.SelectedText : wpfTextBox == null ? "" : wpfTextBox.SelectedText },
            { "uiHandle", UiHandle.ToInt64().ToString() }, { "uiClass", UiClass() }, { "uiAlive", IsWindow(UiHandle) },
            { "uiVisible", IsWindowVisible(UiHandle) }, { "policyPresent", GetModuleHandle(PolicyName) != IntPtr.Zero } };
    }
    /** 中文：按框架模式创建真实 WinForms TextBox 或 WPF 窗口和文本框，确保 HWND 已创建但不加入用户交互桌面。 English: Create real WinForms TextBox or WPF window/text box by framework mode and ensure HWND creation within the private fixture environment. */
    private static void CreateUi()
    {
        if (framework == "winforms-ui")
        {
            formsTextBox = new System.Windows.Forms.TextBox(); formsTextBox.Multiline = true;
            IntPtr unused = formsTextBox.Handle;
        }
        if (framework == "wpf-ui")
        {
            wpfTextBox = new System.Windows.Controls.TextBox();
            wpfWindow = new System.Windows.Window(); wpfWindow.Content = wpfTextBox;
            new System.Windows.Interop.WindowInteropHelper(wpfWindow).EnsureHandle();
            wpfTextBox.Measure(new System.Windows.Size(300, 100)); wpfTextBox.Arrange(new System.Windows.Rect(0, 0, 300, 100));
        }
    }
    /** 中文：解析 start:length:document 并完整校验非负范围后设置当前文本和精确选区，非法输入抛参数异常。 English: Parse start:length:document, validate nonnegative complete ranges then set current text/exact selection, throwing argument errors for invalid input. 参数声明 / Declared parameters: string payload. */
    private static void PrepareSelection(string payload)
    {
        int first = payload.IndexOf(':'), second = payload.IndexOf(':', first + 1);
        if (first < 0 || second < 0) throw new ArgumentException("Owned selection probe requires start:length:document");
        int start = Int32.Parse(payload.Substring(0, first)), length = Int32.Parse(payload.Substring(first + 1, second - first - 1));
        string document = payload.Substring(second + 1);
        if (start < 0 || length < 0 || start > document.Length || length > document.Length - start) throw new ArgumentException("Owned selection range");
        if (formsTextBox != null) { formsTextBox.Text = document; formsTextBox.Select(start, length); }
        else { wpfTextBox.Text = document; wpfTextBox.Select(start, length); }
    }
    /** 中文：按编译目标使用 System.Text.Json 或 Framework serializer，生成相同管道 JSON 文本契约。 English: Use System.Text.Json or Framework serializer by build target to produce the pipe's JSON-text contract. 参数声明 / Declared parameters: object value. */
    private static string Serialize(object value)
    {
#if NETCOREAPP
        return System.Text.Json.JsonSerializer.Serialize(value);
#else
        return Json.Serialize(value);
#endif
    }

    /** 中文：在 STA GUI 线程分派控件复制/剪切/粘贴、重建、缓存及选区命令，捕获框架异常为结果并保留失败后文本证据。 English: Dispatch control copy/cut/paste/recreate/cache/selection on the STA GUI thread, convert framework exceptions to results and retain postfailure text evidence. 参数声明 / Declared parameters: string line. */
    private static object Execute(string line)
    {
        int split = line.IndexOf('\t');
        string command = split < 0 ? line : line.Substring(0, split);
        string text = split < 0 ? "" : line.Substring(split + 1);
        try
        {
            string action = command.StartsWith(framework + "-") ? command.Substring(framework.Length + 1) : command;
            if (framework.EndsWith("-ui") && action == "snapshot") return UiSnapshot(true, 0, "");
            if (framework.EndsWith("-ui") && action == "prepare-selection") { PrepareSelection(text); return UiSnapshot(true, 0, ""); }
            if (framework.EndsWith("-ui") && action == "recreate")
            {
                IntPtr previous = UiHandle;
                if (formsTextBox != null) { formsTextBox.Dispose(); formsTextBox = null; }
                if (wpfWindow != null) { wpfWindow.Close(); wpfWindow = null; wpfTextBox = null; }
                bool destroyed = !IsWindow(previous); CreateUi();
                var state = UiSnapshot(true, 0, ""); state["oldHandle"] = previous.ToInt64().ToString(); state["oldDestroyedBeforeCreate"] = destroyed; return state;
            }
            bool current = action.EndsWith("-current");
            string operation = current ? action.Substring(0, action.Length - 8) : action;
            if (framework.EndsWith("-ui") && (operation == "copy" || operation == "cut" || operation == "paste"))
            {
                if (formsTextBox != null)
                {
                    if (!current) { formsTextBox.Text = operation == "paste" ? "" : text; formsTextBox.SelectAll(); }
                    if (operation == "copy") formsTextBox.Copy(); else if (operation == "cut") formsTextBox.Cut(); else formsTextBox.Paste();
                    return UiSnapshot(true, 0, "");
                }
                if (!current) { wpfTextBox.Text = operation == "paste" ? "" : text; wpfTextBox.SelectAll(); }
                if (operation == "copy") wpfTextBox.Copy(); else if (operation == "cut") wpfTextBox.Cut(); else wpfTextBox.Paste();
                return UiSnapshot(true, 0, "");
            }
            if (action == "copy")
            {
                if (framework == "winforms") System.Windows.Forms.Clipboard.SetText(text, System.Windows.Forms.TextDataFormat.UnicodeText);
                else System.Windows.Clipboard.SetText(text, System.Windows.TextDataFormat.UnicodeText);
                return new { ok = true, error = 0, text = "" };
            }
            if (action == "paste")
            {
                string value = framework == "winforms"
                    ? System.Windows.Forms.Clipboard.GetText(System.Windows.Forms.TextDataFormat.UnicodeText)
                    : System.Windows.Clipboard.GetText(System.Windows.TextDataFormat.UnicodeText);
                return new { ok = true, error = 0, text = value };
            }
            if (action == "cache")
            {
                cached = framework == "winforms" ? (object)System.Windows.Forms.Clipboard.GetDataObject() : System.Windows.Clipboard.GetDataObject();
                return new { ok = cached != null, error = 0, text = "" };
            }
            if (action == "read-cached")
            {
                object value = framework == "winforms"
                    ? ((System.Windows.Forms.IDataObject)cached).GetData(System.Windows.Forms.DataFormats.UnicodeText)
                    : ((System.Windows.IDataObject)cached).GetData(System.Windows.DataFormats.UnicodeText);
                return new { ok = true, error = 0, text = value as string ?? "" };
            }
            return new { ok = false, error = 50, text = "", reason = "Owned probe command unsupported" };
        }
        catch (Exception error)
        {
            if (framework.EndsWith("-ui")) return UiSnapshot(false, unchecked((uint)Marshal.GetHRForException(error)), error.GetType().FullName);
            return new { ok = false, error = unchecked((uint)Marshal.GetHRForException(error)), text = formsTextBox != null ? formsTextBox.Text : wpfTextBox != null ? wpfTextBox.Text : "", exception = error.GetType().FullName };
        }
    }

    [STAThread]
    /** 中文：核对启动器 station、Job 和进程身份后创建 UI，用后台输入队列与回复事件逐条唤醒 STA 消息线程；原生消息继续分发，私有管道关闭后退出。 English: Verify launcher station/Job/process identity, create UI and wake the STA message thread one command at a time via a background queue/reply event; dispatch native messages normally and exit after private-pipe closure. 参数声明 / Declared parameters: string[] args. */
    private static int Main(string[] args)
    {
        if (args.Length != 3 || (args[2] != "winforms" && args[2] != "wpf" && args[2] != "winforms-ui" && args[2] != "wpf-ui")) return 2;
        framework = args[2];
        uint required;
        IntPtr station = GetProcessWindowStation();
        StringBuilder name = new StringBuilder(256);
        ObjectFlags flags;
        if (!GetObjectName(station, 2, name, 512, out required) || !GetObjectFlags(station, 1, out flags, (uint)Marshal.SizeOf(typeof(ObjectFlags)), out required))
        {
            Console.Error.WriteLine("Owned private station lookup failed: " + Marshal.GetLastWin32Error());
            return 3;
        }
        if (!String.Equals(name.ToString(), args[1], StringComparison.Ordinal) || String.Equals(name.ToString(), "WinSta0", StringComparison.OrdinalIgnoreCase) || (flags.Flags & 1) != 0)
        {
            Console.Error.WriteLine("Owned private station mismatch: " + name + " expected " + args[1] + " flags " + flags.Flags);
            return 3;
        }
        FileTime created, exited, kernel, user;
        if (!GetProcessTimes(GetCurrentProcess(), out created, out exited, out kernel, out user)) return 4;
        ulong creation = ((ulong)created.High << 32) | created.Low;
        bool inJob;
        if (!IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inJob) || !inJob) return 4;
        CreateUi();
        const string pipePrefix = @"\\.\pipe\";
        if (!args[0].StartsWith(pipePrefix, StringComparison.Ordinal)) return 5;
        using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", args[0].Substring(pipePrefix.Length), PipeDirection.InOut))
        {
            pipe.Connect(10000);
            StreamReader reader = new StreamReader(pipe, new UTF8Encoding(false));
            StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false));
            writer.AutoFlush = true;
            Message message;
            PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
            uint thread = GetCurrentThreadId();
            var identity = new Dictionary<string, object> { { "pid", Process.GetCurrentProcess().Id }, { "created", creation.ToString() },
                { "station", name.ToString() }, { "privateStation", true }, { "jobBound", true }, { "framework", framework },
                { "uiClass", UiClass() }, { "uiHandle", UiHandle.ToInt64().ToString() }, { "uiVisible", IsWindowVisible(UiHandle) },
                { "policyPresent", GetModuleHandle(PolicyName) != IntPtr.Zero }, { "runtime", Environment.Version.ToString() },
                { "processBits", IntPtr.Size * 8 }, { "apartment", Thread.CurrentThread.GetApartmentState().ToString() },
                { "coreLibPath", typeof(object).Assembly.Location }, { "desktopAssemblyPath", framework.StartsWith("winforms") ? typeof(System.Windows.Forms.Clipboard).Assembly.Location : typeof(System.Windows.Clipboard).Assembly.Location } };
#if NETCOREAPP
            identity["modern"] = true; identity["processArchitecture"] = RuntimeInformation.ProcessArchitecture.ToString();
            identity["frameworkDescription"] = RuntimeInformation.FrameworkDescription;
            StringBuilder corePath = new StringBuilder(32768); GetModuleFileName(GetModuleHandle("coreclr.dll"), corePath, corePath.Capacity); identity["coreClrPath"] = corePath.ToString();
#else
            identity["modern"] = false; identity["processArchitecture"] = IntPtr.Size == 4 ? "X86" : "X64";
            identity["frameworkDescription"] = ".NET Framework CLR " + Environment.Version;
#endif
            writer.WriteLine(Serialize(identity));
            Thread input = new Thread(/** 中文：后台管道线程只排队一条命令、投递 STA 线程消息并等待回复；IO 断开忽略异常但 finally 必须投递退出，框架和控件 API 全由 GUI 消息线程执行。 English: The background pipe thread queues one command/posts an STA-thread message and waits for reply; ignore I/O disconnects but always post quit in finally, keeping framework/control APIs on the GUI message thread. */ delegate()
            {
                try
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        lock (Commands) Commands.Enqueue(line);
                        if (!PostThreadMessage(thread, 0x8000, UIntPtr.Zero, IntPtr.Zero)) break;
                        Replied.WaitOne();
                    }
                }
                catch (IOException) { }
                finally { PostThreadMessage(thread, 0x0012, UIntPtr.Zero, IntPtr.Zero); }
            });
            input.IsBackground = true;
            input.Start();
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
            {
                if (message.Id == 0x8000)
                {
                    string line;
                    lock (Commands) line = Commands.Dequeue();
                    writer.WriteLine(Serialize(Execute(line)));
                    Replied.Set();
                }
                else { TranslateMessage(ref message); DispatchMessage(ref message); }
            }
        }
        return 0;
    }
}
