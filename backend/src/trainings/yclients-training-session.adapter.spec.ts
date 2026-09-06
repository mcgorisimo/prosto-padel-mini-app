import { normalizeYclientsTrainingSession } from './yclients-training-session.adapter';

const ID = '11111111-1111-4111-8111-111111111111';
const row = () => ({ id: 19, company_id: 7, service_id: 8, staff_id: 9,
  service: { id: 8, title: 'Групповое занятие' }, staff: { id: 9, name: 'Тренер' },
  date: 1_900_000_000, length: 3600, resource_instances: [{ title: 'Корт 1' }],
});

describe('Unwired YCLIENTS training candidate normalization', () => {
  it('projects only allowlisted display fields, never provider/contact/price/capacity fields', () => {
    const source = { ...row(), client: { phone: 'SYNTHETIC_PRIVATE_MARKER' }, records: [{ client_id: 44 }],
      comment: 'SYNTHETIC_PRIVATE_MARKER', stream_link: 'SYNTHETIC_PRIVATE_MARKER', capacity: 6, records_count: 2,
      service: { ...row().service, price_min: 999 },
    };
    const result = normalizeYclientsTrainingSession(source, 7, ID);
    expect(result).toEqual({ id: ID, title: 'Групповое занятие', coachName: 'Тренер',
      startsAt: new Date(1_900_000_000_000).toISOString(), durationSeconds: 3600, resourceNames: ['Корт 1'],
    });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_MARKER');
  });

  it.each([
    { company_id: 70 }, { staff: null }, { staff: { id: 10, name: 'Другой' } },
    { service: { id: 80, title: 'Чужая услуга' } }, { date: '2030-01-01 12:00:00' },
    { date: Number.MAX_SAFE_INTEGER }, { date: 0 }, { length: 0 }, { length: 86401 },
    { staff: { id: 9, name: '' } }, { resource_instances: [{ title: '\u0000' }] },
  ])('rejects inconsistent/unknown provider data without guessing (%j)', (patch) => {
    expect(normalizeYclientsTrainingSession({ ...row(), ...patch }, 7, ID)).toBeNull();
  });

  it('needs an opaque ID and never invents an unknown resource', () => {
    expect(normalizeYclientsTrainingSession(row(), 7, '19')).toBeNull();
    expect(normalizeYclientsTrainingSession({ ...row(), resource_instances: [] }, 7, ID)?.resourceNames).toEqual([]);
  });
});
