export type TrainingScheduleSession = Readonly<{
  id: string;
  title: string;
  startsAt: string;
  durationSeconds: number;
  courtName?: string;
  coachName?: string;
  capacity: number;
  occupied: number;
  remaining: number;
}>;

// Kept for the pure legacy activity-row parser; it remains unwired and does
// not grant publication permission or expose capacity.
export type TrainingSessionCandidate = Readonly<{
  id: string;
  title: string;
  coachName: string;
  startsAt: string;
  durationSeconds: number;
  resourceNames: readonly string[];
}>;

export type TrainingScheduleResponse =
  | Readonly<{
      outcome: 'loaded';
      sessions: readonly TrainingScheduleSession[];
      lastUpdatedAt: string;
    }>
  | Readonly<{
      outcome: 'empty';
      sessions: readonly [];
      lastUpdatedAt: string;
    }>
  | Readonly<{ outcome: 'not_configured'; sessions: readonly [] }>
  | Readonly<{ outcome: 'unavailable'; sessions: readonly [] }>
  | Readonly<{
      outcome: 'stale';
      sessions: readonly [];
      lastUpdatedAt: string;
    }>
  | Readonly<{ outcome: 'error'; sessions: readonly [] }>;
