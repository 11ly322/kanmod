using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;
using Kanmod.Installer;

[assembly: System.Reflection.AssemblyTitle("kanmod uninstaller")]
[assembly: System.Reflection.AssemblyProduct("kanmod")]
[assembly: System.Reflection.AssemblyDescription("kanmod uninstaller")]
[assembly: System.Reflection.AssemblyCompany("kanmod")]
[assembly: System.Reflection.AssemblyVersion("0.1.5.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.5.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.1.5-beta")]

internal static class Program
{
    private const string AppVersion = "0.1.5-beta";
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
            InstallerCore.StopProcessesForInstall(delegate(string message) { }, installDir);
            InstallerCore.StopServerFromData(Path.Combine(installDir, "data"), delegate(string message) { });
            // Restore a user-owned ACL so the deferred rmdir is not blocked by a
            // folder created by an older elevated setup.
            InstallerCore.EnsureUserAccess(installDir, delegate(string message) { });
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
