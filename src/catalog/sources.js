/**
 * Catalog sources. The official CKAN metadata repository is a GitHub repo of
 * .ckan files; GitHub exposes it as a tar.gz/zip archive. codeload is the same
 * host without the HTML redirect and tends to work better on restricted
 * networks. Custom sources can be any .tar.gz, .zip, or .json catalog export.
 */
export const BUILTIN_CATALOG_SOURCES = [
  {
    id: 'official',
    name: '社区模组索引',
    kind: 'archive',
    description: 'KSP 社区 .ckan 元数据索引 · GitHub master 分支',
    homepage: 'https://github.com/KSP-CKAN/CKAN-meta',
    urls: [
      'https://github.com/KSP-CKAN/CKAN-meta/archive/refs/heads/master.tar.gz',
      'https://codeload.github.com/KSP-CKAN/CKAN-meta/tar.gz/refs/heads/master',
      'https://github.com/KSP-CKAN/CKAN-meta/archive/refs/heads/master.zip',
      'https://codeload.github.com/KSP-CKAN/CKAN-meta/zip/refs/heads/master',
    ],
  },
  {
    id: 'ghproxy',
    name: 'GitHub 加速镜像',
    kind: 'archive',
    description: '通过 ghproxy.net 拉取社区索引，适合 GitHub 访问缓慢的网络',
    homepage: 'https://ghproxy.net',
    enabledByDefault: false,
    urls: [
      'https://ghproxy.net/https://github.com/KSP-CKAN/CKAN-meta/archive/refs/heads/master.tar.gz',
      'https://ghproxy.net/https://github.com/KSP-CKAN/CKAN-meta/archive/refs/heads/master.zip',
    ],
  },
  {
    id: 'custom',
    name: '自定义索引',
    kind: 'custom',
    description: '填写 .ckan 索引的 tar.gz / zip 归档或 kanmod 导出的 JSON 地址',
    urls: [],
  },
];

export function listCatalogSources(config) {
  const custom = (config?.catalog?.customSources || []).map((source) => ({
    id: source.id,
    name: source.name,
    kind: 'archive',
    description: '用户添加的索引地址',
    homepage: source.url,
    urls: [source.url],
    custom: true,
    enabled: source.enabled !== false,
  }));
  return [...BUILTIN_CATALOG_SOURCES.map((source) => ({ ...source })), ...custom];
}

export function getCatalogSource(id, config) {
  return listCatalogSources(config).find((source) => source.id === id) || null;
}

export function enabledCatalogSources(config) {
  const enabled = new Set(config?.catalog?.enabledSources || ['official']);
  return listCatalogSources(config).filter((source) => {
    if (source.id === 'custom' || source.enabled === false) return false;
    if (source.custom) return enabled.has(source.id);
    return enabled.has(source.id);
  });
}
