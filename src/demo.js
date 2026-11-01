import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './config.js';
import { ensureDir, writeFileAtomic } from './util/fsx.js';
import { createZip } from './util/zip.js';

const DEMO_ROOT = process.env.KANMOD_DEMO_DIR
  ? path.resolve(process.env.KANMOD_DEMO_DIR)
  : path.join(APP_ROOT, '.data', 'demo');
export const DEMO_KSP_PATH = path.join(DEMO_ROOT, 'ksp');
export const DEMO_ARCHIVES_DIR = path.join(DEMO_ROOT, 'archives');
export const DEMO_DATA_DIR = path.join(DEMO_ROOT, 'data');

function zipFile(name, content) {
  return { name, data: Buffer.from(content, 'utf8') };
}

function versionFile(identifier, name, version, kspVersion = '1.12.5') {
  return JSON.stringify({
    NAME: name,
    IDENTIFIER: identifier,
    VERSION: version,
    KSP_VERSION: kspVersion,
    AUTHOR: 'kanmod demo',
    ABSTRACT: 'kanmod 离线演示模组',
  }, null, 2);
}

const DEMO_ARCHIVES = [
  {
    file: 'ModuleManager-4.2.3.zip',
    files: [
      zipFile('GameData/ModuleManager/ModuleManager.dll', 'kanmod demo placeholder: ModuleManager'),
      zipFile('GameData/ModuleManager/ModuleManager.version', versionFile('ModuleManager', 'ModuleManager', '4.2.3')),
    ],
  },
  {
    file: 'Harmony-2.2.1.zip',
    files: [
      zipFile('GameData/Harmony/Harmony.dll', 'kanmod demo placeholder: Harmony'),
      zipFile('GameData/Harmony/Harmony.version', versionFile('Harmony', 'Harmony', '2.2.1')),
    ],
  },
  {
    file: 'KSPCommunityFixes-1.35.2.zip',
    files: [
      zipFile('GameData/KSPCommunityFixes/KSPCommunityFixes.dll', 'kanmod demo placeholder: KSPCommunityFixes'),
      zipFile('GameData/KSPCommunityFixes/KSPCommunityFixes.version', versionFile('KSPCommunityFixes', 'KSP Community Fixes', '1.35.2')),
    ],
  },
  {
    file: 'DemoBroken-1.0.0.zip',
    files: [
      zipFile('GameData/DemoBroken/DemoBroken.dll', 'kanmod demo placeholder: DemoBroken'),
      zipFile('GameData/DemoBroken/DemoBroken.version', versionFile('DemoBroken', 'Demo Broken', '1.0.0')),
    ],
  },
  {
    file: 'Waterfall-0.9.0.zip',
    files: [
      zipFile('GameData/Waterfall/Waterfall.dll', 'kanmod demo placeholder: Waterfall'),
      zipFile('GameData/Waterfall/Waterfall.version', versionFile('Waterfall', 'Waterfall', '0.9.0')),
    ],
  },
  {
    file: 'Scatterer-0.0835.zip',
    files: [
      zipFile('GameData/Scatterer/Scatterer.dll', 'kanmod demo placeholder: Scatterer'),
      zipFile('GameData/Scatterer/Scatterer.version', versionFile('Scatterer', 'Scatterer', '0.0835')),
    ],
  },
  {
    file: 'OldParts-0.9.1.zip',
    files: [
      zipFile('GameData/OldParts/OldParts.dll', 'kanmod demo placeholder: OldParts'),
      zipFile('GameData/OldParts/OldParts.version', versionFile('OldParts', 'Old Parts Pack', '0.9.1', '1.10.1')),
    ],
  },
];

