import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  readAssignMatchLineupSlotRequest,
  readLineupMatchId,
  readReleaseMatchLineupSlotRequest,
} from './match-lineup.http';

const UUID = deterministicUuid('match-lineup-http');

describe('match lineup HTTP parsing', () => {
  it('accepts only the exact free-cell assignment contract', () => {
    expect(readAssignMatchLineupSlotRequest({
      requestKey: UUID,
      teamNumber: 2,
      courtSide: 'right',
    })).toEqual({ requestKey: UUID, teamNumber: 2, courtSide: 'right' });
    expect(readAssignMatchLineupSlotRequest({
      requestKey: UUID,
      teamNumber: 2,
      courtSide: 'right',
      accountId: UUID,
    })).toBeUndefined();
    expect(readAssignMatchLineupSlotRequest({
      requestKey: UUID,
      teamNumber: 3,
      courtSide: 'center',
    })).toBeUndefined();
  });

  it('accepts only requestKey for release and validates match ids', () => {
    expect(readReleaseMatchLineupSlotRequest({ requestKey: UUID })).toEqual({ requestKey: UUID });
    expect(readReleaseMatchLineupSlotRequest({ requestKey: UUID, playerId: UUID })).toBeUndefined();
    expect(readLineupMatchId(UUID)).toBe(UUID);
    expect(readLineupMatchId('not-a-uuid')).toBeUndefined();
  });
});
