const SESSION_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function isCanonicalSessionCredential(value) {
  if (
    typeof value !== 'string' ||
    !SESSION_CREDENTIAL_PATTERN.test(value)
  ) {
    return false;
  }

  try {
    const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}=`;
    const decoded = globalThis.atob(padded);
    if (decoded.length !== 32) return false;

    let binary = '';
    for (let index = 0; index < decoded.length; index += 1) {
      binary += String.fromCharCode(decoded.charCodeAt(index));
    }
    const canonical = globalThis.btoa(binary)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    return canonical === value;
  } catch {
    return false;
  }
}
