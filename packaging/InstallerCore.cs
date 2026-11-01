using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Threading;

namespace Kanmod.Installer
{
    /// <summary>
    /// Owns the low-level install lifecycle: process cleanup, directory replacement
    /// and user-owned ACLs. Setup and uninstaller share this instead of each
    /// carrying their own partial process/delete logic.
    /// </summary>
    internal static class InstallerCore
    {
        private static readonly string[] ProcessNames = { "node", "kanmod", "kanmod-update" };

        internal static string NormalizeDir(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return string.Empty;
            return Path.GetFullPath(path).TrimEnd('\\');
        }

        internal static bool IsUnder(string path, string root)
        {
            if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(root)) return false;
            string prefix = NormalizeDir(root) + "\\";
            return path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Stops only processes that belong to the install trees being replaced.
        /// A node.exe launched from another folder that happens to serve this
        /// install is stopped through <see cref="StopServerFromData"/> instead.
        /// </summary>
        internal static void StopProcessesForInstall(Action<string> log, params string[] roots)
        {
            var normalized = new List<string>();
            foreach (string root in roots)
            {
                if (!string.IsNullOrWhiteSpace(root)) normalized.Add(NormalizeDir(root));
            }
            if (normalized.Count == 0) return;

            foreach (string name in ProcessNames)
            {
                Process[] processes;
                try { processes = Process.GetProcessesByName(name); }
                catch { continue; }

                foreach (Process process in processes)
                {
                    try
                    {
                        string exe = process.MainModule.FileName;
                        if (!IsUnder(exe, normalized)) continue;
                        log("stopping " + name + " pid=" + process.Id + " path=" + exe);
                        process.Kill();
                        process.WaitForExit(5000);
                    }
                    catch { }
                    finally
                    {
                        try { process.Dispose(); } catch { }
                    }
                }
            }

            // Give Windows a moment to release image handles and log files.
            Thread.Sleep(400);
        }

        private static bool IsUnder(string path, List<string> roots)
        {
            foreach (string root in roots)
            {
                if (IsUnder(path, root)) return true;
            }
            return false;
        }

