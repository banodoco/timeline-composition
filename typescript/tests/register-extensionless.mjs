// Test-only: the package source uses bundler-style extensionless relative imports
// (`./duration`), which webpack resolves but Node's ESM loader does not. The compiled
// tests run with `node --import ./typescript/tests/register-extensionless.mjs`, which
// retries an unresolved relative specifier with `.js` appended.
import {register} from 'node:module';

register('./extensionless-loader.mjs', import.meta.url);
