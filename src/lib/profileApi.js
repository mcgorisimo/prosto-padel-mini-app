import { supabase } from './supabaseClient';

const PROFILE_RPC_FIELDS = {
  first_name: 'p_first_name',
  last_name: 'p_last_name',
  phone: 'p_phone',
  username: 'p_username',
  photo_url: 'p_photo_url',
  side_preference: 'p_side_preference',
  birthday: 'p_birthday',
  gender: 'p_gender',
  language: 'p_language',
};

function firstRow(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

function requireRow(data, message) {
  const row = firstRow(data);
  if (!row?.id) throw new Error(message);
  return row;
}

function normalizeRpcPayload(payload = {}) {
  return Object.fromEntries(
    Object.entries(PROFILE_RPC_FIELDS).map(([sourceKey, rpcKey]) => [
      rpcKey,
      payload[sourceKey] ?? null,
    ])
  );
}

function sanitizeSearchTerm(value) {
  return String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[,()%]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function logSupabaseError(context, error, extra = {}) {
  if (!error) return;

  console.error('[Supabase diagnostic]', {
    context,
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    ...extra,
  });
}

export async function getMyProfile() {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) {
    logSupabaseError('get_my_profile', error);
    throw error;
  }
  return requireRow(data, 'Profile RPC returned no row');
}

export async function updateMyProfile(payload) {
  const { data, error } = await supabase.rpc('update_my_profile', normalizeRpcPayload(payload));
  if (error) {
    logSupabaseError('update_my_profile', error);
    throw error;
  }
  return requireRow(data, 'Profile update RPC returned no row');
}

export async function getPublicPlayerProfiles({
  search,
  ids,
  excludeId,
  limit = 20,
  select = 'id, first_name, last_name, username, photo_url, rating, is_verified, side_preference',
  diagnosticContext = 'player_public_profiles.search',
} = {}) {
  if (Array.isArray(ids) && ids.length === 0) return [];

  let query = supabase
    .from('player_public_profiles')
    .select(select);

  if (Array.isArray(ids)) {
    query = query.in('id', ids);
  }

  const safeSearch = sanitizeSearchTerm(search);
  if (safeSearch) {
    query = query.or(`first_name.ilike.%${safeSearch}%,last_name.ilike.%${safeSearch}%,username.ilike.%${safeSearch}%`);
  }

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    logSupabaseError(diagnosticContext, error, {
      hasSearch: Boolean(safeSearch),
      hasIds: Array.isArray(ids),
      excludeSelf: Boolean(excludeId),
      limit,
      select,
    });
    throw error;
  }
  return data ?? [];
}

export async function adminListProfiles({
  search,
  filter = 'all',
} = {}) {
  const { data, error } = await supabase.rpc('admin_list_profiles', {
    p_search: String(search ?? '').trim() || null,
    p_filter: filter || 'all',
  });

  if (error) {
    logSupabaseError('admin_list_profiles', error, {
      hasSearch: Boolean(String(search ?? '').trim()),
      filter: filter || 'all',
    });
    throw error;
  }
  return data ?? [];
}

export async function adminUpdateProfileSecurity({
  profileId,
  role,
  rating,
  isVerified,
}) {
  const { data, error } = await supabase.rpc('admin_update_profile_security', {
    p_profile_id: profileId,
    p_role: role ?? null,
    p_rating: rating ?? null,
    p_is_verified: isVerified ?? null,
  });

  if (error) {
    logSupabaseError('admin_update_profile_security', error, {
      hasProfileId: Boolean(profileId),
    });
    throw error;
  }
  return requireRow(data, 'Admin profile security RPC returned no row');
}
