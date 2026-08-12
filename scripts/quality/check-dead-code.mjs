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
if (
  JSON.stringify(baseline.deadCode.restrictedImports) !==
  JSON.stringify(restrictedImports)
) {
  throw new Error(
    'Restricted supabaseClient imports changed. New imports are forbidden; ' +
      'removals require a reviewed baseline update owned by TD-006/TD-007.',
  );
}

process.stdout.write(
  `Knip PASS: issue digest unchanged; ${restrictedImports.length} legacy ` +
    'supabaseClient imports ratcheted.\n',
);
