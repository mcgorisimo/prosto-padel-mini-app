export const CLUB = Object.freeze({
  name: 'Просто Падел',
  location: 'ТРЦ «Отрада»',
  address: 'Пятницкое ш., 1, стр. 1, этаж 1',
  website: 'prostopdl.ru',
});

export const COURT_TYPES = Object.freeze({
  PANORAMIC: 'panoramic',
});

export const COURTS = Object.freeze(
  Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Корт ${i + 1}`,
    type: COURT_TYPES.PANORAMIC,
    label: 'Ультрапанорамный корт',
    capacity: 4,
  }))
);

export const WORKING_HOURS = Object.freeze({
  startHour: 7,
  endHour: 24,
  slotStepMinutes: 30,
});

export const BOOKING_DURATIONS = Object.freeze([1, 1.5, 2, 2.5]);

export const PRICING = Object.freeze({
  weekday: [
    { from: '07:00', to: '17:00', rate: 3600, label: 'Дневное время' },
    { from: '17:00', to: '00:00', rate: 4400, label: 'Вечерний тариф' },
  ],
  weekend: [
    { from: '07:00', to: '10:00', rate: 3600, label: 'Утренний тариф' },
    { from: '10:00', to: '00:00', rate: 4800, label: 'Выходной тариф' },
  ],
});
