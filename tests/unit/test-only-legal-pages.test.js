import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TEST_ONLY_DOCUMENTS = Object.freeze([
  Object.freeze({
    kind: 'terms',
    version: 'terms-test-2026-08-23-v1',
    source: 'TERMS_DRAFT.md',
    sourceHeading: '# Условия использования сервиса',
  }),
  Object.freeze({
    kind: 'privacy',
    version: 'privacy-test-2026-08-23-v1',
    source: 'PRIVACY_POLICY_DRAFT.md',
    sourceHeading: '# Политика в отношении обработки персональных данных',
  }),
  Object.freeze({
    kind: 'cancellation',
    version: 'cancellation-test-2026-08-23-v1',
    source: 'CANCELLATION_POLICY_DRAFT.md',
    sourceHeading: '# Правила отмены, переноса и возврата денежных средств',
  }),
]);
const PUBLISHED_DOCUMENTS = Object.freeze([
  ['terms', 'TERMS', 'TERMS', 'terms-2026-08-26-v1'],
  [
    'cancellation',
    'CANCELLATION',
    'CANCELLATION',
    'cancellation-2026-08-26-v1',
  ],
  ['privacy', 'PRIVACY', 'PRIVACY', 'privacy-2026-08-26-v1'],
  [
    'personal-data-consent',
    'PERSONAL_DATA_CONSENT',
    'PERSONAL_DATA_PROCESSING',
    'personal-data-consent-2026-08-26-v1',
  ],
]);

function read(relativePath) {
  return readFileSync(`${ROOT}/${relativePath}`, 'utf8');
}

function envValue(source, key) {
  return source.match(new RegExp(`^${key}=(.*)$`, 'mu'))?.[1] ?? null;
}

describe('Selectel legal publication pages', () => {
  it('packages four placeholder-free immutable public pages without auth or scripts', () => {
    for (const [route, , , version] of PUBLISHED_DOCUMENTS) {
      const html = read(`infra/test/legal-pages/${version}/index.html`);
      expect(html).toContain(`data-document-version="${version}"`);
      expect(html).toContain('26.08.2026');
      expect(html).toContain('7716262810');
      expect(html).not.toMatch(/\{\{[A-Z0-9_]+\}\}|DRAFT|НЕ ОПУБЛИКОВАНО/u);
      expect(html).not.toMatch(/<script|Authorization|Telegram\.WebApp/u);
      expect(read('infra/test/frontend/Dockerfile')).toContain(
        `legal-pages/${version} dist/legal/${route}/${version}`,
      );
    }
    const nginx = read('infra/test/frontend/nginx.conf');
    expect(nginx).toContain('location ^~ /legal/');
    expect(nginx).toContain('try_files $uri $uri/ =404');
  });

  it('keeps legacy test versions as repository-only evidence fixtures', () => {
    for (const document of TEST_ONLY_DOCUMENTS) {
      const html = read(
        `infra/test/legal-pages/${document.version}/index.html`,
      );
      const source = read(`docs/legal/${document.source}`);

      expect(html).toContain(document.version);
      expect(html).toContain(
        `data-document-source="/legal/test-only/source/${document.source}"`,
      );
      expect(html).toContain('Только Selectel test');
      expect(html.replace(/\s+/gu, ' ')).toContain('не production-публикация');
      expect(html).toContain('noindex, nofollow, noarchive');
      expect(source).toContain(document.sourceHeading);
      expect(source).toContain('DRAFT — НЕ ОПУБЛИКОВАНО');
    }
  });

  it('keeps the legacy renderer inert and excludes it from the runtime image', () => {
    const viewer = read('infra/test/legal-pages/assets/legal-test.js');
    const styles = read('infra/test/legal-pages/assets/legal-test.css');
    const nginx = read('infra/test/frontend/nginx.conf');
    const dockerfile = read('infra/test/frontend/Dockerfile');

    expect(viewer).toContain('content.textContent = await response.text()');
    expect(viewer).toContain("cache: 'no-store'");
    expect(viewer).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|console\./u,
    );
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('font-size: 16px');
    expect(styles).toContain('prefers-reduced-motion');
    expect(nginx).not.toContain('location ^~ /legal/test-only/');
    expect(dockerfile).not.toContain('dist/legal/test-only');
    expect(dockerfile).not.toContain('./legal-source/');
  });

  it('wires matching fail-closed backend and frontend values only into the test image', () => {
    const dockerfile = read('infra/test/frontend/Dockerfile');
    const compose = read('infra/test/compose.yaml');
    const example = read('infra/test/.env.test.example');

    expect(dockerfile).toContain('ARG VITE_ONBOARDING_LEGAL_TEST_ONLY=false');
    expect(dockerfile).toContain(
      'Legacy test-only legal pages are archived and cannot be used for onboarding',
    );
    expect(dockerfile).toContain('COPY infra/test/legal-pages ./legal-pages');
    expect(compose).toContain(
      'PLAYER_ONBOARDING_LEGAL_POLICY_ENABLED: ${PLAYER_ONBOARDING_LEGAL_POLICY_ENABLED:-false}',
    );
    expect(compose).toContain(
      'VITE_ONBOARDING_LEGAL_TEST_ONLY: ${VITE_ONBOARDING_LEGAL_TEST_ONLY:-false}',
    );
    expect(example).toContain('PLAYER_ONBOARDING_LEGAL_POLICY_ENABLED=false');
    expect(example).toContain('VITE_ONBOARDING_LEGAL_TEST_ONLY=false');
    for (const document of TEST_ONLY_DOCUMENTS) {
      expect(dockerfile).not.toContain(document.version);
    }
    for (const [
      route,
      frontendKey,
      backendKey,
      version,
    ] of PUBLISHED_DOCUMENTS) {
      expect(dockerfile).toContain(version);
      expect(envValue(example, `VITE_ONBOARDING_${frontendKey}_VERSION`)).toBe(
        version,
      );
      expect(envValue(example, `PLAYER_ONBOARDING_${backendKey}_VERSION`)).toBe(
        version,
      );
      expect(envValue(example, `VITE_ONBOARDING_${frontendKey}_URL`)).toBe(
        `https://test-app.prostopdl.ru/legal/${route}/${version}/`,
      );
      expect(compose).toContain(`PLAYER_ONBOARDING_${backendKey}_VERSION:`);
      expect(compose).toContain(`VITE_ONBOARDING_${frontendKey}_VERSION:`);
    }
  });
});