function ckan(identifier, name, version, extra = {}) {
  return {
    spec_version: 'v1.34',
    identifier,
    name,
    abstract: extra.abstract || `${name} 的 kanmod 离线演示条目`,
    description: extra.description || '',
    author: 'kanmod demo',
    version,
    license: 'MIT',
    release_status: 'stable',
    ksp_version: '1.12.5',
    depends: extra.depends || [],
    recommends: extra.recommends || [],
    conflicts: extra.conflicts || [],
    install: extra.install || [{ find: identifier, install_to: 'GameData' }],
    download: extra.download ? [`kanmod-demo://${extra.download}`] : [`kanmod-demo://${identifier}-${version}.zip`],
    download_size: 2048,
    resources: {
      homepage: 'https://github.com/KSP-CKAN/CKAN-meta',
    },
    ...extra.raw,
  };
}

export const DEMO_PACKAGES = [
  ckan('ModuleManager', 'ModuleManager', '4.2.3', {
    download: 'ModuleManager-4.2.3.zip',
    abstract: 'A powerful configuration patching engine that lets mods modify KSP configs without editing the originals.',
    description: 'ModuleManager reads patch files scattered across GameData at startup and merges them into the final configuration. Many mods depend on it to add parts, tune values, or repair stock data, so it should usually be installed first.',
  }),
  ckan('Harmony', 'Harmony', '2.2.1', {
    download: 'Harmony-2.2.1.zip',
    abstract: 'A runtime patching library that lets KSP mods apply compatible code patches at startup.',
    description: 'Harmony provides method replacement, prefixes, postfixes, and transpilers, and is a foundation for many modern KSP plugins. It usually needs no extra setup once installed; keeping it up to date is enough.',
  }),
  ckan('KSPCommunityFixes', 'KSP Community Fixes', '1.35.2', {
    download: 'KSPCommunityFixes-1.35.2.zip',
    abstract: 'A community-maintained collection of bug fixes and quality-of-life improvements for KSP 1.12.',
    description: 'This mod fixes several long-standing stock issues and adds a small set of optional quality-of-life improvements. It depends on ModuleManager and generally coexists with most mods.',
    depends: [{ name: 'ModuleManager', min_version: '4.2.0' }],
  }),
  ckan('DemoBroken', 'Demo Broken', '1.0.0', {
    download: 'DemoBroken-1.0.0.zip',
    abstract: 'A deliberately broken demo mod used to showcase kanmod diagnostics and automatic repair.',
    description: 'It declares a dependency on Harmony, but the demo instance does not have Harmony installed, so the log reports an assembly load failure. Use the one-click repair on the diagnostics page to resolve it.',
    depends: [{ name: 'Harmony', min_version: '2.0.0' }],
  }),
  ckan('Waterfall', 'Waterfall', '0.9.0', {
    download: 'Waterfall-0.9.0.zip',
    abstract: 'Adds realistic, configurable engine plume effects to KSP.',
    description: 'Waterfall replaces stock engine effects with configurable plume models and shaders, giving different engines a richer visual identity. It requires ModuleManager to load its configuration.',
    depends: [{ name: 'ModuleManager', min_version: '4.0.0' }],
  }),
  ckan('Scatterer', 'Scatterer', '0.0835', {
    download: 'Scatterer-0.0835.zip',
    abstract: 'Adds atmospheric scattering, ocean shaders, and more realistic skies to KSP.',
    description: 'Scatterer rewrites atmosphere and ocean rendering to make the transition from orbit to ground feel more natural. It is GPU-intensive and may conflict with other atmospheric rendering mods.',
  }),
  {
    ...ckan('OldParts', 'Old Parts Pack', '0.9.1', {
      download: 'OldParts-0.9.1.zip',
      abstract: 'A legacy parts pack from an older KSP release, used to demonstrate compatibility warnings.',
      description: 'This demo package only declares support for KSP 1.10.1, so it appears as possibly incompatible in a 1.12.5 instance. kanmod will not add it to an install plan by default.',
    }),
    ksp_version: '1.10.1',
  },
];

async function writeIfMissing(file, content) {
  try {
    await fs.access(file);
    return false;
  } catch {
    await ensureDir(path.dirname(file));
    await writeFileAtomic(file, content);
    return true;
  }
}

