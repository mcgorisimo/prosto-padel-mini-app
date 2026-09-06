// Normalization is not permission to publish. This candidate stays internal
// until a reviewed YCLIENTS publication source and opaque ID mapping exist.
export type TrainingSessionCandidate = Readonly<{
  id: string;
  title: string;
  coachName: string;
  startsAt: string;
  durationSeconds: number;
  resourceNames: readonly string[];
}>;

// No loaded variant or enable switch until publication/access is proven.
export type TrainingScheduleResponse = Readonly<{
  outcome: 'not_configured';
  sessions: readonly [];
}>;
