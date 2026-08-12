import { describe, expect, it } from 'vitest';
import {
  collectRestrictedImports,
  findUnexpectedHashedViolations,
  formatKnipFindings,
  isRestrictedImportSource,
  sha256,
  stableJsonDigest,
  stableKnipDigest,
} from '../../scripts/quality/ratchet.mjs';
import { normalizeRepositoryText } from '../../scripts/quality/repository.mjs';

describe('static quality ratchet', () => {
  it('allows only unchanged legacy violations and rejects new or edited files', () => {
    const legacyHash = sha256('legacy source');

    expect(
      findUnexpectedHashedViolations({
        actualHashes: {
          'src/legacy.js': legacyHash,
        },
        baselineHashes: {
          'src/legacy.js': legacyHash,
        },
      }),
    ).toEqual([]);

    expect(
      findUnexpectedHashedViolations({
        actualHashes: {
          'src/legacy.js': sha256('edited source'),
          'src/new.js': sha256('new source'),
        },
        baselineHashes: {
          'src/legacy.js': legacyHash,
        },
      }),
    ).toEqual(['src/legacy.js', 'src/new.js']);
  });

  it('keeps issue-set digests stable across object and array order', () => {
    expect(stableJsonDigest({ files: ['b', 'a'], count: 2 })).toBe(
      stableJsonDigest({ count: 2, files: ['b', 'a'] }),
    );
    expect(stableJsonDigest({ files: ['a', 'b'], count: 2 })).toBe(
      stableJsonDigest({ files: ['b', 'a'], count: 2 }),
    );
  });

  it('normalizes checkout line endings and ignores Knip byte offsets', () => {
    expect(normalizeRepositoryText('first\r\nsecond\rthird\n')).toBe(
      'first\nsecond\nthird\n',
    );
    expect(
      stableKnipDigest({ issues: [{ name: 'legacy', line: 2, pos: 12 }] }),
    ).toBe(
      stableKnipDigest({ issues: [{ name: 'legacy', line: 2, pos: 11 }] }),
    );
    expect(
      stableKnipDigest({ issues: [{ name: 'legacy', line: 2, pos: 12 }] }),
    ).not.toBe(
      stableKnipDigest({ issues: [{ name: 'new-export', line: 2, pos: 12 }] }),
    );
    expect(
      formatKnipFindings({
        files: ['src/orphan.js'],
        issues: [
          {
            file: 'src/client.js',
            unresolved: [{ name: 'missing-client', line: 4, col: 9, pos: 42 }],
            exports: [{ name: 'staleExport', line: 8, col: 2, pos: 84 }],
            enumMembers: {
              State: [{ name: 'OLD', line: 12, col: 3, pos: 126 }],
            },
            classMembers: {
              Widget: [{ name: 'legacyMethod', line: 16, col: 5, pos: 168 }],
            },
            duplicates: [
              [
                { name: 'firstCopy', line: 20, col: 2, pos: 210 },
                { name: 'secondCopy', line: 24, col: 6, pos: 252 },
              ],
            ],
          },
        ],
      }),
    ).toBe(
      [
        'src/client.js:12:3: enumMembers State: OLD',
        'src/client.js:16:5: classMembers Widget: legacyMethod',
        'src/client.js:20:2: duplicates: firstCopy',
        'src/client.js:24:6: duplicates: secondCopy',
        'src/client.js:4:9: unresolved: missing-client',
        'src/client.js:8:2: exports: staleExport',
        'src/orphan.js: unused file',
      ].join('\n'),
    );
  });

  it('finds every restricted import occurrence, including computed TS imports', () => {
    const restrictedModuleName = `supabase${'Client'}`;
    const restrictedPrefix = 'supabase';
    const restrictedSuffix = 'Client';
    const computedTemplateImport =
      'await import(`./lib/' +
      restrictedPrefix +
      "${'" +
      restrictedSuffix +
      "'}.js`);";
    expect(
      collectRestrictedImports([
        {
          path: 'src/App.jsx',
          content: `import { supabase } from './lib/${restrictedModuleName}';`,
        },
        {
          path: 'tests/e2e/app.spec.js',
          content: [
            `await import('/src/lib/${restrictedModuleName}.js');`,
            `await import('/src/lib/${restrictedModuleName}.js');`,
          ].join('\n'),
        },
        {
          path: 'backend/src/runner.mts',
          content: `await import('./${restrictedPrefix}' + '${restrictedSuffix}.ts');`,
        },
        {
          path: 'backend/src/template-runner.mts',
          content: computedTemplateImport,
        },
        {
          path: 'vite.config.js',
          content: `import { supabase } from /* legacy */ './lib/${restrictedModuleName}';`,
        },
        {
          path: 'src/safe.js',
          content: "import { api } from './backendClient.js';",
        },
      ]),
    ).toEqual([
      'backend/src/runner.mts::./supabaseClient.ts',
      'backend/src/template-runner.mts::./lib/supabaseClient.js',
      'src/App.jsx::./lib/supabaseClient',
      'tests/e2e/app.spec.js::/src/lib/supabaseClient.js',
      'tests/e2e/app.spec.js::/src/lib/supabaseClient.js',
      'vite.config.js::./lib/supabaseClient',
    ]);
  });

  it('scans every tracked JavaScript and TypeScript module variant', () => {
    expect(
      [
        'vite.config.js',
        'scripts/runner.cjs',
        'scripts/runner.mjs',
        'backend/src/runner.ts',
        'backend/src/runner.tsx',
        'backend/src/runner.cts',
        'backend/src/runner.mts',
      ].every(isRestrictedImportSource),
    ).toBe(true);
    expect(isRestrictedImportSource('docs/runbook.md')).toBe(false);
  });

  it('uses JavaScript syntax instead of matching comments or string contents', () => {
    const restrictedName = `supabase${'Client'}`;
    expect(
      collectRestrictedImports([
        {
          path: 'scripts/syntax-cases.mjs',
          content: [
            `// import './lib/${restrictedName}.js'`,
            `const example = "import './lib/${restrictedName}.js'";`,
            `await import/* trivia */('./lib/${restrictedName}.js');`,
            `require/* trivia */('./lib/${restrictedName}.js');`,
            `await import('./lib/${restrictedName}.js', { with: { type: 'json' } });`,
            `await import('./lib/${restrictedName}.js?tag=)');`,
            `await import('./lib/${restrictedName}.js' + suffix);`,
          ].join('\n'),
        },
      ]),
    ).toEqual([
      `scripts/syntax-cases.mjs::./lib/${restrictedName}.js`,
      `scripts/syntax-cases.mjs::./lib/${restrictedName}.js`,
      `scripts/syntax-cases.mjs::./lib/${restrictedName}.js`,
      `scripts/syntax-cases.mjs::./lib/${restrictedName}.js?tag=)`,
    ]);
  });

  it('unwraps static TypeScript and CommonJS import expressions', () => {
    const restrictedName = `supabase${'Client'}`;
    expect(
      collectRestrictedImports([
        {
          path: 'backend/test/static-imports.mts',
          content: [
            `await import('./${restrictedName}' as const);`,
            `require('./${restrictedName}' satisfies string);`,
            `await import(<const>'./${restrictedName}');`,
            `(require)('./${restrictedName}');`,
            `module.require('./${restrictedName}');`,
            `(module).require('./${restrictedName}');`,
            `module['require']('./${restrictedName}');`,
            `type Legacy = import('./${restrictedName}').Client;`,
            `function local(require) { require('./${restrictedName}'); }`,
            `function localModule(module) { module.require('./${restrictedName}'); }`,
          ].join('\n'),
        },
      ]),
    ).toEqual(
      Array.from(
        { length: 8 },
        () => `backend/test/static-imports.mts::./${restrictedName}`,
      ),
    );
  });
});
