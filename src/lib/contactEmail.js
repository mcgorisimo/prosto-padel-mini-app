export function normalizeContactEmail(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u.test(email)
    ? email
    : null;
}
