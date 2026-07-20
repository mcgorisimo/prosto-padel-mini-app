import { supabase } from './supabaseClient';

function firstRow(data) {
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

function scalarNumber(data) {
  const value = firstRow(data);
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const firstValue = Object.values(value)[0];
    return Number(firstValue) || 0;
  }
  return Number(value) || 0;
}

function waitlistRows(data) {
  if (Array.isArray(data)) return data;
  return data && typeof data === 'object' ? [data] : [];
}

function nullableText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeMatchWaitlist(data) {
  const normalized = waitlistRows(data)
    .map((row) => {
      const queuePosition = row?.queue_position == null || row.queue_position === ''
        ? null
        : Number(row.queue_position);
      const rating = row?.rating == null || row.rating === ''
        ? null
        : Number(row.rating);
      return {
        waitlist_id: nullableText(row?.waitlist_id),
        user_id: nullableText(row?.user_id),
        queue_position: Number.isInteger(queuePosition) && queuePosition > 0
          ? queuePosition
          : null,
        first_name: nullableText(row?.first_name),
        last_name: nullableText(row?.last_name),
        photo_url: nullableText(row?.photo_url),
        rating: rating !== null && Number.isFinite(rating) ? rating : null,
        joined_at: nullableText(row?.joined_at),
        is_current_user: row?.is_current_user === true,
      };
    })
    .filter((row) => row.waitlist_id && row.user_id && row.queue_position !== null)
    .sort((left, right) => {
      if (left.queue_position !== right.queue_position) {
        return left.queue_position - right.queue_position;
      }
      const joinedAtOrder = String(left.joined_at ?? '').localeCompare(String(right.joined_at ?? ''));
      return joinedAtOrder || left.waitlist_id.localeCompare(right.waitlist_id);
    });

  const seenWaitlistIds = new Set();
  const seenUserIds = new Set();
  return normalized.filter((row) => {
    if (seenWaitlistIds.has(row.waitlist_id) || seenUserIds.has(row.user_id)) return false;
    seenWaitlistIds.add(row.waitlist_id);
    seenUserIds.add(row.user_id);
    return true;
  });
}

export async function joinMatchWaitlist(matchId) {
  const { data, error } = await supabase.rpc('join_match_waitlist', {
    p_match_id: matchId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function leaveMatchWaitlist(matchId) {
  const { data, error } = await supabase.rpc('leave_match_waitlist', {
    p_match_id: matchId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function getMyMatchWaitlistPosition(matchId) {
  const { data, error } = await supabase.rpc('get_my_match_waitlist_position', {
    p_match_id: matchId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function getMatchWaitlistCount(matchId) {
  const { data, error } = await supabase.rpc('get_match_waitlist_count', {
    p_match_id: matchId,
  });
  if (error) throw error;
  return scalarNumber(data);
}

export async function getMatchWaitlist(matchId) {
  const { data, error } = await supabase.rpc('get_match_waitlist', {
    p_match_id: matchId,
  });
  if (error) throw error;
  return normalizeMatchWaitlist(data);
}

export async function getMatchWaitlistState(matchId) {
  const [position, count] = await Promise.all([
    getMyMatchWaitlistPosition(matchId),
    getMatchWaitlistCount(matchId),
  ]);
  return { position, count };
}

export function getWaitlistErrorCode(error) {
  return [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}
