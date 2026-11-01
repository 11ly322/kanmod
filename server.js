// Entry facade kept for bin/kanmod.js and existing imports.
// The implementation lives in src/server/.
export {
  APP_ROOT,
  DATA_DIR,
  HttpError,
  broadcast,
  createContext,
  handleRequest,
  openAppWindow,
  openInExplorer,
  startServer,
} from './src/server/app.js';
export { APP_VERSION } from './src/version.js';
