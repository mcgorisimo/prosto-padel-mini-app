document.addEventListener('DOMContentLoaded', async () => {
  const body = document.body;
  const content = document.querySelector('[data-legal-document]');
  const status = document.querySelector('[data-legal-status]');
  if (!(content instanceof HTMLElement) || !(status instanceof HTMLElement)) {
    return;
  }

  const source = body.dataset.documentSource;
  if (!source?.startsWith('/legal/test-only/source/')) {
    status.textContent = 'Документ временно недоступен.';
    content.removeAttribute('aria-busy');
    return;
  }

  try {
    const response = await fetch(source, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('document_unavailable');
    content.textContent = await response.text();
    status.textContent =
      'Временный test-only текст. Реквизиты и финальная редакция будут опубликованы отдельной новой версией.';
  } catch {
    status.textContent = 'Документ временно недоступен.';
  } finally {
    content.removeAttribute('aria-busy');
  }
});