async function buildArchives() {
  await ensureDir(DEMO_ARCHIVES_DIR);
  for (const archive of DEMO_ARCHIVES) {
    const target = path.join(DEMO_ARCHIVES_DIR, archive.file);
    try {
      await fs.access(target);
      continue;
    } catch {
      const buffer = createZip(archive.files, { compress: true });
      await writeFileAtomic(target, buffer);
    }
  }
}

async function createKsp() {
  await ensureDir(path.join(DEMO_KSP_PATH, 'GameData', 'Squad'));
  await ensureDir(path.join(DEMO_KSP_PATH, 'GameData', 'SquadExpansion'));
  await ensureDir(path.join(DEMO_KSP_PATH, 'Ships'));
  await ensureDir(path.join(DEMO_KSP_PATH, 'Missions'));
  await ensureDir(path.join(DEMO_KSP_PATH, 'Tutorials'));
  await ensureDir(path.join(DEMO_KSP_PATH, 'KSP_Data'));
  await writeIfMissing(path.join(DEMO_KSP_PATH, 'buildID64.txt'), '1.12.5\n');
  await writeIfMissing(path.join(DEMO_KSP_PATH, 'GameData', 'Squad', 'Squad.dll'), 'stock placeholder');
  await writeIfMissing(path.join(DEMO_KSP_PATH, 'GameData', 'SquadExpansion', 'Expansion.dll'), 'stock placeholder');
  await writeIfMissing(
    path.join(DEMO_KSP_PATH, 'GameData', 'DemoBroken', 'DemoBroken.dll'),
    'kanmod demo placeholder: preinstalled broken mod',
  );
  await writeIfMissing(
    path.join(DEMO_KSP_PATH, 'GameData', 'DemoBroken', 'DemoBroken.version'),
    versionFile('DemoBroken', 'Demo Broken', '1.0.0'),
  );
  await writeIfMissing(path.join(DEMO_KSP_PATH, 'Ships', 'DemoShip.craft'), 'ship placeholder');
  await writeIfMissing(path.join(DEMO_KSP_PATH, 'readme.txt'), 'Kerbal Space Program 1.12.5\nkanmod demo instance\n');
  await writeIfMissing(path.join(DEMO_KSP_PATH, 'KSP.log'), [
    '[LOG 10:00:00.000] Kerbal Space Program - 1.12.5.3190 (WindowsPlayer x64)',
    '[LOG 10:00:01.000] [ModuleManager] ModuleManager 4.2.3 loaded',
    '[WRN 10:00:02.000] [KSP-AVC] DemoBroken 1.0.0: no KSP version range declared',
    '[ERR 10:00:03.000] [DemoBroken] Missing assembly Harmony; plugin will not load',
    '[EXC 10:00:03.100] FileNotFoundException: Could not load file or assembly \'0Harmony\'',
    '  at DemoBroken.Loader.Start () [0x00000] in <filename unknown>:0',
    '  at UnityEngine.GameObject.AddComponent[T] () [0x00000] in <filename unknown>:0',
    '[LOG 10:00:04.000] [DemoBroken] GameData/DemoBroken/DemoBroken.dll failed to initialize',
    '[ERR 10:00:05.000] NullReferenceException: Object reference not set to an instance of an object',
    '  at DemoBroken.Plugin.Update () [0x00000] in <filename unknown>:0',
    '',
  ].join('\n'));
}

export async function prepareDemo({ fresh = false } = {}) {
  if (fresh) {
    await fs.rm(DEMO_ROOT, { recursive: true, force: true }).catch(() => {});
  }
  await ensureDir(DEMO_ROOT);
  await ensureDir(DEMO_DATA_DIR);
  await ensureDir(DEMO_ARCHIVES_DIR);
  await buildArchives();
  await createKsp();
  return {
    demo: true,
    root: DEMO_ROOT,
    kspPath: DEMO_KSP_PATH,
    archivesDir: DEMO_ARCHIVES_DIR,
    dataDir: DEMO_DATA_DIR,
    packages: DEMO_PACKAGES,
  };
}
