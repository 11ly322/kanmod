using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("kanmod updater")]
[assembly: System.Reflection.AssemblyProduct("kanmod")]
[assembly: System.Reflection.AssemblyCompany("kanmod")]
[assembly: System.Reflection.AssemblyVersion("0.1.2.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.2.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.1.2")]

internal static class Program
{
    internal const string Repo = "11ly322/kanmod";

    [STAThread]
    private static int Main(string[] args)
    {
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
        string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        bool silent = false;
        foreach (string arg in args)
        {
            if (arg.Equals("/S", StringComparison.OrdinalIgnoreCase) || arg.Equals("--silent", StringComparison.OrdinalIgnoreCase))
                silent = true;
            else if (arg.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase))
                installDir = arg.Substring(5).Trim('"');
        }

        if (silent)
        {
            try
            {
                ReleaseInfo release = ReleaseInfo.LoadLatest();
                if (!release.HasUpdate(installDir)) return 0;
                string setup = Download(release, null);
                LaunchSetup(setup, installDir);
                return 0;
            }
            catch
            {
                return 1;
            }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new UpdateForm(installDir));
        return 0;
    }

    internal static string Download(ReleaseInfo release, ProgressBar progress)
    {
        string target = Path.Combine(Path.GetTempPath(), "kanmod-setup-" + release.Version + ".exe");
        if (release.AssetUrl.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
        {
            File.Copy(new Uri(release.AssetUrl).LocalPath, target, true);
            return target;
        }
        if (File.Exists(release.AssetUrl))
        {
            File.Copy(release.AssetUrl, target, true);
            return target;
        }

        var request = (HttpWebRequest)WebRequest.Create(release.AssetUrl);
        request.UserAgent = "kanmod-updater/0.1.2";
        request.Proxy = null;
        request.Timeout = 30000;
        using (var response = (HttpWebResponse)request.GetResponse())
        using (Stream input = response.GetResponseStream())
        using (var output = File.Create(target))
        {
            long total = response.ContentLength;
            if (progress != null)
            {
                progress.Invoke((Action)(() => { progress.Style = ProgressBarStyle.Continuous; progress.Maximum = 100; }));
            }
            byte[] buffer = new byte[81920];
            long readTotal = 0;
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                output.Write(buffer, 0, read);
                readTotal += read;
                if (progress != null && total > 0)
                {
                    int percent = (int)Math.Min(100, readTotal * 100 / total);
                    progress.Invoke((Action)(() => { progress.Value = percent; }));
                }
            }
        }
        if (release.AssetSize > 0 && new FileInfo(target).Length != release.AssetSize)
            throw new InvalidDataException("更新包大小校验失败。");
        return target;
    }

    internal static void LaunchSetup(string setup, string installDir)
    {
        string command = "/c ping 127.0.0.1 -n 3 >nul & \"" + setup + "\" /S /DIR=\"" + installDir + "\" & start \"\" \"" + Path.Combine(installDir, "kanmod.exe") + "\"";
        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = command,
            UseShellExecute = false,
            CreateNoWindow = true,
        });
    }
}

internal sealed class ReleaseInfo
{
    internal string Version = "";
    internal string AssetUrl = "";
    internal long AssetSize;
    internal string PageUrl = "";
    internal string Notes = "";

    internal bool HasUpdate(string installDir)
    {
        string current = ReadInstalledVersion(installDir);
        return Compare(Version, current) > 0;
    }

    internal static string ReadInstalledVersion(string installDir)
    {
        try
        {
            string file = Path.Combine(installDir, "install.json");
            if (!File.Exists(file)) return "0.0.0";
            string text = File.ReadAllText(file, Encoding.UTF8);
            System.Text.RegularExpressions.Match match = System.Text.RegularExpressions.Regex.Match(text, "\"version\"\\s*:\\s*\"([^\"]+)\"");
            return match.Success ? match.Groups[1].Value : "0.0.0";
        }
        catch
        {
            return "0.0.0";
        }
    }

