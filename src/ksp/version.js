import fs from 'node:fs/promises';
import path from 'node:path';
import { readTailBytes } from '../util/fsx.js';

const KSP_VERSION_RE = /\b(1\.(?:[0-9]{1,2})(?:\.[0-9]{1,2})?(?:\.[0-9]{1,5})?)\b/;

function normalizeCandidate(value) {
  const match = String(value ?? '').match(KSP_VERSION_RE);
  return match ? match[1] : null;
}

async function readSmall(file, bytes = 512 * 1024) {
  try {
    const handle = await fs.open(file, 'r');
    try {
      const stat = await handle.stat();
      if (stat.size > 16 * 1024 * 1024) return null;
      const buffer = Buffer.alloc(Math.min(stat.size, bytes));
      await handle.read(buffer, 0, buffer.length, 0);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function extract(text, patterns) {
  if (!text) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const version = normalizeCandidate(match[1]);
      if (version) return version;
    }
  }
  return null;
}

/**
 * KSP does not expose a single canonical version file across all releases.
 * Read the low-cost locations first and fall back to the Unity data blob.
 */
export async function detectKspVersion(kspPath) {
  if (!kspPath) return { version: null, source: null };
  const candidates = [
    {
      file: 'buildID64.txt',
      source: 'buildID64.txt',
      patterns: [/^\s*(1\.[0-9.]+\S*)/m, /(1\.[0-9.]+)/],
    },
    {
      file: 'buildID.txt',
      source: 'buildID.txt',
      patterns: [/^\s*(1\.[0-9.]+\S*)/m, /(1\.[0-9.]+)/],
    },
    {
      file: 'readme.txt',
      source: 'readme.txt',
      patterns: [
        /Kerbal Space Program\s*(?:[-–:]|version)?\s*(1\.[0-9.]+)/i,
        /version\s+(1\.[0-9.]+)/i,
      ],
    },
    {
      file: 'KSP.log',
      source: 'KSP.log',
      patterns: [
        /Kerbal Space Program\s*[-–]\s*(1\.[0-9.]+)/i,
        /Kerbal Space Program\s*(1\.[0-9.]+)/i,
        /(1\.(?:[0-9]{1,2})\.[0-9]{1,2}(?:\.[0-9]{1,5})?)\s*\(WindowsPlayer/i,
      ],
    },
    {
      file: path.join('KSP_Data', 'output_log.txt'),
      source: 'KSP_Data/output_log.txt',
      patterns: [
        /Kerbal Space Program\s*[-–]\s*(1\.[0-9.]+)/i,
        /(1\.(?:[0-9]{1,2})\.[0-9]{1,2}(?:\.[0-9]{1,5})?)\s*\(WindowsPlayer/i,
      ],
    },
  ];

  for (const candidate of candidates) {
    const text = await readSmall(path.join(kspPath, candidate.file));
    const version = extract(text, candidate.patterns);
    if (version) return { version, source: candidate.source };
  }

  // Last resort: the Unity globalgamemanagers blob contains the product version
  // as plain text. Bound the read so a corrupted file cannot exhaust memory.
  const blob = await readTailBytes(path.join(kspPath, 'KSP_Data', 'globalgamemanagers'), 12 * 1024 * 1024).catch(() => null);
  if (blob) {
    const pattern = /(1\.(?:[0-9]{1,2})\.[0-9]{1,2}\.[0-9]{2,5})/;
    const match = blob.text.match(pattern);
    if (match) return { version: match[1], source: 'KSP_Data/globalgamemanagers' };
  }

  return { version: null, source: null };
}

export async function pathKind(target) {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
  } catch {
    return null;
  }
}

export async function inspectKspPath(inputPath) {
  const resolved = path.resolve(String(inputPath ?? '').trim());
  if (!resolved) return null;
  const kind = await pathKind(resolved);
  if (kind !== 'directory') return null;
  const gameData = path.join(resolved, 'GameData');
  const gameDataKind = await pathKind(gameData);
  const hasGameData = gameDataKind === 'directory';
  const executableCandidates = ['KSP_x64.exe', 'KSP.exe', 'KSP.app'];
  let executable = null;
  for (const name of executableCandidates) {
    if ((await pathKind(path.join(resolved, name))) === 'file') {
      executable = name;
      break;
    }
  }
  const version = await detectKspVersion(resolved);
  const isKsp = hasGameData && (Boolean(executable) || (await pathKind(path.join(resolved, 'buildID64.txt'))) === 'file' ||
    (await pathKind(path.join(resolved, 'KSP_Data'))) === 'directory');
  return {
    path: resolved,
    isKsp,
    hasGameData,
    gameDataPath: hasGameData ? gameData : null,
    executable,
    version: version.version,
    versionSource: version.source,
  };
}
