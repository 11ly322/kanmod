using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("kanmod setup")]
[assembly: AssemblyProduct("kanmod")]
[assembly: AssemblyDescription("kanmod installer")]
[assembly: AssemblyCompany("kanmod")]
[assembly: AssemblyVersion("0.0.2.0")]
[assembly: AssemblyFileVersion("0.0.2.0")]
[assembly: AssemblyInformationalVersion("0.0.2")]

internal static class Program
{
    internal const string AppVersion = "0.0.2";

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
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "kanmod");
    }

    internal static void Install(string targetDir, bool createIcons)
    {
        if (string.IsNullOrWhiteSpace(targetDir))
            throw new InvalidOperationException("安装目录不能为空。");

        targetDir = Path.GetFullPath(targetDir);
        StopExistingServer();
        if (Directory.Exists(targetDir))
        {
            try { Directory.Delete(targetDir, true); }
            catch (Exception ex)
            {
                throw new IOException("无法覆盖安装目录。请先退出 kanmod，再重试。\n" + ex.Message);
            }
        }
        Directory.CreateDirectory(targetDir);

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
        if (!File.Exists(exe))
            throw new InvalidOperationException("安装包不完整：缺少 kanmod.exe。");

        File.WriteAllText(Path.Combine(targetDir, "install.json"),
            "{\r\n  \"version\": \"" + AppVersion + "\",\r\n  \"path\": \"" +
            targetDir.Replace("\\", "\\\\") + "\",\r\n  \"installedAt\": \"" +
            DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss") + "\"\r\n}\r\n",
            Encoding.UTF8);

        if (createIcons)
        {
            CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "kanmod.lnk"), exe, targetDir);
            string menuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "kanmod");
            Directory.CreateDirectory(menuDir);
            CreateShortcut(Path.Combine(menuDir, "kanmod.lnk"), exe, targetDir);
        }
    }

    private static void StopExistingServer()
    {
        try
        {
            string dataDir = Environment.GetEnvironmentVariable("KANMOD_DATA_DIR");
            if (string.IsNullOrWhiteSpace(dataDir))
            {
                dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "kanmod", "data");
            }
            string runtimeFile = Path.Combine(dataDir, "runtime.json");
            if (!File.Exists(runtimeFile)) return;
            string text = File.ReadAllText(runtimeFile, Encoding.UTF8);
            Match match = Regex.Match(text, "\"pid\"\\s*:\\s*(\\d+)");
            if (match.Success)
            {
                int pid;
                if (int.TryParse(match.Groups[1].Value, out pid))
                {
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
            }
            Thread.Sleep(300);
            try { File.Delete(runtimeFile); } catch { }
        }
        catch { }
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
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "kanmod — KSP 模组管理器" });
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

    private static void WriteInstallError(Exception ex)
    {
        try
        {
            File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "kanmod-install-error.log"),
                DateTime.Now + Environment.NewLine + ex, Encoding.UTF8);
        }
        catch { }
    }

    internal static void Log(string message)
    {
        try
        {
            File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "kanmod-setup.log"),
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
            Text = "安装 kanmod 桌面启动器。安装包自带运行环境，不需要预先安装 Node.js。",
            Location = new Point(28, 120),
            Size = new Size(580, 24)
        };
        var pathLabel = new Label { Text = "安装位置", Location = new Point(28, 158), AutoSize = true };
        pathBox = new TextBox
        {
            Text = initialDir,
            Location = new Point(28, 182),
            Width = 500,
            Height = 26
        };
        var browse = new Button
        {
            Text = "浏览…",
            Location = new Point(538, 181),
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
            Location = new Point(28, 222),
            AutoSize = true
        };
        var note = new Label
        {
            Text = "用户数据保存在 %LOCALAPPDATA%\\kanmod\\data，升级或重新安装不会删除模组数据。",
            ForeColor = Color.FromArgb(120, 116, 112),
            Location = new Point(28, 250),
            Size = new Size(580, 22)
        };

        installButton = new Button
        {
            Text = "安装 kanmod",
            Location = new Point(28, 292),
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
            Location = new Point(524, 292),
            Size = new Size(88, 40),
            DialogResult = DialogResult.Cancel
        };

        statusLabel = new Label
        {
            Text = "",
            Location = new Point(28, 344),
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
                "kanmod " + Program.AppVersion + " 已安装完成。\n\n是否现在启动？",
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