        /// <summary>
        /// Kills the node processes recorded by the supervisor/runtime state files
        /// and removes those files so a later start does not trust stale PIDs.
        /// </summary>
        internal static void StopServerFromData(string dataDir, Action<string> log)
        {
            if (string.IsNullOrWhiteSpace(dataDir)) return;
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
                            string name = process.ProcessName;
                            if (string.Equals(name, "node", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(name, "kanmod", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(name, "kanmod-update", StringComparison.OrdinalIgnoreCase))
                            {
                                log("stopping " + name + " pid=" + pid + " from " + Path.GetFileName(file));
                                process.Kill();
                                process.WaitForExit(4000);
                            }
                            process.Dispose();
                        }
                        catch { }
                    }
                    try { File.Delete(file); } catch { }
                }
                catch { }
            }
        }

        internal static void DeleteDirectoryWithRetry(string path, Action<string> log)
        {
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return;
            path = NormalizeDir(path);

            Exception last = null;
            for (int attempt = 0; attempt < 8; attempt++)
            {
                try
                {
                    ClearReadOnly(path);
                    Directory.Delete(path, true);
                    return;
                }
                catch (Exception ex)
                {
                    last = ex;
                    Thread.Sleep(250 + attempt * 150);
                }
            }

            // A directory handle (antivirus, Explorer, stale shell) can prevent
            // in-place deletion even after every process exits. Renaming makes the
            // install path available immediately; the old tree is best-effort.
            string parent = Path.GetDirectoryName(path);
            string oldPath = Path.Combine(parent, "." + Path.GetFileName(path) + ".old-" + DateTime.Now.Ticks);
            try
            {
                Directory.Move(path, oldPath);
                log("deferred old install: " + oldPath);
                for (int attempt = 0; attempt < 4; attempt++)
                {
                    try { Directory.Delete(oldPath, true); return; }
                    catch { Thread.Sleep(400); }
                }
                return;
            }
            catch
            {
                throw new IOException(
                    "无法替换安装目录，仍有进程占用文件。请确认 kanmod 已退出后重试。\n" +
                    (last == null ? path : last.Message));
            }
        }

        private static void ClearReadOnly(string dir)
        {
            try
            {
                foreach (string file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                {
                    try
                    {
                        FileAttributes attributes = File.GetAttributes(file);
                        if ((attributes & FileAttributes.ReadOnly) != 0)
                            File.SetAttributes(file, attributes & ~FileAttributes.ReadOnly);
                    }
                    catch { }
                }
            }
            catch { }
        }

        /// <summary>
        /// Grants the invoking user full control (inherited by children) on the
        /// tree. Non-elevated processes cannot change an owner, so ownership is
        /// only rewritten when elevated; an explicit DACL entry is enough for a
        /// normal user to write, replace and delete the install.
        /// Returns false when the root itself is still not writable.
        /// </summary>
        internal static bool EnsureUserAccess(string rootPath, Action<string> log)
        {
            if (string.IsNullOrWhiteSpace(rootPath) || !Directory.Exists(rootPath)) return true;
            rootPath = NormalizeDir(rootPath);

            WindowsIdentity identity;
            try { identity = WindowsIdentity.GetCurrent(); }
            catch { return true; }
            if (identity == null || identity.User == null) return true;
            SecurityIdentifier user = identity.User;
            bool elevated = IsElevated(identity);
            bool ownerMismatch = false;
            try
            {
                IdentityReference owner = new DirectoryInfo(rootPath).GetAccessControl()
                    .GetOwner(typeof(SecurityIdentifier));
                ownerMismatch = owner == null || !string.Equals(owner.Value, user.Value, StringComparison.OrdinalIgnoreCase);
            }
            catch { }

            bool rootOk = ApplyDirectoryAcl(rootPath, user, elevated, log);
            if (!rootOk)
            {
                log("acl root still not writable: " + rootPath);
                return false;
            }

            int repaired = 0;
            int denied = 0;
            try
            {
                foreach (string dir in Directory.EnumerateDirectories(rootPath, "*", SearchOption.AllDirectories))
                {
                    DirectorySecurity security;
                    try { security = new DirectoryInfo(dir).GetAccessControl(); }
                    catch { continue; }
                    if (!security.AreAccessRulesProtected) continue; // inherited ACE already covers us
                    if (ApplyDirectoryAcl(dir, user, elevated, log)) repaired++;
                    else denied++;
                    if (denied >= 20)
                    {
                        log("acl repair stopped after 20 denied folders");
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                log("acl walk stopped: " + ex.Message);
            }

            if (repaired > 0) log("acl repaired " + repaired + " restricted folder(s)");
            if (denied > 0) log("acl still restricted in " + denied + " folder(s)");
            if (!elevated && ownerMismatch)
                log("acl: root is owned by another account; granted explicit full control (ownership unchanged)");
            return true;
        }

        internal static void RequireUserAccess(string rootPath, Action<string> log)
        {
            if (!EnsureUserAccess(rootPath, log))
            {
                throw new IOException(
                    "当前账户无法写入安装目录：\n" + rootPath + "\n\n" +
                    "该目录由其他账户创建且权限受限。请换一个安装目录，或以管理员身份运行安装程序后重试。");
            }
        }

        private static bool IsElevated(WindowsIdentity identity)
        {
            try
            {
                return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch { return false; }
        }

        private static bool ApplyDirectoryAcl(string path, SecurityIdentifier user, bool elevated, Action<string> log)
        {
            try
            {
                var info = new DirectoryInfo(path);
                DirectorySecurity security = info.GetAccessControl();
                bool changed = false;

                IdentityReference owner = security.GetOwner(typeof(SecurityIdentifier));
                if (owner == null || !string.Equals(owner.Value, user.Value, StringComparison.OrdinalIgnoreCase))
                {
                    if (elevated)
                    {
                        security.SetOwner(user);
                        changed = true;
                    }
                }

                if (!HasExplicitFullControl(security, user))
                {
                    security.AddAccessRule(new FileSystemAccessRule(
                        user,
                        FileSystemRights.FullControl,
                        InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                        PropagationFlags.None,
                        AccessControlType.Allow));
                    changed = true;
                }

                if (changed) info.SetAccessControl(security);
                return CanWriteProbe(path);
            }
            catch (UnauthorizedAccessException)
            {
                log("acl denied " + path);
                return false;
            }
            catch (Exception ex)
            {
                log("acl failed " + path + ": " + ex.Message);
                return false;
            }
        }

        private static bool HasExplicitFullControl(FileSystemSecurity security, SecurityIdentifier user)
        {
            try
            {
                foreach (FileSystemAccessRule rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier)))
                {
                    if (rule.AccessControlType != AccessControlType.Allow) continue;
                    if (rule.IdentityReference == null) continue;
                    if (!string.Equals(rule.IdentityReference.Value, user.Value, StringComparison.OrdinalIgnoreCase)) continue;
                    if ((rule.FileSystemRights & FileSystemRights.FullControl) != FileSystemRights.FullControl) continue;
                    InheritanceFlags inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
                    if ((rule.InheritanceFlags & inherit) != inherit) continue;
                    return true;
                }
            }
            catch { }
            return false;
        }

        private static bool CanWriteProbe(string dir)
        {
            string probe = Path.Combine(dir, ".kanmod-write-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (File.Create(probe)) { }
                File.Delete(probe);
                return true;
            }
            catch
            {
                try { File.Delete(probe); } catch { }
                return false;
            }
        }
    }
}
