// Offline .NET Framework WinForms/WPF ordinary clipboard probe. The native
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
    [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetObjectName(IntPtr handle, int index, StringBuilder value, uint size, out uint required);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", SetLastError = true)]
    private static extern bool GetObjectFlags(IntPtr handle, int index, out ObjectFlags value, uint size, out uint required);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool inJob);
    [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("user32.dll", EntryPoint = "GetMessageW")] private static extern int GetMessage(out Message message, IntPtr window, uint from, uint to);
    [DllImport("user32.dll", EntryPoint = "PeekMessageW")] private static extern bool PeekMessage(out Message message, IntPtr window, uint from, uint to, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll", EntryPoint = "DispatchMessageW")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll", EntryPoint = "PostThreadMessageW")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    private static readonly Queue<string> Commands = new Queue<string>();
    private static readonly AutoResetEvent Replied = new AutoResetEvent(false);
#if !NETCOREAPP
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
#endif
    private static object cached;
    private static string framework;
    private static System.Windows.Forms.TextBox formsTextBox;
    private static System.Windows.Controls.TextBox wpfTextBox;
    private static string Serialize(object value)
    {
#if NETCOREAPP
        return System.Text.Json.JsonSerializer.Serialize(value);
#else
        return Json.Serialize(value);
#endif
    }

    private static object Execute(string line)
    {
        int split = line.IndexOf('\t');
        string command = split < 0 ? line : line.Substring(0, split);
        string text = split < 0 ? "" : line.Substring(split + 1);
        try
        {
            string action = command.StartsWith(framework + "-") ? command.Substring(framework.Length + 1) : command;
            if (framework.EndsWith("-ui") && (action == "copy" || action == "cut" || action == "paste"))
            {
                if (formsTextBox != null)
                {
                    formsTextBox.Text = action == "paste" ? "" : text; formsTextBox.SelectAll();
                    if (action == "copy") formsTextBox.Copy(); else if (action == "cut") formsTextBox.Cut(); else formsTextBox.Paste();
                    return new { ok = true, error = 0, text = formsTextBox.Text };
                }
                wpfTextBox.Text = action == "paste" ? "" : text; wpfTextBox.SelectAll();
                if (action == "copy") wpfTextBox.Copy(); else if (action == "cut") wpfTextBox.Cut(); else wpfTextBox.Paste();
                return new { ok = true, error = 0, text = wpfTextBox.Text };
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
            return new { ok = false, error = unchecked((uint)Marshal.GetHRForException(error)), text = formsTextBox != null ? formsTextBox.Text : wpfTextBox != null ? wpfTextBox.Text : "", exception = error.GetType().FullName };
        }
    }

    [STAThread]
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
        string uiClass = "";
        if (framework == "winforms-ui")
        {
            formsTextBox = new System.Windows.Forms.TextBox(); formsTextBox.Multiline = true;
            StringBuilder type = new StringBuilder(256); GetClassName(formsTextBox.Handle, type, 256); uiClass = type.ToString();
        }
        if (framework == "wpf-ui")
        {
            wpfTextBox = new System.Windows.Controls.TextBox();
            var window = new System.Windows.Window(); window.Content = wpfTextBox; window.Show();
            StringBuilder type = new StringBuilder(256); GetClassName(new System.Windows.Interop.WindowInteropHelper(window).Handle, type, 256); uiClass = type.ToString();
        }
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
            writer.WriteLine(Serialize(new { pid = Process.GetCurrentProcess().Id, created = creation.ToString(), station = name.ToString(), privateStation = true, jobBound = true, framework = framework, uiClass = uiClass, runtime = Environment.Version.ToString(), processBits = IntPtr.Size * 8, apartment = Thread.CurrentThread.GetApartmentState().ToString() }));
            Thread input = new Thread(delegate()
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
