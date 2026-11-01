using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("kanmod")]
[assembly: AssemblyProduct("kanmod")]
[assembly: AssemblyDescription("Kerbal Space Program 1 mod manager")]
[assembly: AssemblyCompany("kanmod")]
[assembly: AssemblyVersion("0.0.4.0")]
[assembly: AssemblyFileVersion("0.0.4.0")]
[assembly: AssemblyInformationalVersion("0.0.4")]

internal static class Program
{
    private const string AppVersion = "0.0.4";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool noOpen = HasArg(args, "--no-open");
        bool stop = HasArg(args, "--stop");

        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string dataDir = Environment.GetEnvironmentVariable("KANMOD_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dataDir))
        {
            dataDir = Path.Combine(appDir, "data");
        }
        Directory.CreateDirectory(dataDir);

        if (stop)
        {
            StopServer(dataDir);
            return 0;
        }

        string runtimeFile = Path.Combine(dataDir, "runtime.json");
        string url = ReadRunningUrl(runtimeFile);
        if (string.IsNullOrEmpty(url))
        {
            string fallback = ReadFallbackUrl(dataDir);
            if (!string.IsNullOrEmpty(fallback) && IsServerUp(fallback)) url = fallback;
        }
        if (!string.IsNullOrEmpty(url))
        {
            if (!noOpen) OpenUrl(url);
            return 0;
        }

        string nodeExe = Path.Combine(appDir, "node.exe");
        string entry = Path.Combine(appDir, "bin", "supervisor.js");
        if (!File.Exists(nodeExe) || !File.Exists(entry))
        {
            ShowError("kanmod 安装文件不完整。\n\n缺少 node.exe 或 bin\\supervisor.js，请重新运行安装器。");
            return 2;
        }

        try { File.Delete(runtimeFile); } catch { }

        Process child;
        try
        {
            var start = new ProcessStartInfo(nodeExe,
                "\"bin\\supervisor.js\" --port=4173 --data-dir=\"" + dataDir + "\"");
            start.WorkingDirectory = appDir;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.EnvironmentVariables["KANMOD_DATA_DIR"] = dataDir;
            child = Process.Start(start);
        }
        catch (Exception ex)
        {
            WriteLog(dataDir, "启动 node.exe 失败：" + ex);
            ShowError("无法启动 kanmod 服务。\n\n" + ex.Message);
            return 3;
        }

        var deadline = DateTime.UtcNow.AddSeconds(35);
        while (DateTime.UtcNow < deadline)
        {
            url = ReadRunningUrl(runtimeFile);
            if (string.IsNullOrEmpty(url))
            {
                string fallback = ReadFallbackUrl(dataDir);
                if (!string.IsNullOrEmpty(fallback) && IsServerUp(fallback)) url = fallback;
            }
            if (!string.IsNullOrEmpty(url) && IsServerUp(url))
            {
                try { File.WriteAllText(Path.Combine(dataDir, "last-url.txt"), url, Encoding.UTF8); } catch { }
                if (!noOpen) OpenUrl(url);
                return 0;
            }
            if (child != null && child.HasExited)
            {
                if (child.ExitCode == 0)
                {
                    // Another supervisor owns the service. Keep waiting for its health endpoint.
                    child = null;
                }
                else
                {
                    WriteLog(dataDir, "node.exe 提前退出，代码 " + child.ExitCode);
                    ShowError("kanmod 服务启动失败（退出代码 " + child.ExitCode + "）。\n\n日志：" +
                        Path.Combine(dataDir, "supervisor.log"));
                    return 4;
                }
            }
            Thread.Sleep(250);
        }

        WriteLog(dataDir, "等待服务超时。");
        ShowError("kanmod 服务启动超时。\n\n请查看日志：" + Path.Combine(dataDir, "supervisor.log"));
        return 5;
    }

    private static bool HasArg(string[] args, string name)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string ReadFallbackUrl(string dataDir)
    {
        try
        {
            string tokenFile = Path.Combine(dataDir, "token");
            if (!File.Exists(tokenFile)) return null;
            string token = File.ReadAllText(tokenFile, Encoding.UTF8).Trim();
            if (string.IsNullOrEmpty(token)) return null;
            return "http://127.0.0.1:4173/?token=" + Uri.EscapeDataString(token);
        }
        catch
        {
            return null;
        }
    }

    private static string ReadRunningUrl(string runtimeFile)
    {
        try
        {
            if (!File.Exists(runtimeFile)) return null;
            string text = File.ReadAllText(runtimeFile, Encoding.UTF8);
            Match match = Regex.Match(text, "\"url\"\\s*:\\s*\"([^\"]+)\"");
            if (!match.Success) return null;
            string url = Regex.Unescape(match.Groups[1].Value);
            return IsServerUp(url) ? url : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsServerUp(string url)
    {
        try
        {
            Uri uri = new Uri(new Uri(url), "/api/health");
            var request = (HttpWebRequest)WebRequest.Create(uri);
            request.Method = "GET";
            request.Proxy = null;
            request.Timeout = 1200;
            request.ReadWriteTimeout = 1200;
            request.KeepAlive = false;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                if (response.StatusCode != HttpStatusCode.OK) return false;
                string body = reader.ReadToEnd();
                return body.IndexOf("\"ok\":true", StringComparison.OrdinalIgnoreCase) >= 0;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void StopServer(string dataDir)
    {
        KillFromPidFile(Path.Combine(dataDir, "supervisor.json"));
        KillFromPidFile(Path.Combine(dataDir, "runtime.json"), true);
        try { File.Delete(Path.Combine(dataDir, "runtime.json")); } catch { }
        try { File.Delete(Path.Combine(dataDir, "supervisor.json")); } catch { }
    }

    private static void KillFromPidFile(string file, bool runtimeToo = false)
    {
        try
        {
            if (!File.Exists(file)) return;
            string text = File.ReadAllText(file, Encoding.UTF8);
            Match match = Regex.Match(text, "\"pid\"\\s*:\\s*(\\d+)");
            if (match.Success)
            {
                int pid = int.Parse(match.Groups[1].Value);
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
            if (runtimeToo)
            {
                Match child = Regex.Match(text, "\"childPid\"\\s*:\\s*(\\d+)");
                if (child.Success)
                {
                    int childPid = int.Parse(child.Groups[1].Value);
                    try
                    {
                        Process childProcess = Process.GetProcessById(childPid);
                        if (string.Equals(childProcess.ProcessName, "node", StringComparison.OrdinalIgnoreCase))
                        {
                            childProcess.Kill();
                            childProcess.WaitForExit(3000);
                        }
                    }
                    catch { }
                }
            }
        }
        catch { }
    }

    private static void OpenUrl(string url)
    {
        try
        {
            string[] edges =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
            };
            foreach (string edge in edges)
            {
                if (!string.IsNullOrEmpty(edge) && File.Exists(edge))
                {
                    var info = new ProcessStartInfo(edge,
                        "--app=" + url + " --window-size=1440,940 --no-first-run");
                    info.UseShellExecute = false;
                    Process.Start(info);
                    return;
                }
            }
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            ShowError("服务已启动，但无法打开浏览器。\n\n请手动访问：\n" + url + "\n\n" + ex.Message);
        }
    }

    private static void WriteLog(string dataDir, string message)
    {
        try
        {
            Directory.CreateDirectory(dataDir);
            File.AppendAllText(Path.Combine(dataDir, "launcher.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " [v" + AppVersion + "] " + message + Environment.NewLine,
                Encoding.UTF8);
        }
        catch { }
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "kanmod " + AppVersion, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
