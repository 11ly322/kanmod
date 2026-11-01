using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("kanmod uninstaller")]
[assembly: System.Reflection.AssemblyProduct("kanmod")]
[assembly: System.Reflection.AssemblyDescription("kanmod uninstaller")]
[assembly: System.Reflection.AssemblyCompany("kanmod")]
[assembly: System.Reflection.AssemblyVersion("0.0.7.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.0.7.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.0.7")]

internal static class Program
{
    private const string AppVersion = "0.0.7";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\kanmod";

    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = HasArg(args, "/S") || HasArg(args, "--silent");
        string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        foreach (string arg in args)
        {
            if (arg.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase))
                installDir = arg.Substring(5).Trim('"').TrimEnd('\\');
            else if (arg.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase))
                installDir = arg.Substring(6).Trim('"').TrimEnd('\\');
        }

        if (!Directory.Exists(installDir))
        {
            if (!silent) MessageBox.Show("找不到 kanmod 安装目录：\n" + installDir, "卸载 kanmod", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        if (!silent)
        {
            DialogResult answer = MessageBox.Show(
                "将卸载 kanmod " + AppVersion + "。\n\n安装目录和全部数据（模组记录、缓存、备份、回收站）都会被删除，此操作不可撤销。\n\n是否继续？",
                "卸载 kanmod", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return 0;
        }

        try
        {
            StopInstallNodes(installDir);
            StopServer(Path.Combine(installDir, "data"));
            StopLauncher(installDir);
            RemoveRegistry();
            RemoveShortcuts();
            ScheduleDelete(installDir);
            return 0;
        }
        catch (Exception ex)
        {
            if (!silent) MessageBox.Show("卸载失败：\n\n" + ex.Message, "卸载 kanmod", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool HasArg(string[] args, string name)
    {
        foreach (string arg in args)
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static void StopInstallNodes(string installDir)
    {
        try
        {
            string prefix = Path.GetFullPath(installDir).TrimEnd('\\') + "\\";
            foreach (Process process in Process.GetProcessesByName("node"))
            {
                try
                {
                    string path = process.MainModule.FileName;
                    if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
                catch { }
            }
        }
        catch { }
    }

    private static void StopServer(string dataDir)
    {
        string[] files =
        {
            Path.Combine(dataDir, "supervisor.json"),
            Path.Combine(dataDir, "runtime.json")
        };
        foreach (string file in files)
        {
            try
            {
                if (!File.Exists(file)) continue;
                string text = File.ReadAllText(file);
                foreach (string field in new[] { "pid", "childPid" })
                {
                    Match match = Regex.Match(text, "\"" + field + "\"\\s*:\\s*(\\d+)");
                    if (!match.Success) continue;
                    int pid;
                    if (!int.TryParse(match.Groups[1].Value, out pid)) continue;
                    try
                    {
                        Process process = Process.GetProcessById(pid);
                        if (string.Equals(process.ProcessName, "node", StringComparison.OrdinalIgnoreCase))
                        {
                            process.Kill();
                            process.WaitForExit(4000);
                        }
                    }
                    catch { }
                }
                try { File.Delete(file); } catch { }
            }
            catch { }
        }
    }

    private static void StopLauncher(string installDir)
    {
        string prefix = installDir.TrimEnd('\\') + "\\";
        foreach (Process process in Process.GetProcessesByName("kanmod"))
        {
            try
            {
                string path = process.MainModule.FileName;
                if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    process.Kill();
                    process.WaitForExit(3000);
                }
            }
            catch { }
        }
    }

    private static void RemoveRegistry()
    {
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
    }

    private static void RemoveShortcuts()
    {
        try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "kanmod.lnk")); } catch { }
        try
        {
            string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "kanmod");
            if (Directory.Exists(menu)) Directory.Delete(menu, true);
        }
        catch { }
    }

    private static void ScheduleDelete(string installDir)
    {
        string command = "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + installDir + "\"";
        var info = new ProcessStartInfo("cmd.exe", command);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        Process.Start(info);
    }
}
