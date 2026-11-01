// Route table composition.
import { registerBootstrapRoutes } from './bootstrap.js';
import { registerInstancesRoutes } from './instances.js';
import { registerCatalogRoutes } from './catalog.js';
import { registerTranslateRoutes } from './translate.js';
import { registerInstallRoutes } from './install.js';
import { registerModsRoutes } from './mods.js';
import { registerDiagnosticsRoutes } from './diagnostics.js';
import { registerSettingsRoutes } from './settings.js';
import { registerModpackRoutes } from './modpack.js';
import { registerSystemRoutes } from './system.js';
import { registerJobsRoutes } from './jobs.js';

export function registerApiRoutes(router) {
  registerBootstrapRoutes(router);
  registerInstancesRoutes(router);
  registerCatalogRoutes(router);
  registerTranslateRoutes(router);
  registerInstallRoutes(router);
  registerModsRoutes(router);
  registerDiagnosticsRoutes(router);
  registerSettingsRoutes(router);
  registerModpackRoutes(router);
  registerSystemRoutes(router);
  registerJobsRoutes(router);
}
