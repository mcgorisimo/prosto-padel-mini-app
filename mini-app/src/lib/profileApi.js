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

const PLAYER_SEARCH_FIELDS = ['first_name', 'last_name', 'username'];

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
    .normalize('NFKC')
    .trim()
    .replace(/^@+/, '')
    .replace(/[,()%]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');
}

function buildCaseInsensitivePatterns(searchTerm) {
  if (!searchTerm) return [];

  const titleCase = searchTerm.charAt(0).toLocaleUpperCase('ru-RU') + searchTerm.slice(1);
  return [...new Set([
    searchTerm,
    titleCase,
    searchTerm.toLocaleUpperCase('ru-RU'),
  ])];
}

function getSearchRank(player, searchTerm) {
  const values = PLAYER_SEARCH_FIELDS
    .map((field) => sanitizeSearchTerm(player?.[field]))
    .filter(Boolean);

  if (values.some((value) => value === searchTerm)) return 0;
  if (values.some((value) => value.startsWith(searchTerm))) return 1;
  if (values.some((value) => value.includes(searchTerm))) return 2;
  return 3;
}

function dedupeAndRankPlayers(rows, searchTerm) {
  const uniqueRows = [...new Map(
    (rows ?? []).filter((row) => row?.id).map((row) => [String(row.id), row])
  ).values()];

  if (!searchTerm) return uniqueRows;

  return uniqueRows
    .map((row, index) => ({ row, index, rank: getSearchRank(row, searchTerm) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ row }) => row);
}

export async function getMyProfile() {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) throw error;
  return requireRow(data, 'Profile RPC returned no row');
}

export async function updateMyProfile(payload) {
  const { data, error } = await supabase.rpc('update_my_profile', normalizeRpcPayload(payload));
  if (error) throw error;
  return requireRow(data, 'Profile update RPC returned no row');
}

export async function getPublicPlayerProfiles({
  search,
  ids,
  excludeId,
  limit = 20,
  select = 'id, first_name, last_name, username, photo_url, rating, is_verified, side_preference',
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
    const patterns = buildCaseInsensitivePatterns(safeSearch);
    const filters = PLAYER_SEARCH_FIELDS.flatMap((field) =>
      patterns.map((pattern) => `${field}.ilike.%${pattern}%`)
    );
    query = query.or(filters.join(','));
  }

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return dedupeAndRankPlayers(data, safeSearch);
}

export async function adminListProfiles({
  search,
  filter = 'all',
} = {}) {
  const { data, error } = await supabase.rpc('admin_list_profiles', {
    p_search: String(search ?? '').trim() || null,
    p_filter: filter || 'all',
  });

  if (error) throw error;
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

  if (error) throw error;
  return requireRow(data, 'Admin profile security RPC returned no row');
}
