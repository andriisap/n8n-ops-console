import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

// Next's recommended rules (React, hooks, a11y, Core Web Vitals) + typescript-eslint.
// Formatting is Prettier's job, so its config switches off every style rule.
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts', 'AGENTS.md', 'CLAUDE.md'] },
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
];

export default config;
