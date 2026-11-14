// Copyright (c) 2026 Ferhat Kosger. MIT License.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public static class LedgerJob
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct BASIC_LIMIT
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct EXTENDED_LIMIT
    {
        public BASIC_LIMIT BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    // https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information
    [StructLayout(LayoutKind.Sequential)]
    struct BASIC_ACCOUNTING
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref EXTENDED_LIMIT information, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int informationClass, out BASIC_ACCOUNTING information, uint size, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, uint count, uint flags, ref UIntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returnSize);
    [DllImport("kernel32.dll")]
    static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION information);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetHandleInformation(IntPtr handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Close(ref IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
        handle = IntPtr.Zero;
    }

    // Microsoft CRT argv rules: double backslashes before a quote or closing quote.
    // https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments
    public static string QuoteArgument(string value)
    {
        StringBuilder quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') quoted.Append('\\', slashes * 2 + 1);
            else quoted.Append('\\', slashes);
            slashes = 0;
            quoted.Append(c);
        }
        quoted.Append('\\', slashes * 2);
        return quoted.Append('"').ToString();
    }

    static void State(string path, string json)
    {
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, json, new UTF8Encoding(false));
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    if (File.Exists(path)) File.Replace(temporary, path, null);
                    else File.Move(temporary, path);
                    return;
                }
                catch (IOException) { if (attempt == 9) throw; Thread.Sleep(10); }
            }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    static bool Active(IntPtr job, out uint count)
    {
        BASIC_ACCOUNTING accounting;
        bool ok = QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(BASIC_ACCOUNTING)), IntPtr.Zero);
        count = accounting.ActiveProcesses;
        return ok;
    }

    // CloseHandle alone starts asynchronous termination. Confirm the job's count first.
    // https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject
    // https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject
    static string Cleanup(IntPtr job, out string error)
    {
        error = null;
        uint count;
        if (Active(job, out count) && count == 0) return "confirmed";
        if (!TerminateJobObject(job, 1)) { error = "JOB_TERMINATE_ERROR"; return "failed"; }
        Stopwatch wait = Stopwatch.StartNew();
        do
        {
            if (!Active(job, out count)) { error = "JOB_QUERY_ERROR"; return "unconfirmed"; }
            if (count == 0) return "confirmed";
            Thread.Sleep(10);
        } while (wait.ElapsedMilliseconds < 2000);
        error = "JOB_CLEANUP_TIMEOUT";
        return "unconfirmed";
    }

    static string JsonString(string value) { return value == null ? "null" : "\"" + value + "\""; }

    public static void Run(string program, string[] args, string cwd, string statePath, string stopPath, int parentPid, int timeoutMs)
    {
        IntPtr job = IntPtr.Zero, list = IntPtr.Zero, jobs = IntPtr.Zero, handles = IntPtr.Zero;
        IntPtr parent = IntPtr.Zero, input = IntPtr.Zero;
        IntPtr[] std = new IntPtr[3];
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        bool initialized = false, created = false, started = false;
        string status = "launch-error", error = "JOB_SETUP_ERROR", cleanup = "not-started", cleanupError = null;
        uint? exitCode = null;
        try
        {
            if (String.IsNullOrEmpty(program) || !Path.IsPathRooted(program) || String.IsNullOrEmpty(cwd) || !Path.IsPathRooted(cwd) || args == null || parentPid < 1 || timeoutMs < 1)
                throw new ArgumentException();
            parent = OpenProcess(0x00100000, false, (uint)parentPid); // SYNCHRONIZE
            Check(parent != IntPtr.Zero);
            if (WaitForSingleObject(parent, 0) != 0x102) throw new ArgumentException();
            job = CreateJobObjectW(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            uint flags;
            Check(GetHandleInformation(job, out flags));
            if ((flags & 1) != 0) throw new ArgumentException();
            EXTENDED_LIMIT limits = new EXTENDED_LIMIT();
            limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));

            // JOB_LIST assigns membership during process creation, before code can run.
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
            // https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812
            UIntPtr size = UIntPtr.Zero;
            bool sizing = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            int sizingError = Marshal.GetLastWin32Error();
            if (sizing || sizingError != 122 || size == UIntPtr.Zero) throw new ArgumentException();
            list = Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
            Check(InitializeProcThreadAttributeList(list, 2, 0, ref size));
            initialized = true;
            jobs = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobs, job);
            Check(UpdateProcThreadAttribute(list, 0, new UIntPtr(0x2000D), jobs, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            handles = Marshal.AllocHGlobal(3 * IntPtr.Size);
            // JSON is consumed from helper stdin. The user program receives a separate NUL.
            input = CreateFileW("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
            Check(input != new IntPtr(-1));
            IntPtr[] sources = { input, GetStdHandle(-11), GetStdHandle(-12) };
            for (int i = 0; i < 3; i++)
            {
                Check(DuplicateHandle(GetCurrentProcess(), sources[i], GetCurrentProcess(), out std[i], 0, true, 2));
                Marshal.WriteIntPtr(handles, i * IntPtr.Size, std[i]);
            }
            Check(UpdateProcThreadAttribute(list, 0, new UIntPtr(0x20002), handles, new UIntPtr((uint)(3 * IntPtr.Size)), IntPtr.Zero, IntPtr.Zero));
            STARTUPINFOEX startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.StartupInfo.dwFlags = 0x100;
            startup.StartupInfo.hStdInput = std[0];
            startup.StartupInfo.hStdOutput = std[1];
            startup.StartupInfo.hStdError = std[2];
            startup.lpAttributeList = list;
            StringBuilder command = new StringBuilder(QuoteArgument(program));
            foreach (string arg in args) command.Append(' ').Append(QuoteArgument(arg));
            if (command.Length >= 32767) { error = "E2BIG"; throw new ArgumentException(); }
            if (WaitForSingleObject(parent, 0) != 0x102 || File.Exists(stopPath))
            {
                status = File.Exists(stopPath) && File.ReadAllText(stopPath).Trim() == "output-limit" ? "output-limit" : "interrupted";
                error = null;
                return;
            }
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
            if (!CreateProcessW(program, command, IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 4 | 0x08000000, IntPtr.Zero, cwd, ref startup, out pi))
            {
                int nativeError = Marshal.GetLastWin32Error();
                error = nativeError == 2 || nativeError == 3 ? "ENOENT" : nativeError == 5 ? "EACCES" : "NATIVE_LAUNCH_ERROR";
                throw new Win32Exception(nativeError);
            }
            created = true;
            bool member;
            Check(IsProcessInJob(pi.hProcess, job, out member));
            if (!member) throw new ArgumentException();
            for (int i = 0; i < 3; i++) Close(ref std[i]);
            Close(ref input);
            DeleteProcThreadAttributeList(list); initialized = false;
            Marshal.FreeHGlobal(list); list = IntPtr.Zero;
            Marshal.FreeHGlobal(jobs); jobs = IntPtr.Zero;
            Marshal.FreeHGlobal(handles); handles = IntPtr.Zero;
            if (ResumeThread(pi.hThread) == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
            started = true;
            status = "completed"; error = null;
            Stopwatch elapsed = Stopwatch.StartNew();
            State(statePath, "{\"phase\":\"started\",\"rootPid\":" + pi.dwProcessId + "}");
            while (true)
            {
                uint rootWait = WaitForSingleObject(pi.hProcess, 0);
                if (rootWait == 0)
                {
                    State(statePath, "{\"phase\":\"root-exited\",\"rootPid\":" + pi.dwProcessId + "}");
                    break;
                }
                if (rootWait != 0x102) { status = "control-error"; error = "ROOT_WAIT_ERROR"; break; }
                uint parentWait = WaitForSingleObject(parent, 0);
                if (parentWait != 0x102) { status = "interrupted"; break; }
                if (File.Exists(stopPath))
                {
                    string reason = File.ReadAllText(stopPath).Trim();
                    status = reason == "output-limit" ? "output-limit" : "interrupted";
                    break;
                }
                if (elapsed.ElapsedMilliseconds >= timeoutMs) { status = "timed-out"; break; }
                Thread.Sleep(10);
            }
        }
        catch
        {
            if (started) { status = "control-error"; error = "JOB_CONTROL_ERROR"; }
        }
        finally
        {
            if (created)
            {
                try { cleanup = Cleanup(job, out cleanupError); }
                catch { cleanup = "unconfirmed"; cleanupError = "JOB_CLEANUP_ERROR"; }
                // A signaled process handle disambiguates a legitimate exit code of 259.
                if (WaitForSingleObject(pi.hProcess, 2000) == 0)
                {
                    uint code;
                    if (GetExitCodeProcess(pi.hProcess, out code)) exitCode = code;
                }
                if (status == "completed" && !exitCode.HasValue) { status = "control-error"; error = "ROOT_EXIT_ERROR"; }
                if (status == "launch-error") exitCode = null;
            }
            Close(ref job); // Last-handle close remains the fallback if confirmation failed.
            Close(ref pi.hThread); Close(ref pi.hProcess);
            foreach (IntPtr handle in std) if (handle != IntPtr.Zero) CloseHandle(handle);
            Close(ref input); Close(ref parent);
            if (initialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs);
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            string final = "{\"phase\":\"completed\",\"started\":" + (started ? "true" : "false") +
                ",\"rootPid\":" + (created ? pi.dwProcessId.ToString() : "null") + ",\"status\":" + JsonString(status) +
                ",\"exitCode\":" + (exitCode.HasValue ? exitCode.Value.ToString() : "null") + ",\"errorCode\":" + JsonString(error) +
                ",\"cleanup\":" + JsonString(cleanup) + ",\"cleanupError\":" + JsonString(cleanupError) + "}";
            try { State(statePath, final); } catch { /* Controller treats missing final state as unconfirmed. */ }
        }
    }
}
