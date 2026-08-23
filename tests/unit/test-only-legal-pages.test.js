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

function read(relativePath) {
  return readFileSync(`${ROOT}/${relativePath}`, 'utf8');
}

describe('Selectel test-only legal pages', () => {
  it('packages only explicit immutable test versions with a visible non-production notice', () => {
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

  it('renders source as text without browser persistence, logging or script injection', () => {
    const viewer = read('infra/test/legal-pages/assets/legal-test.js');
    const styles = read('infra/test/legal-pages/assets/legal-test.css');
    const nginx = read('infra/test/frontend/nginx.conf');

    expect(viewer).toContain('content.textContent = await response.text()');
    expect(viewer).toContain("cache: 'no-store'");
    expect(viewer).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|console\./u,
    );
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('font-size: 16px');
    expect(styles).toContain('prefers-reduced-motion');
    expect(nginx).toContain('location ^~ /legal/test-only/');
    expect(nginx).toContain(
      'Cache-Control "no-store, no-cache, must-revalidate"',
    );
  });

  it('wires matching fail-closed backend and frontend values only into the test image', () => {
    const dockerfile = read('infra/test/frontend/Dockerfile');
    const compose = read('infra/test/compose.yaml');
    const example = read('infra/test/.env.test.example');

    expect(dockerfile).toContain('ARG VITE_ONBOARDING_LEGAL_TEST_ONLY=false');
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
      expect(dockerfile).toContain(document.version);
      expect(example).toContain(document.version);
    }
  });
});
