const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const host = '127.0.0.1';
const port = 5173;
const baseURL = `http://${host}:${port}`;

function isServerReady() {
  return new Promise((resolve) => {
    const req = http.get(baseURL, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite did not become ready at ${baseURL}`);
}

function killProcessTree(pid) {
  if (!pid) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const liveDefaultsIndex = rawArgs.indexOf('--live-defaults');
  const useLiveDefaults = liveDefaultsIndex !== -1;
  const passedArgs = useLiveDefaults
    ? rawArgs.filter((arg, index) => index !== liveDefaultsIndex)
    : rawArgs;
  const extraArgs = useLiveDefaults && passedArgs.length === 0
    ? ['tests/e2e/padel-domain.live.spec.js', '--grep', '@live', '--workers=1']
    : [
        ...(useLiveDefaults ? ['tests/e2e/padel-domain.live.spec.js'] : []),
        ...passedArgs,
      ];
  let viteProcess = null;
  let ownsServer = false;

  if (!(await isServerReady())) {
    ownsServer = true;
    viteProcess = spawn(process.execPath, [
      path.join('node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      host,
      '--port',
      String(port),
      '--strictPort',
      '--open=false',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: process.platform !== 'win32',
    });

    await waitForServer();
  }

  const playwright = spawn(process.execPath, [
    path.join('node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  const exitCode = await new Promise((resolve) => {
    playwright.on('exit', (code) => resolve(code ?? 1));
    playwright.on('error', () => resolve(1));
  });

  if (ownsServer && viteProcess) {
    killProcessTree(viteProcess.pid);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
