// ESLint 10 flat config. Replaces .eslintrc.json, which extended `next/core-web-vitals`
// from the web-app era; Next.js is no longer a dependency.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.velox/**', '.beads/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // The extension host and shared layers run on Node and must stay React-free.
    files: ['src/extension/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'react', message: 'Extension host and shared code must not import React.' }] },
      ],
    },
  },
  {
    // The webview runs in a browser sandbox and must never reach for the
    // extension API, Node, or the raw vscode webview handle.
    files: ['src/webview/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', MessageEvent: 'readonly' },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vscode', message: 'Only src/extension/** may import the vscode API.' },
            { name: 'child_process', message: 'Spawn bd from BdService in the extension host, never here.' },
            { name: 'node:child_process', message: 'Spawn bd from BdService in the extension host, never here.' },
            { name: 'fs', message: 'Filesystem access belongs in the extension host.' },
            { name: 'node:fs', message: 'Filesystem access belongs in the extension host.' },
          ],
        },
      ],
    },
  },
  {
    // `acquireVsCodeApi()` may be called once per webview, and bridge/rpc.ts owns it.
    files: ['src/webview/**/*.{ts,tsx}'],
    ignores: ['src/webview/bridge/rpc.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'acquireVsCodeApi', message: 'Go through src/webview/bridge/rpc.ts.' },
      ],
    },
  },
);
