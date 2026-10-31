import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectKspPath, pathKind } from './version.js';

const execFileAsync = promisify(execFile);

function uniquePaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    const resolved = path.resolve(value);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function steamRootsFromRegistry() {
  if (process.platform !== 'win32') return [];
  const queries = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ];
  const roots = [];
  for (const [key, value] of queries) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', value], {
        windowsHide: true,
        timeout: 3000,
      });
      const match = stdout.match(new RegExp(`${value}\\s+REG_SZ\\s+(.+)`, 'i'));
      if (match) roots.push(match[1].trim());
    } catch {
      // Registry access is optional.
    }
  }
  return roots;
}

async function parseSteamLibraries(steamRoot) {
  const roots = [];
  const vdfFiles = [
    path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    path.join(steamRoot, 'config', 'libraryfolders.vdf'),
  ];
  for (const file of vdfFiles) {
    const text = await readText(file);
    if (!text) continue;
    for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
      roots.push(match[1].replace(/\\\\/g, '\\'));
    }
    for (const match of text.matchAll(/"(\d+)"\s+"([A-Za-z]:\\[^"]+)"/g)) {
      roots.push(match[2].replace(/\\\\/g, '\\'));
    }
  }
  return roots;
}

function driveLetters() {
  if (process.platform !== 'win32') return [];
  const system = process.env.SystemDrive || 'C:';
  const letters = new Set([system.slice(0, 2)]);
  for (const letter of 'CDEFGH') letters.add(`${letter}:`);
  return [...letters];
}

function commonSteamRoots() {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  return [
    programFilesX86 && path.join(programFilesX86, 'Steam'),
    programFiles && path.join(programFiles, 'Steam'),
    localAppData && path.join(localAppData, 'Steam'),
    ...driveLetters().flatMap((drive) => [
      path.join(`${drive}\\`, 'Steam'),
      path.join(`${drive}\\`, 'SteamLibrary'),
      path.join(`${drive}\\`, 'Games', 'Steam'),
    ]),
  ].filter(Boolean);
}

export async function steamLibraryRoots() {
  const registryRoots = await steamRootsFromRegistry();
  const bases = uniquePaths([...registryRoots, ...commonSteamRoots()]);
  const libraries = new Set(bases);
  for (const base of bases) {
    for (const found of await parseSteamLibraries(base)) libraries.add(found);
  }
  return uniquePaths([...libraries]);
}

export async function kspCandidates() {
  const candidates = [];
  const steamLibraries = await steamLibraryRoots();
  for (const library of steamLibraries) {
    candidates.push({
      path: path.join(library, 'steamapps', 'common', 'Kerbal Space Program'),
      source: 'Steam 库',
    });
    candidates.push({
      path: path.join(library, 'common', 'Kerbal Space Program'),
      source: 'Steam 库',
    });
  }
  const envPath = process.env.KSP_DIR || process.env.KSP_PATH;
  if (envPath) candidates.unshift({ path: envPath, source: '环境变量 KSP_DIR' });

  for (const drive of driveLetters()) {
    for (const rel of [
      'GOG Games\\Kerbal Space Program',
      'Epic Games\\KerbalSpaceProgram',
      'Kerbal Space Program',
      'Games\\Kerbal Space Program',
      'Program Files\\Kerbal Space Program',
      'Program Files (x86)\\Kerbal Space Program',
    ]) {
      candidates.push({ path: path.join(`${drive}\\`, rel), source: '常见安装目录' });
    }
  }
  if (process.platform !== 'win32') {
    candidates.push({ path: path.join(os.homedir(), '.steam', 'steam', 'steamapps', 'common', 'Kerbal Space Program'), source: 'Steam 库' });
  }

  const seen = new Set();
  const results = [];
  for (const candidate of candidates) {
    const key = path.resolve(candidate.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if ((await pathKind(candidate.path)) !== 'directory') continue;
    const info = await inspectKspPath(candidate.path);
    if (!info?.isKsp) continue;
    results.push({ ...info, source: candidate.source });
  }
  return results;
}
