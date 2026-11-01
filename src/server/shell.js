// Desktop integration: opening Explorer and launching the app window.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathExists } from '../util/fsx.js';

export function openInExplorer(target, select = false) {
  if (process.platform === 'win32') {
    const args = select ? [`/select,${target}`] : [target];
    spawn('explorer.exe', args, { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [target], { detached: true, stdio: 'ignore' }).unref();
}

export async function openAppWindow(url) {
  if (process.platform !== 'win32') {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      spawn(candidate, [
        `--app=${url}`,
        '--window-size=1440,940',
        '--no-first-run',
        '--disable-features=msEdgeSidebarV2',
      ], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
  }
  spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
