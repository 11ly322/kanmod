// Run every test file in one process. The node:test child-process runner can be
// blocked by restricted sandboxes, so this keeps `npm test` usable everywhere.
import './version.test.js';
import './catalog.test.js';
import './installer.test.js';
import './mod-manager.test.js';
import './mod-images.test.js';
import './translate.test.js';
import './curseforge.test.js';
import './curseforge-public.test.js';
import './services.test.js';
import './idle.test.js';
