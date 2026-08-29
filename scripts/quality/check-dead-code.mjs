import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  collectRestrictedImports,
  formatKnipFindings,
  isRestrictedImportSource,
  sha256,
  stableKnipDigest,
} from './ratchet.mjs';
import {
  listQualityFiles,
  readRepositoryFile,
  readStaticQualityBaseline,
  REPOSITORY_ROOT,
} from './repository.mjs';

const knip = spawnSync(
  process.execPath,
  [
    path.resolve(REPOSITORY_ROOT, 'node_modules/knip/bin/knip.js'),
    '--reporter',
    'json',
    '--no-exit-code',
    '--no-progress',
  ],
  {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  },
);
if (knip.status !== 0) {
  process.stderr.write(knip.stderr);
  throw new Error('Knip execution failed before producing a report.');
}

const report = JSON.parse(knip.stdout);
const knipDigest = stableKnipDigest(report);
const trackedScripts = listQualityFiles().filter(isRestrictedImportSource);
const restrictedImports = collectRestrictedImports(
  await Promise.all(
    trackedScripts.map(async (filePath) => ({
      path: filePath,
      content: await readRepositoryFile(filePath),
    })),
  ),
);

if (process.argv.includes('--print-baseline')) {
  process.stdout.write(
    `${JSON.stringify(
      {
        configSha256: sha256(await readRepositoryFile('knip.json')),
        issueDigest: knipDigest,
        restrictedImports,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const baseline = await readStaticQualityBaseline();
const configSha256 = sha256(await readRepositoryFile('knip.json'));
if (baseline.deadCode.configSha256 !== configSha256) {
  throw new Error(
    'Knip configuration changed without a reviewed baseline update.',
  );
}
if (baseline.deadCode.issueDigest !== knipDigest) {
  const findings = formatKnipFindings(report);
  if (findings) {
    process.stderr.write(`Current Knip findings:\n${findings}\n`);
  }
  throw new Error(
    'Knip issue set changed. Run `npm exec -- knip --reporter compact` and ' +
      'review every added or removed dead file/export before updating the baseline.',
  );
}
if (restrictedImports.length > 0) {
  throw new Error(
    'Restricted supabaseClient imports are forbidden: ' +
      restrictedImports.join(', '),
  );
}
if (baseline.deadCode.restrictedImports.length > 0) {
  throw new Error(
    'The reviewed baseline must keep restricted imports at zero.',
  );
}

process.stdout.write(
  'Knip PASS: issue digest unchanged; zero supabaseClient imports.\n',
);