    internal static ReleaseInfo LoadLatest()
    {
        string feed = Environment.GetEnvironmentVariable("KANMOD_UPDATE_FEED");
        string json;
        if (!string.IsNullOrEmpty(feed))
        {
            if (feed.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                json = Get(feed);
            else
                json = File.ReadAllText(feed, Encoding.UTF8);
        }
        else
        {
            json = Get("https://api.github.com/repos/" + Program.Repo + "/releases/latest");
        }

        var serializer = new JavaScriptSerializer();
        var root = serializer.Deserialize<Dictionary<string, object>>(json);
        var release = new ReleaseInfo();
        release.Version = Text(root, "tag_name").TrimStart('v', 'V');
        release.PageUrl = Text(root, "html_url");
        release.Notes = Text(root, "body");
        object assetsValue;
        if (root.TryGetValue("assets", out assetsValue) && assetsValue is IEnumerable)
        {
            foreach (object item in (IEnumerable)assetsValue)
            {
                var asset = item as Dictionary<string, object>;
                if (asset == null) continue;
                string name = Text(asset, "name");
                if (!name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                if (name.IndexOf("setup", StringComparison.OrdinalIgnoreCase) < 0) continue;
                release.AssetUrl = Text(asset, "browser_download_url");
                object size;
                if (asset.TryGetValue("size", out size)) long.TryParse(Convert.ToString(size), out release.AssetSize);
                break;
            }
        }
        if (string.IsNullOrEmpty(release.Version) || string.IsNullOrEmpty(release.AssetUrl))
            throw new InvalidDataException("发布信息中没有找到安装包。");
        return release;
    }

    private static string Get(string url)
    {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.UserAgent = "kanmod-updater/0.1.2";
        request.Accept = "application/vnd.github+json";
        request.Proxy = null;
        request.Timeout = 15000;
        using (var response = (HttpWebResponse)request.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            return reader.ReadToEnd();
    }

    private static string Text(Dictionary<string, object> map, string key)
    {
        object value;
        return map.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
    }

    internal static int Compare(string left, string right)
    {
        string[] a = (left ?? "").TrimStart('v', 'V').Split('-')[0].Split('.');
        string[] b = (right ?? "").TrimStart('v', 'V').Split('-')[0].Split('.');
        for (int i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            int x, y;
            int.TryParse(i < a.Length ? a[i] : "0", out x);
            int.TryParse(i < b.Length ? b[i] : "0", out y);
            if (x != y) return x > y ? 1 : -1;
        }
        return 0;
    }
}

internal sealed class UpdateForm : Form
{
    private readonly string _installDir;
    private readonly Label _version;
    private readonly Label _status;
    private readonly ProgressBar _progress;
    private readonly Button _action;
    private ReleaseInfo _release;

    internal UpdateForm(string installDir)
    {
        _installDir = installDir;
        Text = "kanmod 更新";
        ClientSize = new Size(520, 330);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(251, 248, 247);
        Font = new Font("Microsoft YaHei UI", 9f);

        var title = new Label
        {
            Text = "kanmod 更新",
            Font = new Font("Microsoft YaHei UI", 18f, FontStyle.Bold),
            ForeColor = Color.FromArgb(36, 24, 23),
            AutoSize = true,
            Location = new Point(24, 22),
        };
        Controls.Add(title);

        _version = new Label
        {
            Text = "当前版本 " + ReleaseInfo.ReadInstalledVersion(installDir),
            ForeColor = Color.FromArgb(130, 112, 108),
            AutoSize = true,
            Location = new Point(26, 68),
        };
        Controls.Add(_version);

        _status = new Label
        {
            Text = "正在检查 GitHub 最新版本…",
            ForeColor = Color.FromArgb(60, 45, 42),
            Location = new Point(26, 112),
            Size = new Size(468, 74),
        };
        Controls.Add(_status);

        _progress = new ProgressBar
        {
            Location = new Point(26, 196),
            Size = new Size(468, 8),
            Style = ProgressBarStyle.Continuous,
        };
        Controls.Add(_progress);

        _action = new Button
        {
            Text = "请稍候",
            Enabled = false,
            Location = new Point(350, 242),
            Size = new Size(144, 38),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(225, 29, 46),
            ForeColor = Color.White,
        };
        _action.FlatAppearance.BorderSize = 0;
        _action.Click += (sender, args) =>
        {
            if (_release != null && _release.HasUpdate(_installDir)) StartUpdate();
            else ThreadPool.QueueUserWorkItem((state) => Check());
        };
        Controls.Add(_action);

        var close = new Button
        {
            Text = "关闭",
            Location = new Point(262, 242),
            Size = new Size(78, 38),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(60, 45, 42),
        };
        close.FlatAppearance.BorderColor = Color.FromArgb(226, 216, 212);
        close.Click += (sender, args) => Close();
        Controls.Add(close);

        Shown += (sender, args) => ThreadPool.QueueUserWorkItem((state) => Check());
    }

    private void Check()
    {
        try
        {
            ReleaseInfo release = ReleaseInfo.LoadLatest();
            string current = ReleaseInfo.ReadInstalledVersion(_installDir);
            _release = release;
            Invoke((Action)(() =>
            {
                _version.Text = "当前版本 " + current + "  ·  最新版本 " + release.Version;
                if (release.HasUpdate(_installDir))
                {
                    _status.Text = "发现新版本 " + release.Version + "。更新会保留游戏模组与数据。\r\n" + FirstLine(release.Notes);
                    _action.Text = "下载并安装";
                    _action.Enabled = true;
                }
                else
                {
                    _status.Text = "已经是最新版本。";
                    _action.Text = "重新检查";
                    _action.Enabled = true;
                    _action.Click += (sender, args) => ThreadPool.QueueUserWorkItem((state) => Check());
                }
            }));
        }
        catch (Exception ex)
        {
            Invoke((Action)(() =>
            {
                _status.Text = "检查更新失败：" + ex.Message;
                _action.Text = "重试";
                _action.Enabled = true;
                _action.Click += (sender, args) => ThreadPool.QueueUserWorkItem((state) => Check());
            }));
        }
    }

    private void StartUpdate()
    {
        if (_release == null) return;
        if (!_release.HasUpdate(_installDir))
        {
            _status.Text = "已经是最新版本。";
            return;
        }
        _action.Enabled = false;
        _action.Text = "正在下载…";
        ThreadPool.QueueUserWorkItem((state) =>
        {
            try
            {
                string setup = Program.Download(_release, _progress);
                Invoke((Action)(() =>
                {
                    _status.Text = "下载完成，正在关闭 kanmod 并启动安装程序…";
                    _progress.Value = 100;
                }));
                Program.LaunchSetup(setup, _installDir);
                Invoke((Action)(() => Close()));
            }
            catch (Exception ex)
            {
                Invoke((Action)(() =>
                {
                    _status.Text = "更新失败：" + ex.Message;
                    _action.Text = "重试";
                    _action.Enabled = true;
                }));
            }
        });
    }

    private static string FirstLine(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        string line = text.Replace("\r", "").Split('\n')[0].Trim();
        return line.Length > 100 ? line.Substring(0, 100) : line;
    }
}
