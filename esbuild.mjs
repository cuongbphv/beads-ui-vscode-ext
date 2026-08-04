/**
 * Dual-target bundler.
 *
 *   dist/extension.js  node / cjs   — the extension host, `vscode` stays external
 *   dist/webview.js    browser/iife — the React UI, no Node built-ins reachable
 *
 * Tailwind is a separate step (`npm run build:css`) because it reads the CSS
 * entry directly; see package.json.
 */
import { context, build } from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** Turns esbuild diagnostics into the `file:line:col: message` form VSCode links. */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log(`[${new Date().toISOString()}] build finished (${result.errors.length} errors)`);
    });
  },
};

const shared = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'inline',
  logLevel: 'warning',
  plugins: [problemMatcherPlugin],
};

const extensionConfig = {
  ...shared,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Provided by the editor at runtime; bundling it would break activation.
  external: ['vscode'],
};

const webviewConfig = {
  ...shared,
  entryPoints: ['src/webview/main.tsx'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  // The webview has no Node runtime; keep React out of dev-only warning paths.
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
  loader: { '.svg': 'text' },
};

/**
 * Built only for `npm run test:electron`. It is not part of a normal build, so
 * it never reaches the .vsix.
 */
const electronTestConfig = {
  ...shared,
  entryPoints: ['src/test/electron/suite.ts'],
  outfile: 'dist/test/suite.js',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  minify: false,
};

if (process.argv.includes('--tests')) {
  await build(electronTestConfig);
  console.log('built dist/test/suite.js');
}

if (watch) {
  const contexts = await Promise.all([context(extensionConfig), context(webviewConfig)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching…');
} else {
  await Promise.all([build(extensionConfig), build(webviewConfig)]);
}
