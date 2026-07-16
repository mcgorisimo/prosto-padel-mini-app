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
