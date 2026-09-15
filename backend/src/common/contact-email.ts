// Same normalization as onboarding. This is declared contact data, not proof of ownership.
export function normalizeContactEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  const email = value.trim().toLowerCase();
  return email.length <= 320 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u.test(email)
    ? email
    : undefined;
}
