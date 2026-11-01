using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;
using Kanmod.Installer;

[assembly: AssemblyTitle("kanmod setup")]
[assembly: AssemblyProduct("kanmod")]
[assembly: AssemblyDescription("kanmod installer")]
[assembly: AssemblyCompany("kanmod")]
[assembly: AssemblyVersion("0.0.72.0")]
[assembly: AssemblyFileVersion("0.0.72.0")]
[assembly: AssemblyInformationalVersion("0.0.72")]

internal static class Program
{
    internal const string AppVersion = "0.0.72";

    [STAThread]
    private static int Main(string[] args)
    {
        Log("start args: " + string.Join(" | ", args));
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool silent = HasArg(args, "/S") || HasArg(args, "--silent");
        bool noIcons = HasArg(args, "/NOICONS") || HasArg(args, "--no-icons");
        string installDir = DefaultInstallDir();
        foreach (string arg in args)
        {
            if (arg.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase))
                installDir = arg.Substring(5).Trim('"');
            else if (arg.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase))
                installDir = arg.Substring(6).Trim('"');
        }

        if (silent)
        {
            try
            {
                Log("silent install -> " + installDir);
                Install(installDir, !noIcons);
                Log("silent install ok");
                return 0;
            }
            catch (Exception ex)
            {
                Log("silent install failed: " + ex);
                WriteInstallError(ex);
                return 1;
            }
        }

        Application.Run(new SetupForm(installDir));
        return 0;
    }

    internal static string DefaultInstallDir()
    {
        string configured = Environment.GetEnvironmentVariable("KANMOD_INSTALL_DIR");
        if (!string.IsNullOrWhiteSpace(configured))
            return Path.GetFullPath(configured);

        // Prefer a real non-system drive so program and data stay together off C:.
        try
        {
            foreach (DriveInfo drive in DriveInfo.GetDrives())
            {
                if (!drive.IsReady || drive.DriveType != DriveType.Fixed) continue;
                if (string.Equals(drive.RootDirectory.FullName, Path.GetPathRoot(Environment.SystemDirectory), StringComparison.OrdinalIgnoreCase)) continue;
                if (drive.AvailableFreeSpace < 512L * 1024 * 1024) continue;
                return Path.Combine(drive.RootDirectory.FullName, "Programs", "kanmod");
            }
        }
        catch { }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "kanmod");
    }

    internal static string DataDirFor(string targetDir)
    {
        return Path.Combine(Path.GetFullPath(targetDir), "data");
    }

    internal static string LegacyDataDir()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "kanmod", "data");
    }

    internal static string LegacyInstallDir()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "kanmod");
    }

    internal static void Install(string targetDir, bool createIcons)
    {
        if (string.IsNullOrWhiteSpace(targetDir))
            throw new InvalidOperationException("安装目录不能为空。");

        targetDir = Path.GetFullPath(targetDir).TrimEnd('\\');
        if (string.Equals(targetDir, Path.GetPathRoot(targetDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("不能把 kanmod 安装到磁盘根目录。请选择单独的子目录。");

        string dataDir = DataDirFor(targetDir);
        string legacyData = LegacyDataDir();
        string legacyInstall = LegacyInstallDir();
        StopExistingServer(targetDir);

        // The launcher stores state in the data subfolder. A manual
        // "node bin/kanmod.js" run uses the dot-data folder instead; migrate it
        // so an upgrade never discards
        // an existing configuration, index cache or mod registry.
        string existingData = null;
        if (Directory.Exists(dataDir)) existingData = dataDir;
        else if (Directory.Exists(Path.Combine(targetDir, ".data")))
        {
            existingData = Path.Combine(targetDir, ".data");
            Log("migrating .data to data");
        }

        string backup = null;
        if (existingData != null)
        {
            backup = Path.Combine(Path.GetDirectoryName(targetDir), "." + Path.GetFileName(targetDir) + ".data-" + DateTime.Now.Ticks);
            InstallerCore.EnsureUserAccess(existingData, Log);
            Directory.Move(existingData, backup);
        }

        try
        {
            if (Directory.Exists(targetDir))
            {
                // Refuse early with an actionable message when an older elevated
                // install left a directory this user cannot replace.
                InstallerCore.RequireUserAccess(targetDir, Log);
                InstallerCore.DeleteDirectoryWithRetry(targetDir, Log);
            }
            Directory.CreateDirectory(targetDir);
            InstallerCore.EnsureUserAccess(targetDir, Log);

            string tempZip = Path.Combine(targetDir, ".kanmod-payload.zip");
            try
            {
                using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                {
                    if (resource == null) throw new InvalidOperationException("安装包资源缺失。");
                    using (var file = File.Create(tempZip)) resource.CopyTo(file);
                }
                ZipFile.ExtractToDirectory(tempZip, targetDir);
            }
            finally
            {
                try { File.Delete(tempZip); } catch { }
            }

            string exe = Path.Combine(targetDir, "kanmod.exe");
            string uninstaller = Path.Combine(targetDir, "uninstall.exe");
            string updater = Path.Combine(targetDir, "kanmod-update.exe");
            if (!File.Exists(exe))
                throw new InvalidOperationException("安装包不完整：缺少 kanmod.exe。");
            if (!File.Exists(uninstaller))
                throw new InvalidOperationException("安装包不完整：缺少 uninstall.exe。");
            if (!File.Exists(updater))
                throw new InvalidOperationException("安装包不完整：缺少 kanmod-update.exe。");

            if (!string.IsNullOrEmpty(backup) && Directory.Exists(backup))
            {
                Directory.Move(backup, dataDir);
            }
            else if (!Directory.Exists(dataDir) && Directory.Exists(legacyData))
            {
                CopyDirectory(legacyData, dataDir);
            }

            if (Directory.Exists(dataDir))
                InstallerCore.EnsureUserAccess(dataDir, Log);

            File.WriteAllText(Path.Combine(targetDir, "install.json"),
                "{\r\n  \"version\": \"" + AppVersion + "\",\r\n  \"path\": \"" +
                targetDir.Replace("\\", "\\\\") + "\",\r\n  \"dataDir\": \"" +
                dataDir.Replace("\\", "\\\\") + "\",\r\n  \"installedAt\": \"" +
                DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss") + "\"\r\n}\r\n",
                Encoding.UTF8);

            if (createIcons)
                CreateIcons(targetDir, exe, uninstaller, updater);
            RegisterUninstall(targetDir, exe, uninstaller);

            CleanupLegacy(legacyInstall, legacyData, targetDir);
        }
        catch
        {
            if (!string.IsNullOrEmpty(backup) && Directory.Exists(backup) && !Directory.Exists(dataDir))
            {
                try { Directory.Move(backup, dataDir); } catch { }
            }
            throw;
        }
    }

    private static void CreateIcons(string targetDir, string exe, string uninstaller, string updater)
    {
        CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "kanmod.lnk"), exe, targetDir);
        string menuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "kanmod");
        Directory.CreateDirectory(menuDir);
        CreateShortcut(Path.Combine(menuDir, "kanmod.lnk"), exe, targetDir);
        CreateShortcut(Path.Combine(menuDir, "更新 kanmod.lnk"), updater, targetDir);
        CreateShortcut(Path.Combine(menuDir, "卸载 kanmod.lnk"), uninstaller, targetDir);
    }

    private static void RegisterUninstall(string targetDir, string exe, string uninstaller)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\kanmod"))
        {
            if (key == null) return;
            key.SetValue("DisplayName", "kanmod", RegistryValueKind.String);
            key.SetValue("DisplayVersion", AppVersion, RegistryValueKind.String);
            key.SetValue("Publisher", "kanmod", RegistryValueKind.String);
            key.SetValue("InstallLocation", targetDir, RegistryValueKind.String);
            key.SetValue("DisplayIcon", exe + ",0", RegistryValueKind.String);
            key.SetValue("UninstallString", "\"" + uninstaller + "\"", RegistryValueKind.String);
            key.SetValue("QuietUninstallString", "\"" + uninstaller + "\" /S", RegistryValueKind.String);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", 64000, RegistryValueKind.DWord);
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(destination, directory.Substring(source.Length).TrimStart('\\')));
        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            string relative = file.Substring(source.Length).TrimStart('\\');
            string target = Path.Combine(destination, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            File.Copy(file, target, true);
        }
    }

    private static void CleanupLegacy(string legacyInstall, string legacyData, string targetDir)
    {
        try
        {
            string newData = DataDirFor(targetDir);
            if (!string.Equals(legacyData, newData, StringComparison.OrdinalIgnoreCase) && Directory.Exists(legacyData))
            {
                Directory.Delete(legacyData, true);
                string legacyRoot = Path.GetDirectoryName(legacyData);
                if (Directory.Exists(legacyRoot) && Directory.GetFileSystemEntries(legacyRoot).Length == 0)
                    Directory.Delete(legacyRoot);
            }
        }
        catch { }

        try
        {
            if (!string.Equals(legacyInstall.TrimEnd('\\'), targetDir, StringComparison.OrdinalIgnoreCase) && Directory.Exists(legacyInstall))
                Directory.Delete(legacyInstall, true);
        }
        catch { }
    }

    private static void StopExistingServer(string targetDir)
    {
        InstallerCore.StopProcessesForInstall(Log, targetDir, LegacyInstallDir());
        InstallerCore.StopServerFromData(DataDirFor(targetDir), Log);
        InstallerCore.StopServerFromData(LegacyDataDir(), Log);
    }

    private static void CreateShortcut(string linkPath, string targetPath, string workingDir)
    {
        object shell = null;
        object shortcut = null;
        try
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath + ",0" });
            string description = Path.GetFileName(targetPath).IndexOf("update", StringComparison.OrdinalIgnoreCase) >= 0
                ? "检查并安装 kanmod 更新"
                : "kanmod — KSP 模组管理器";
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        catch { }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.ReleaseComObject(shortcut);
            if (shell != null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
        }
    }

    private static bool HasArg(string[] args, string value)
    {
        foreach (string arg in args)
            if (string.Equals(arg, value, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string SetupLogPath()
    {
        return Path.Combine(Path.GetTempPath(), "kanmod-setup.log");
    }

    private static void WriteInstallError(Exception ex)
    {
        try
        {
            File.WriteAllText(Path.Combine(Path.GetTempPath(), "kanmod-install-error.log"),
                DateTime.Now + Environment.NewLine + ex, Encoding.UTF8);
        }
        catch { }
    }

    internal static void Log(string message)
    {
        try
        {
            File.AppendAllText(SetupLogPath(),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine,
                Encoding.UTF8);
        }
        catch { }
    }
}

internal sealed class SetupForm : Form
{
    private readonly TextBox pathBox;
    private readonly CheckBox desktopBox;
    private readonly Button installButton;
    private readonly Label statusLabel;

    internal SetupForm(string initialDir)
    {
        Text = "kanmod " + Program.AppVersion + " 安装程序";
        ClientSize = new Size(640, 390);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        BackColor = Color.FromArgb(250, 249, 247);
        Font = new Font("Microsoft YaHei UI", 9F);

        var top = new Panel { Dock = DockStyle.Top, Height = 96, BackColor = Color.White };
        top.Paint += delegate (object sender, PaintEventArgs e)
        {
            e.Graphics.FillRectangle(new SolidBrush(Color.FromArgb(225, 29, 46)), 0, 94, Width, 2);
        };
        var mark = new Label
        {
            Text = "K",
            Font = new Font("Segoe UI", 22F, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Color.FromArgb(225, 29, 46),
            TextAlign = ContentAlignment.MiddleCenter,
            Location = new Point(24, 22),
            Size = new Size(48, 48)
        };
        var title = new Label
        {
            Text = "kanmod",
            Font = new Font("Segoe UI", 20F, FontStyle.Bold),
            ForeColor = Color.FromArgb(27, 23, 25),
            Location = new Point(88, 18),
            AutoSize = true
        };
        var subtitle = new Label
        {
            Text = "坎巴拉太空计划 1 模组管理器 · 版本 " + Program.AppVersion,
            ForeColor = Color.FromArgb(110, 105, 102),
            Location = new Point(90, 56),
            AutoSize = true
        };
        top.Controls.Add(mark);
        top.Controls.Add(title);
        top.Controls.Add(subtitle);

        var intro = new Label
        {
            Text = "安装 kanmod 桌面启动器。程序、运行环境和用户数据都保存在安装目录，默认优先选择非 C 盘。",
            Location = new Point(28, 120),
            Size = new Size(580, 38)
        };
        var pathLabel = new Label { Text = "安装位置", Location = new Point(28, 164), AutoSize = true };
        pathBox = new TextBox
        {
            Text = initialDir,
            Location = new Point(28, 188),
            Width = 500,
            Height = 26
        };
        var browse = new Button
        {
            Text = "浏览…",
            Location = new Point(538, 187),
            Size = new Size(74, 27)
        };
        browse.Click += delegate
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择 kanmod 安装目录";
                dialog.SelectedPath = pathBox.Text;
                if (dialog.ShowDialog(this) == DialogResult.OK) pathBox.Text = dialog.SelectedPath;
            }
        };

        desktopBox = new CheckBox
        {
            Text = "创建桌面快捷方式",
            Checked = true,
            Location = new Point(28, 226),
            AutoSize = true
        };
        var note = new Label
        {
            Text = "程序、模组数据、缓存和备份都保存在安装目录。卸载程序会停止服务并删除整个安装目录。",
            ForeColor = Color.FromArgb(120, 116, 112),
            Location = new Point(28, 254),
            Size = new Size(580, 40)
        };

        installButton = new Button
        {
            Text = "安装 kanmod",
            Location = new Point(28, 304),
            Size = new Size(160, 40),
            BackColor = Color.FromArgb(225, 29, 46),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        installButton.FlatAppearance.BorderSize = 0;
        installButton.Click += InstallClicked;

        var cancel = new Button
        {
            Text = "取消",
            Location = new Point(524, 304),
            Size = new Size(88, 40),
            DialogResult = DialogResult.Cancel
        };

        statusLabel = new Label
        {
            Text = "",
            Location = new Point(28, 354),
            Size = new Size(584, 24),
            ForeColor = Color.FromArgb(110, 105, 102)
        };

        Controls.Add(top);
        Controls.Add(intro);
        Controls.Add(pathLabel);
        Controls.Add(pathBox);
        Controls.Add(browse);
        Controls.Add(desktopBox);
        Controls.Add(note);
        Controls.Add(installButton);
        Controls.Add(cancel);
        Controls.Add(statusLabel);
    }

    private void InstallClicked(object sender, EventArgs e)
    {
        string dir = pathBox.Text.Trim();
        if (dir.Length == 0)
        {
            MessageBox.Show(this, "请选择安装目录。", "kanmod", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        installButton.Enabled = false;
        statusLabel.Text = "正在安装，请稍候…";
        Cursor = Cursors.WaitCursor;
        Application.DoEvents();
        try
        {
            Program.Install(dir, desktopBox.Checked);
            statusLabel.Text = "安装完成。";
            Cursor = Cursors.Default;
            DialogResult result = MessageBox.Show(this,
                "kanmod " + Program.AppVersion + " 已安装完成。\n\n程序与数据都在安装目录，卸载时可一并删除。\n\n是否现在启动？",
                "安装完成", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (result == DialogResult.Yes)
            {
                string exe = Path.Combine(Path.GetFullPath(dir), "kanmod.exe");
                if (File.Exists(exe)) Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
            }
            Close();
        }
        catch (Exception ex)
        {
            Cursor = Cursors.Default;
            installButton.Enabled = true;
            statusLabel.Text = "安装失败。";
            MessageBox.Show(this, ex.Message, "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
