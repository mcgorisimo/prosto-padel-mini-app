import { useEffect, useRef, useState } from 'react';

export function canOrganizeReservation(reservation, now = Date.now()) {
  return reservation?.status === 'confirmed' && reservation.stale === false &&
    typeof reservation.reservationId === 'string' &&
    Date.parse(reservation.startsAt) > now;
}

// Shared action slot for owner booking details; training has no active entry yet.
export default function ReservationActions({ reservation, linkedMatch, onOpenMatch, onOrganizeMatch }) {
  const active = useRef(true);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const open = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try { await onOpenMatch(linkedMatch || reservation.linkedMatchId, () => active.current); }
    catch { if (active.current) setError('Не удалось открыть матч. Попробуйте ещё раз.'); }
    finally { pendingRef.current = false; if (active.current) setPending(false); }
  };
  if ((linkedMatch || reservation?.linkedMatchId) && onOpenMatch) {
    return <><button type="button" disabled={pending} className="mt-4 min-h-[48px] w-full rounded-2xl bg-accent-light/15 p-3 font-bold text-accent-light" onClick={open}>{pending ? 'Открываем матч…' : 'Открыть матч'}</button>{error && <p role="alert">{error}</p>}</>;
  }
  if (!onOrganizeMatch || !canOrganizeReservation(reservation)) return null;
  return <button type="button" data-testid="booking-organize-match" className="mt-4 min-h-[48px] w-full rounded-2xl bg-accent-light/15 p-3 font-bold text-accent-light" onClick={() => onOrganizeMatch(reservation)}>Организовать матч</button>;
}
