import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

execFileSync(process.execPath, ['scripts/build-typescript.mjs'], {stdio: 'inherit'});
// NodeNext consumers need explicit ESM extensions in declarations as well.
const fixDeclarations = directory => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) fixDeclarations(path);
    else if (entry.name.endsWith('.d.ts')) {
      writeFileSync(path, readFileSync(path, 'utf8').replace(/(['"])(\.\.?\/[^'"]+)\1/g,
        (match, quote, specifier) => /\.[a-z]+$/.test(specifier) ? match : `${quote}${specifier}.js${quote}`));
    }
  }
};
fixDeclarations('dist');

await build({
  entryPoints: ['index', 'evaluation', 'theme-api', 'registries', 'registry.generated',
    'effects.generated', 'animations.generated', 'transitions.generated']
    .map(name => `typescript/src/${name}.ts`),
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'remotion', '@remotion/media', '@remotion/layout-utils'],
});
