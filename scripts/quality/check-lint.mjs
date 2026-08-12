import { ESLint } from 'eslint';
import { findUnexpectedHashedViolations, sha256 } from './ratchet.mjs';
import {
  listQualityFiles,
  readRepositoryFile,
  readStaticQualityBaseline,
  relativePath,
  REPOSITORY_ROOT,
} from './repository.mjs';

const eslint = new ESLint({ cwd: REPOSITORY_ROOT });
const lintFiles = listQualityFiles().filter(
  (filePath) =>
    /^(?:src|tests)\/.*\.(?:js|jsx)$/.test(filePath) ||
    /^backend\/(?:src|test)\/.*\.(?:cjs|js|mjs)$/.test(filePath) ||
    /^scripts\/.*\.(?:cjs|js|mjs)$/.test(filePath) ||
    /^[^/]+\.(?:cjs|js|mjs)$/.test(filePath),
);
const results = await eslint.lintFiles(lintFiles);
const violatingResults = results.filter((result) => result.messages.length > 0);
const actualHashes = Object.fromEntries(
  await Promise.all(
    violatingResults.map(async (result) => {
      const filePath = relativePath(result.filePath);
      return [filePath, sha256(await readRepositoryFile(filePath))];
    }),
  ),
);

if (process.argv.includes('--print-baseline')) {
  process.stdout.write(
    `${JSON.stringify(
      {
        configSha256: sha256(await readRepositoryFile('eslint.config.mjs')),
        files: actualHashes,
        issueCount: violatingResults.reduce(
          (count, result) => count + result.messages.length,
          0,
        ),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const baseline = await readStaticQualityBaseline();
const configSha256 = sha256(await readRepositoryFile('eslint.config.mjs'));
if (baseline.lint.configSha256 !== configSha256) {
  throw new Error(
    'ESLint configuration changed without a reviewed baseline update.',
  );
}

const unexpectedPaths = findUnexpectedHashedViolations({
  actualHashes,
  baselineHashes: baseline.lint.files,
});
if (unexpectedPaths.length > 0) {
  const formatter = await eslint.loadFormatter('stylish');
  const unexpected = violatingResults.filter((result) =>
    unexpectedPaths.includes(relativePath(result.filePath)),
  );
  process.stderr.write(await formatter.format(unexpected));
  throw new Error(
    `ESLint found violations in new or changed files: ${unexpectedPaths.join(', ')}`,
  );
}

const issueCount = violatingResults.reduce(
  (count, result) => count + result.messages.length,
  0,
);
if (issueCount !== baseline.lint.issueCount) {
  throw new Error(
    `ESLint legacy issue count changed from ${baseline.lint.issueCount} to ${issueCount}; ` +
      'update the reviewed baseline so improvements cannot silently regress.',
  );
}

process.stdout.write(
  `ESLint PASS: ${results.length} files checked; ${issueCount} unchanged legacy issues ratcheted.\n`,
);
