const { test, expect } = require('@playwright/test');
const OWNER = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
for (const viewport of [
  { width: 375, height: 667 },
  { width: 667, height: 375 },
]) {
  test(`manual CRM preview, attestation and safe retry ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('https://telegram.org/js/telegram-web-app.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
      }),
    );
    const calls = [];
    let confirms = 0;
    await page.route('**/api/v1/admin/players/*/crm-binding/*', (route) => {
      calls.push({
        url: route.request().url(),
        body: route.request().postDataJSON(),
        method: route.request().method(),
      });
      const isPreview = route.request().url().endsWith('/preview');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify(
          isPreview
            ? {
                outcome: 'preview',
                draftId: DRAFT,
                name: 'Тестовый Игрок',
                phoneHint: '•••• 2233',
                expiresAt: Math.floor(Date.now() / 1000) + 300,
              }
            : { outcome: ++confirms === 1 ? 'unknown' : 'linked' },
        ),
      });
    });
    await page.goto('/');
    await page.evaluate(
      async ({ owner }) => {
        const React = (await import('/@id/react')).default;
        const reactDom = await import('/@id/react-dom/client');
        const { createRoot } = reactDom.default ?? reactDom;
        const { default: Details } =
          await import('/src/components/AdminPlayerDetails.jsx');
        const { manualCrmBindingClient } =
          await import('/src/lib/manualCrmBindingClient.js');
        document.body.innerHTML = '<div id="manual-crm-root"></div>';
        createRoot(document.getElementById('manual-crm-root')).render(
          React.createElement(Details, {
            user: { isAdmin: true },
            player: {
              id: owner,
              first_name: 'Тестовый',
              last_name: 'Игрок',
              username: 'test_player',
              rating: 3,
            },
            adminActions: {
              previewManualCrmBinding: (id, clientId) =>
                manualCrmBindingClient.preview('A'.repeat(43), id, clientId),
              confirmManualCrmBinding: (id, draftId) =>
                manualCrmBindingClient.confirm('A'.repeat(43), id, draftId),
            },
          }),
        );
      },
      { owner: OWNER },
    );
    await page.getByLabel('Email или ID клиента YCLIENTS').fill(viewport.width === 375 ? ' Owner@Example.Test ' : '5');
    await page.getByRole('button', { name: 'Проверить карточку' }).click();
    const confirm = page.getByRole('button', { name: 'Подтвердить связь' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Я лично проверил:', { exact: false }).check();
    await expect(confirm).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('manual-crm-preview.png'),
      fullPage: true,
    });
    await confirm.click();
    await expect(page.getByRole('status')).toContainText(
      'Результат пока неизвестен',
    );
    await confirm.click();
    await expect(page.getByRole('status')).toContainText(
      'Аккаунт игрока связан',
    );
    expect(calls).toHaveLength(3);
    expect(calls[0].body).toEqual(viewport.width === 375 ? { email: 'owner@example.test' } : { clientId: 5 });
    expect(calls[1].body).toEqual({ draftId: DRAFT, identityChecked: true });
    expect(calls[2].body).toEqual(calls[1].body);
    expect(
      calls.every((call) => call.method === 'POST' && !call.url.includes('?')),
    ).toBe(true);
  });
}
