import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const browserGlobals = {
  ...globals.browser,
  ...globals.es2023,
};

const nodeGlobals = {
  ...globals.node,
  ...globals.es2023,
};

export default [
  {
    ignores: [
      'backend/**/*.{json,ts,tsx}',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: browserGlobals,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-duplicate-imports': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['tests/unit/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-duplicate-imports': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['tests/e2e/**/*.{cjs,js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
      },
      parserOptions: {
        sourceType: 'commonjs',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-duplicate-imports': 'error',
    },
  },
  {
    files: [
      'backend/{src,test}/**/*.{cjs,js,mjs}',
      'scripts/**/*.{cjs,js,mjs}',
      '*.{cjs,js,mjs}',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: nodeGlobals,
      parserOptions: {
        sourceType: 'commonjs',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-duplicate-imports': 'error',
    },
  },
  {
    files: ['*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
      },
    },
  },
];
