import path from 'node:path';
import * as prettier from 'prettier';
import { findUnexpectedHashedViolations, sha256 } from './ratchet.mjs';
import {
  listQualityFiles,
  readRepositoryFile,
  readStaticQualityBaseline,
  REPOSITORY_ROOT,
} from './repository.mjs';

const ROOT_CONFIG_FILES = new Set([
  '.prettierrc.json',
  'eslint.config.mjs',
  'index.html',
  'knip.json',
  'package-lock.json',
  'package.json',
  'playwright.config.js',
  'postcss.config.js',
  'quality/static-quality-baseline.json',
  'tailwind.config.js',
  'vite.config.js',
  'vitest.config.mjs',
]);

function isFormattedSource(filePath) {
  if (ROOT_CONFIG_FILES.has(filePath)) return true;
  if (/^(src|tests|scripts)\/.*\.(?:cjs|css|js|jsx|json|mjs)$/.test(filePath)) {
    return true;
  }
  if (
    /^backend\/(?:src|test)\/.*\.(?:cjs|cts|js|json|mjs|mts|ts|tsx)$/.test(
      filePath,
    )
  ) {
    return true;
  }
  return /^backend\/(?:nest-cli|package(?:-lock)?|tsconfig(?:\.build)?)\.json$/.test(
    filePath,
  );
}

const files = listQualityFiles().filter(isFormattedSource);
const actualHashes = {};
const prettierOptions =
  (await prettier.resolveConfig(
    path.resolve(REPOSITORY_ROOT, 'package.json'),
  )) ?? {};
for (const filePath of files) {
  const content = await readRepositoryFile(filePath);
  if (
    !(await prettier.check(content, {
      ...prettierOptions,
      filepath: path.resolve(REPOSITORY_ROOT, filePath),
    }))
  ) {
    actualHashes[filePath] = sha256(content);
  }
}

if (process.argv.includes('--print-baseline')) {
  process.stdout.write(
    `${JSON.stringify(
      {
        configSha256: sha256(await readRepositoryFile('.prettierrc.json')),
        files: actualHashes,
        issueCount: Object.keys(actualHashes).length,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const baseline = await readStaticQualityBaseline();
const configSha256 = sha256(await readRepositoryFile('.prettierrc.json'));
if (baseline.format.configSha256 !== configSha256) {
  throw new Error(
    'Prettier configuration changed without a reviewed baseline update.',
  );
}

const unexpectedPaths = findUnexpectedHashedViolations({
  actualHashes,
  baselineHashes: baseline.format.files,
});
if (unexpectedPaths.length > 0) {
  for (const filePath of unexpectedPaths) {
    process.stderr.write(`${filePath}: file is not formatted\n`);
  }
  throw new Error('Prettier found new or edited unformatted files.');
}

if (Object.keys(actualHashes).length !== baseline.format.issueCount) {
  throw new Error(
    `Prettier legacy file count changed from ${baseline.format.issueCount} to ` +
      `${Object.keys(actualHashes).length}; update the reviewed baseline.`,
  );
}

process.stdout.write(
  `Prettier PASS: ${files.length} files checked; ` +
    `${Object.keys(actualHashes).length} unchanged legacy files ratcheted.\n`,
);
