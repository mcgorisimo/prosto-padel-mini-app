import { supabase } from './supabaseClient';
import { getPublicPlayerProfiles } from './profileApi';
import { normalizeStoredPrice } from './pricing';

function firstRow(data) {
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export function normalizeIncomingInvitation(row) {
  if (!row) return row;
  return {
    ...row,
    price_per_person: normalizeStoredPrice(row.price_per_person ?? row.pricePerPerson),
  };
}

export async function getIncomingMatchInvitations() {
  const { data, error } = await supabase.rpc('get_incoming_match_invitations');
  if (error) throw error;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map(normalizeIncomingInvitation);
}

export async function getOutgoingMatchInvitations(invitedBy) {
  if (!invitedBy) return [];

  const { data, error } = await supabase
    .from('match_invitations')
    .select('id, match_id, invited_by, invited_user_id, slot_index, status, created_at')
    .eq('invited_by', invitedBy)
    .eq('status', 'pending');

  if (error) throw error;

  const rows = data ?? [];
  const profileIds = [...new Set(rows.map((row) => row.invited_user_id).filter(Boolean))];
  const profiles = await getPublicPlayerProfiles({ ids: profileIds, limit: null });
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  return rows.map((row) => ({
    ...row,
    invitation_id: row.id,
    player: profilesById.get(row.invited_user_id) ?? null,
  }));
}

export async function createMatchInvitation({ matchId, invitedUserId, slotIndex }) {
  const { data, error } = await supabase.rpc('create_match_invitation', {
    p_match_id: matchId,
    p_invited_user_id: invitedUserId,
    p_slot_index: slotIndex,
  });
  if (error) throw error;
  const invitation = firstRow(data);
  if (!invitation?.id) throw new Error('create_match_invitation returned no invitation');
  return invitation;
}

export async function acceptMatchInvitation(invitationId) {
  const { data, error } = await supabase.rpc('accept_match_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw error;
  const match = firstRow(data);
  if (!match?.id) throw new Error('accept_match_invitation returned no match');
  return match;
}

export async function declineMatchInvitation(invitationId) {
  const { data, error } = await supabase.rpc('decline_match_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function cancelMatchInvitation(invitationId) {
  const { data, error } = await supabase.rpc('cancel_match_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function removeMatchParticipant(matchId, userId) {
  const { data, error } = await supabase.rpc('remove_match_participant', {
    p_match_id: matchId,
    p_user_id: userId,
  });
  if (error) throw error;
  const match = firstRow(data);
  if (!match?.id) throw new Error('remove_match_participant returned no match');
  return match;
}

export async function getNotificationCenter() {
  const [feedResult, countResult] = await Promise.all([
    supabase.rpc('get_my_notifications'),
    supabase.rpc('get_unread_notification_count'),
  ]);

  if (feedResult.error) throw feedResult.error;
  if (countResult.error) throw countResult.error;

  return {
    items: feedResult.data ?? [],
    unreadCount: Number(firstRow(countResult.data)) || 0,
  };
}

export async function markNotificationRead(notificationId) {
  const { data, error } = await supabase.rpc('mark_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
  return firstRow(data);
}

export function getInvitationErrorCode(error) {
  return [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}
