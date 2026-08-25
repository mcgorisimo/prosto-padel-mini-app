const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const host = '127.0.0.1';
const port = 5173;
const baseURL = `http://${host}:${port}`;
const e2eEnvironment = {
  ...process.env,
  BROWSER: 'none',
  VITE_ONBOARDING_LEGAL_PUBLISHED: 'true',
  VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'true',
  VITE_ONBOARDING_LEGAL_TEST_ONLY: 'false',
  VITE_ONBOARDING_TERMS_URL:
    'https://test-app.prostopdl.ru/legal/terms/terms-2026-08-26-v1/',
  VITE_ONBOARDING_TERMS_VERSION: 'terms-2026-08-26-v1',
  VITE_ONBOARDING_CANCELLATION_URL:
    'https://test-app.prostopdl.ru/legal/cancellation/cancellation-2026-08-26-v1/',
  VITE_ONBOARDING_CANCELLATION_VERSION: 'cancellation-2026-08-26-v1',
  VITE_ONBOARDING_PRIVACY_URL:
    'https://test-app.prostopdl.ru/legal/privacy/privacy-2026-08-26-v1/',
  VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-2026-08-26-v1',
  VITE_ONBOARDING_PERSONAL_DATA_CONSENT_URL:
    'https://test-app.prostopdl.ru/legal/personal-data-consent/personal-data-consent-2026-08-26-v1/',
  VITE_ONBOARDING_PERSONAL_DATA_CONSENT_VERSION:
    'personal-data-consent-2026-08-26-v1',
};

function assertPortIsFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(
          `Refusing to reuse an existing server at ${baseURL}. ` +
          'Stop the process that owns port 5173 and run E2E again.',
        ));
        return;
      }
      reject(error);
    });

    probe.listen({ host, port, exclusive: true }, () => {
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

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

async function waitForServer(viteProcess, getStartError, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const startError = getStartError();
    if (startError) {
      throw new Error(`Owned Vite failed to start: ${startError.message}`);
    }
    if (viteProcess.exitCode !== null || viteProcess.signalCode !== null) {
      throw new Error(
        'Owned Vite exited before becoming ready ' +
        `(code ${viteProcess.exitCode}, signal ${viteProcess.signalCode}).`,
      );
    }
    if (await isServerReady()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (
        getStartError() ||
        viteProcess.exitCode !== null ||
        viteProcess.signalCode !== null
      ) {
        throw new Error('Owned Vite exited during the readiness check.');
      }
      return;
    }
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
    } catch {
      // The owned process may already have exited between the state check and cleanup.
    }
  }
}

async function main() {
  const extraArgs = process.argv.slice(2);
  let viteProcess = null;
  let viteStartError = null;
  let playwright = null;

  const cleanup = () => {
    if (playwright?.exitCode === null) {
      killProcessTree(playwright.pid);
    }
    if (viteProcess?.exitCode === null) {
      killProcessTree(viteProcess.pid);
    }
  };

  const handleSignal = (signal) => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  const handleSigint = () => handleSignal('SIGINT');
  const handleSigterm = () => handleSignal('SIGTERM');

  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);
  process.once('exit', cleanup);

  try {
    await assertPortIsFree();
    viteProcess = spawn(process.execPath, [
      path.join('node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      host,
      '--port',
      String(port),
      '--strictPort',
    ], {
      cwd: process.cwd(),
      env: e2eEnvironment,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: process.platform !== 'win32',
    });
    viteProcess.once('error', (error) => {
      viteStartError = error;
    });
    console.log(
      `[e2e] Started owned Vite pid ${viteProcess.pid}; ` +
      'existing server reuse is disabled.',
    );

    await waitForServer(viteProcess, () => viteStartError);

    playwright = spawn(process.execPath, [
      path.join('node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      ...extraArgs,
    ], {
      cwd: process.cwd(),
      env: e2eEnvironment,
      stdio: 'inherit',
    });

    return await new Promise((resolve) => {
      playwright.on('exit', (code) => resolve(code ?? 1));
      playwright.on('error', () => resolve(1));
    });
  } finally {
    cleanup();
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
    process.removeListener('exit', cleanup);
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
