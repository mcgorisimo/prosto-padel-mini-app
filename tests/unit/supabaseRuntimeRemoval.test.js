import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const runtimeRoots = ['src', 'backend/src'];
const runtimeExtensions = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

function listRuntimeFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return listRuntimeFiles(relativePath);
      if (!runtimeExtensions.has(path.extname(entry.name))) return [];
      if (/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
      return [relativePath];
    },
  );
}

describe('Supabase runtime removal', () => {
  it('has no SDK dependency, runtime client, configuration or endpoint surface', () => {
    const runtimeFiles = runtimeRoots.flatMap(listRuntimeFiles);
    const runtimeText = runtimeFiles
      .map((filePath) =>
        readFileSync(path.join(repositoryRoot, filePath), 'utf8'),
      )
      .join('\n');
    const packageText = [
      'package.json',
      'package-lock.json',
      'backend/package.json',
      'backend/package-lock.json',
    ]
      .map((filePath) =>
        readFileSync(path.join(repositoryRoot, filePath), 'utf8'),
      )
      .join('\n');

    expect(runtimeText).not.toMatch(/supabase/iu);
    expect(runtimeText).not.toMatch(/VITE_SUPABASE|SUPABASE_(?:URL|KEY)/u);
    expect(runtimeText).not.toMatch(
      /supabase\.co|\/rest\/v1|\/auth\/v1|realtime\/v1/iu,
    );
    expect(packageText).not.toMatch(/@supabase\/supabase-js/iu);
    expect(
      existsSync(path.join(repositoryRoot, 'src/lib/supabaseClient.js')),
    ).toBe(false);
  });
});
