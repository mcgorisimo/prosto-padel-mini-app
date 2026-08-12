import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}

export function relativePath(filePath) {
  return normalizePath(path.relative(REPOSITORY_ROOT, filePath));
}

export function normalizeRepositoryText(content) {
  return content.replace(/\r\n?/g, '\n');
}

export async function readRepositoryFile(filePath) {
  return normalizeRepositoryText(
    await readFile(path.resolve(REPOSITORY_ROOT, filePath), 'utf8'),
  );
}

export async function readStaticQualityBaseline() {
  return JSON.parse(
    await readRepositoryFile('quality/static-quality-baseline.json'),
  );
}

export function listQualityFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      'Unable to enumerate versioned files for static quality gates.',
    );
  }
  return result.stdout.split('\0').filter(Boolean).map(normalizePath).sort();
}
