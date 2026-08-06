const LEGACY_RUNTIME_REMOVED =
  'Legacy data runtime is unavailable; use the bearer-protected backend API';

function removedLegacyOperation() {
  throw new Error(LEGACY_RUNTIME_REMOVED);
}

// Temporary fail-closed boundary while the remaining unreachable legacy
// branches are deleted in small domain patches. This module intentionally has
// no database SDK, environment variables or network configuration.
export const supabase = {
  auth: {
    getSession: removedLegacyOperation,
    onAuthStateChange: removedLegacyOperation,
    signInWithPassword: removedLegacyOperation,
    signOut: removedLegacyOperation,
    signUp: removedLegacyOperation,
  },
  channel: removedLegacyOperation,
  from: removedLegacyOperation,
  removeChannel: removedLegacyOperation,
  rpc: removedLegacyOperation,
};
