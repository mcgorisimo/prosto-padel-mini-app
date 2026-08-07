import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Clock3, LockKeyhole, X } from 'lucide-react';
import { BOOKING_DURATIONS, COURTS, WORKING_HOURS, checkAvailability, fromMin } from '../lib/booking';
import { getMoscowDateRange, hasMoscowSlotStarted } from '../lib/moscowDateTime';
import { fmtPrice, getPerPlayerPrice, getTotalPrice } from '../lib/pricing';

const ANY_COURT = 'any';

const TIME_SECTIONS = [
  { id: 'morning', title: 'Утро', from: 7 * 60, to: 12 * 60 },
  { id: 'day', title: 'День', from: 12 * 60, to: 17 * 60 },
  { id: 'evening', title: 'Вечер', from: 17 * 60, to: 24 * 60 },
];

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function buildDates(days = 14) {
  return getMoscowDateRange(days).map((dateISO, index) => {
    const [, month, day] = dateISO.split('-').map(Number);

    return {
      dateISO,
      eyebrow: index === 0
        ? 'Сегодня'
        : index === 1
          ? 'Завтра'
          : WEEKDAYS_SHORT[new Date(`${dateISO}T12:00:00Z`).getUTCDay()],
      label: `${day} ${MONTHS_SHORT[month - 1]}`,
    };
  });
}

function buildTimes() {
  const out = [];
  const start = WORKING_HOURS.startHour * 60;
  const end = WORKING_HOURS.endHour * 60;

  for (let minute = start; minute < end; minute += WORKING_HOURS.slotStepMinutes) {
    out.push({ time: fromMin(minute), minute });
  }

  return out;
}

function isPastSlot(dateISO, time) {
  return hasMoscowSlotStarted(dateISO, time);
}

function formatDuration(duration) {
  return `${duration.toString().replace('.', ',')} ч`;
}

function getSlotLabel(state) {
  if (state === 'selected') return 'Выбрано';
  if (state === 'free') return 'Свободно';
  if (state === 'loading') return 'Загрузка';
  if (state === 'unknown') return 'Нет данных';
  if (state === 'outside') return 'Вне времени';
  if (state === 'past') return 'Прошло';
  return 'Занято';
}

function readRentalServiceDuration(title) {
  if (typeof title !== 'string') return null;
  const match = /^Аренда корта\s+(\d+(?:[.,]\d+)?)\s*ч\./iu.exec(title);
  if (!match) return null;
  const duration = Number(match[1].replace(',', '.'));
  return BOOKING_DURATIONS.includes(duration) ? duration : null;
}

function groupRentalServices(services) {
  const groups = new Map();
  for (const service of services) {
    const duration = readRentalServiceDuration(service?.title);
    if (duration === null) continue;
    const current = groups.get(duration) ?? [];
    current.push(service);
    groups.set(duration, current);
  }
  return BOOKING_DURATIONS.flatMap((duration) => {
    const matchingServices = groups.get(duration);
    return matchingServices
      ? [{ duration, services: matchingServices }]
      : [];
  });
}

function mergeCourts(results) {
  const courtsById = new Map();
  for (const result of results) {
    for (const court of result.courts) {
      if (!courtsById.has(court.id)) {
        courtsById.set(court.id, {
          ...court,
          type: COURTS[0]?.type ?? 'panoramic',
        });
      }
    }
  }
  return [...courtsById.values()].sort((left, right) => left.id - right.id);
}

function mergeDates(results) {
  return [...new Set(results.flatMap((result) => result.dates))].sort();
}

function nextAvailableDate(selectedDateISO, availableDates) {
  if (
    typeof selectedDateISO !== 'string' ||
    !Array.isArray(availableDates) ||
    availableDates.length === 0 ||
    availableDates.includes(selectedDateISO)
  ) {
    return selectedDateISO;
  }
  return availableDates.find((date) => date > selectedDateISO)
    ?? selectedDateISO;
}

function createRequestKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every((value) => value === 0)) return null;
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

function normalizeBookingClient(value) {
  const fullName = typeof value?.fullName === 'string'
    ? value.fullName.trim()
    : '';
  const phone = typeof value?.phone === 'string'
    ? value.phone.replace(/\D/gu, '')
    : '';
  const email = typeof value?.email === 'string'
    ? value.email.trim().toLowerCase()
    : '';
  if (
    fullName.length === 0 ||
    fullName.length > 256 ||
    !/^\d{10,15}$/u.test(phone) ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    return null;
  }
  return Object.freeze({ phone, fullName, email });
}

export default function BookingScreen({
  allMatches = [],
  availabilityActions = null,
  bookingClient = null,
  initialReservationId = null,
  onBookSlot,
  showToast,
}) {
  const dates = useMemo(() => buildDates(14), []);
  const times = useMemo(buildTimes, []);
  const usesBackendAvailability = availabilityActions !== null;
  const [bookingEmail, setBookingEmail] = useState('');
  const normalizedBookingClient = useMemo(
    () => normalizeBookingClient({ ...bookingClient, email: bookingEmail }),
    [bookingClient?.fullName, bookingClient?.phone, bookingEmail],
  );
  const [selectedDateISO, setSelectedDateISO] = useState(dates[0]?.dateISO);
  const [duration, setDuration] = useState(1.5);
  const [courtId, setCourtId] = useState(ANY_COURT);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [successText, setSuccessText] = useState('');
  const [latestReservation, setLatestReservation] = useState(null);
  const [isRefreshingReservation, setIsRefreshingReservation] = useState(false);
  const [servicesState, setServicesState] = useState({
    status: 'idle',
    groups: [],
  });
  const [courtsState, setCourtsState] = useState({
    status: 'idle',
    serviceKey: '',
    courts: [],
  });
  const [datesState, setDatesState] = useState({
    status: 'idle',
    queryKey: '',
    dates: [],
  });
  const [timesState, setTimesState] = useState({
    status: 'idle',
    queryKey: '',
    slots: [],
    partial: false,
  });

  useEffect(() => {
    const canReadExact =
      typeof initialReservationId === 'string' &&
      typeof availabilityActions?.readBooking === 'function';
    if (
      !canReadExact &&
      typeof availabilityActions?.listBookings !== 'function'
    ) return undefined;
    let active = true;
    void (async () => {
      if (canReadExact) {
        const refreshed = await availabilityActions.readBooking(initialReservationId);
        if (!active) return;
        setLatestReservation(
          refreshed?.outcome === 'booking_loaded'
            ? refreshed.reservation
            : null,
        );
        return;
      }
      const listed = await availabilityActions.listBookings();
      const latest = listed?.outcome === 'bookings_loaded'
        ? listed.reservations?.[0]
        : null;
      if (!active || !latest) return;
      const refreshed = typeof availabilityActions.readBooking === 'function'
        ? await availabilityActions.readBooking(latest.reservationId)
        : null;
      if (!active) return;
      setLatestReservation(
        refreshed?.outcome === 'booking_loaded'
          ? refreshed.reservation
          : latest,
      );
    })();
    return () => { active = false; };
  }, [availabilityActions, initialReservationId]);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!usesBackendAvailability) return undefined;
    let active = true;
    setServicesState({ status: 'loading', groups: [] });

    void availabilityActions.listServices().then((result) => {
      if (!active) return;
      if (result?.outcome !== 'services_loaded') {
        setServicesState({ status: 'error', groups: [] });
        return;
      }
      const groups = groupRentalServices(result.services);
      setServicesState({
        status: groups.length > 0 ? 'ready' : 'error',
        groups,
      });
    }).catch(() => {
      if (active) setServicesState({ status: 'error', groups: [] });
    });

    return () => {
      active = false;
    };
  }, [availabilityActions, usesBackendAvailability]);

  useEffect(() => {
    if (servicesState.status !== 'ready') return;
    if (servicesState.groups.some((group) => group.duration === duration)) {
      return;
    }
    setDuration(servicesState.groups[0].duration);
    setSelectedSlot(null);
  }, [duration, servicesState]);

  const selectedServiceIds = useMemo(() => (
    servicesState.groups
      .find((group) => group.duration === duration)
      ?.services.map((service) => service.id) ?? []
  ), [duration, servicesState.groups]);
  const selectedServiceKey = selectedServiceIds.join(',');

  useEffect(() => {
    if (!usesBackendAvailability || selectedServiceIds.length === 0) {
      return undefined;
    }
    let active = true;
    const serviceKey = selectedServiceKey;
    setCourtsState({ status: 'loading', serviceKey, courts: [] });

    void Promise.all(
      selectedServiceIds.map((serviceId) =>
        availabilityActions.listCourts(serviceId)),
    ).then((results) => {
      if (!active) return;
      if (results.some((result) => result?.outcome !== 'courts_loaded')) {
        setCourtsState({ status: 'error', serviceKey, courts: [] });
        return;
      }
      const courts = mergeCourts(results);
      setCourtsState({
        status: courts.length > 0 ? 'ready' : 'error',
        serviceKey,
        courts,
      });
      setCourtId((current) => (
        current !== ANY_COURT && courts.some((court) => court.id === current)
          ? current
          : courts[0]?.id ?? ANY_COURT
      ));
    }).catch(() => {
      if (active) {
        setCourtsState({ status: 'error', serviceKey, courts: [] });
      }
    });

    return () => {
      active = false;
    };
  }, [
    availabilityActions,
    selectedServiceIds,
    selectedServiceKey,
    usesBackendAvailability,
  ]);

  const backendCourts = courtsState.serviceKey === selectedServiceKey
    ? courtsState.courts
    : [];
  const queryCourtIds = useMemo(() => {
    if (courtId === ANY_COURT) {
      return backendCourts.map((court) => court.id);
    }
    return backendCourts.some((court) => court.id === courtId) ? [courtId] : [];
  }, [backendCourts, courtId]);
  const queryCourtKey = queryCourtIds.join(',');
  const datesQueryKey = `${selectedServiceKey}|${queryCourtKey}`;

  useEffect(() => {
    if (
      !usesBackendAvailability ||
      courtsState.status !== 'ready' ||
      selectedServiceIds.length === 0 ||
      queryCourtIds.length === 0 ||
      dates.length === 0
    ) {
      return undefined;
    }
    let active = true;
    const queryKey = datesQueryKey;
    setDatesState({ status: 'loading', queryKey, dates: [] });
    const requests = selectedServiceIds.flatMap((serviceId) =>
      queryCourtIds.map((selectedCourtId) =>
        availabilityActions.listDates({
          serviceId,
          courtId: selectedCourtId,
          dateFrom: dates[0].dateISO,
          dateTo: dates[dates.length - 1].dateISO,
        })),
    );

    void Promise.all(requests).then((results) => {
      if (!active) return;
      if (results.some((result) => result?.outcome !== 'dates_loaded')) {
        setDatesState({ status: 'error', queryKey, dates: [] });
        return;
      }
      setDatesState({ status: 'ready', queryKey, dates: mergeDates(results) });
    }).catch(() => {
      if (active) setDatesState({ status: 'error', queryKey, dates: [] });
    });

    return () => {
      active = false;
    };
  }, [
    availabilityActions,
    courtsState.status,
    dates,
    datesQueryKey,
    queryCourtIds,
    selectedServiceIds,
    usesBackendAvailability,
  ]);

  const backendDates = datesState.queryKey === datesQueryKey
    ? datesState.dates
    : [];
  const backendDateSet = useMemo(() => new Set(backendDates), [backendDates]);

  useEffect(() => {
    if (
      !usesBackendAvailability ||
      datesState.status !== 'ready' ||
      datesState.queryKey !== datesQueryKey
    ) {
      return;
    }
    const nextDate = nextAvailableDate(selectedDateISO, backendDates);
    if (nextDate === selectedDateISO) return;
    setSelectedDateISO(nextDate);
    setSelectedSlot(null);
  }, [
    backendDateSet,
    backendDates,
    datesQueryKey,
    datesState.queryKey,
    datesState.status,
    selectedDateISO,
    usesBackendAvailability,
  ]);

  const timesQueryKey = `${datesQueryKey}|${selectedDateISO}`;

  useEffect(() => {
    if (
      !usesBackendAvailability ||
      datesState.status !== 'ready' ||
      datesState.queryKey !== datesQueryKey ||
      selectedServiceIds.length === 0 ||
      queryCourtIds.length === 0
    ) {
      return undefined;
    }
    if (!backendDateSet.has(selectedDateISO)) {
      setTimesState((current) => (
        current.status === 'ready' &&
        current.queryKey === timesQueryKey &&
        current.slots.length === 0
          ? current
          : {
              status: 'ready',
              queryKey: timesQueryKey,
              slots: [],
              partial: false,
            }
      ));
      return undefined;
    }
    let active = true;
    const queryKey = timesQueryKey;
    setTimesState({ status: 'loading', queryKey, slots: [], partial: false });
    const requests = selectedServiceIds.flatMap((serviceId) =>
      queryCourtIds.map((selectedCourtId) => ({ serviceId, courtId: selectedCourtId })),
    );

    void Promise.all(requests.map(({ serviceId, courtId: selectedCourtId }) =>
      availabilityActions.listTimes({
        serviceId,
        courtId: selectedCourtId,
        date: selectedDateISO,
      }))).then((results) => {
      if (!active) return;
      const loadedResults = results.flatMap((result, index) => (
        result?.outcome === 'times_loaded'
          ? [{ request: requests[index], result }]
          : []
      ));
      if (loadedResults.length === 0) {
        setTimesState({ status: 'error', queryKey, slots: [], partial: false });
        return;
      }
      const courtById = new Map(backendCourts.map((court) => [court.id, court]));
      const slotsByTime = new Map();
      loadedResults.forEach(({ request, result }) => {
        for (const time of result.times) {
          if (!slotsByTime.has(time.time)) {
            slotsByTime.set(time.time, {
              ...time,
              serviceId: request.serviceId,
              court: courtById.get(request.courtId),
            });
          }
        }
      });
      const slots = [...slotsByTime.values()]
        .filter((slot) => slot.court)
        .sort((left, right) => left.time.localeCompare(right.time));
      setTimesState({
        status: 'ready',
        queryKey,
        slots,
        partial: loadedResults.length < results.length,
      });
    }).catch(() => {
      if (active) {
        setTimesState({ status: 'error', queryKey, slots: [], partial: false });
      }
    });

    return () => {
      active = false;
    };
  }, [
    availabilityActions,
    backendCourts,
    backendDateSet,
    datesQueryKey,
    datesState.queryKey,
    datesState.status,
    queryCourtIds,
    selectedDateISO,
    selectedServiceIds,
    timesQueryKey,
    usesBackendAvailability,
  ]);

  const backendTimeSlots = timesState.queryKey === timesQueryKey
    ? timesState.slots
    : [];
  const backendTimeByValue = useMemo(
    () => new Map(backendTimeSlots.map((slot) => [slot.time, slot])),
    [backendTimeSlots],
  );

  const selectedDate = dates.find((item) => item.dateISO === selectedDateISO) ?? dates[0];
  const displayedCourts = usesBackendAvailability ? backendCourts : COURTS;
  const selectedCourt = selectedSlot?.court ?? displayedCourts.find((court) => court.id === courtId);
  const getAvailableCourt = (time) => {
    if (usesBackendAvailability) {
      return backendTimeByValue.get(time)?.court ?? null;
    }
    const candidates = courtId === ANY_COURT
      ? COURTS
      : COURTS.filter((court) => court.id === courtId);

    return candidates.find((court) =>
      checkAvailability(allMatches, court.id, selectedDateISO, time, duration)
    );
  };

  const getSlotState = (time, minute) => {
    const endMinute = minute + duration * 60;
    const isSelected = selectedSlot?.time === time && selectedSlot?.dateISO === selectedDateISO;

    if (endMinute > WORKING_HOURS.endHour * 60) {
      return { state: isSelected ? 'outside' : 'outside', court: null };
    }

    if (isPastSlot(selectedDateISO, time)) {
      return { state: isSelected ? 'past' : 'past', court: null };
    }

    if (usesBackendAvailability && timesState.queryKey !== timesQueryKey) {
      return { state: 'loading', court: null };
    }
    if (usesBackendAvailability && timesState.status === 'loading') {
      return { state: 'loading', court: null };
    }
    if (usesBackendAvailability && timesState.status !== 'ready') {
      return { state: 'unknown', court: null };
    }

    const backendSlot = usesBackendAvailability
      ? backendTimeByValue.get(time)
      : null;
    const court = backendSlot?.court ?? getAvailableCourt(time);
    if (!court) {
      return { state: isSelected ? 'unavailable' : 'unavailable', court: null };
    }

    return {
      state: isSelected ? 'selected' : 'free',
      court,
      serviceId: backendSlot?.serviceId,
      datetime: backendSlot?.datetime,
    };
  };

  const sectionedSlots = TIME_SECTIONS.map((section) => ({
    ...section,
    slots: times.filter(({ minute }) => minute >= section.from && minute < section.to),
  }));
  const availabilityHasError = [
    servicesState.status,
    courtsState.status,
    datesState.status,
    timesState.status,
  ].includes('error');
  const availabilityStatusText = availabilityHasError
    ? 'Не удалось загрузить доступность. Попробуйте открыть экран ещё раз.'
    : datesState.status === 'ready' &&
        datesState.queryKey === datesQueryKey &&
        backendDates.length === 0
      ? 'Для выбранной длительности и корта нет доступных дат.'
    : timesState.status === 'ready' && timesState.queryKey === timesQueryKey
      ? timesState.partial
        ? 'Показаны доступные слоты. Часть вариантов услуги временно недоступна.'
        : 'Показаны актуальные свободные слоты клуба.'
      : 'Загружаем актуальные свободные слоты…';

  useEffect(() => {
    if (!selectedSlot) return;
    const minute = Number(selectedSlot.time.split(':')[0]) * 60 + Number(selectedSlot.time.split(':')[1]);
    const next = getSlotState(selectedSlot.time, minute);
    if (next.state !== 'selected') {
      setSelectedSlot(null);
    } else if (
      next.court?.id &&
      (
        next.court.id !== selectedSlot.court?.id ||
        next.serviceId !== selectedSlot.serviceId ||
        next.datetime !== selectedSlot.datetime
      )
    ) {
      setSelectedSlot((prev) => prev ? {
        ...prev,
        court: next.court,
        serviceId: next.serviceId,
        datetime: next.datetime,
      } : prev);
    }
  }, [
    allMatches,
    backendTimeSlots,
    courtId,
    duration,
    selectedDateISO,
    timesState.status,
  ]);

  useEffect(() => {
    document.body.classList.toggle('booking-sheet-open', Boolean(selectedSlot));

    return () => {
      document.body.classList.remove('booking-sheet-open');
    };
  }, [selectedSlot]);

  const totalPrice = selectedSlot
    ? getTotalPrice(selectedSlot.time, duration, selectedSlot.court.type, selectedDateISO)
    : 0;
  const perPlayerPrice = selectedSlot
    ? getPerPlayerPrice(selectedSlot.time, duration, selectedSlot.court.type, selectedDateISO)
    : 0;

  const handleSelectSlot = (time, minute) => {
    const slot = getSlotState(time, minute);
    if (slot.state !== 'free' && slot.state !== 'selected') return;

    setSuccessText('');
    setSelectedSlot({
      dateISO: selectedDateISO,
      time,
      court: slot.court,
      serviceId: slot.serviceId,
      datetime: slot.datetime,
    });
  };

  const handleCloseConfirm = () => {
    if (isSavingRef.current) return;
    setSelectedSlot(null);
  };

  const handleConfirm = async () => {
    if (!selectedSlot || isSavingRef.current) return;

    const isPublicFormat = false;

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      if (usesBackendAvailability) {
        const requestKey = createRequestKey();
        if (
          normalizedBookingClient === null ||
          requestKey === null ||
          !Number.isSafeInteger(selectedSlot.serviceId) ||
          !Number.isSafeInteger(selectedSlot.court?.id) ||
          typeof selectedSlot.datetime !== 'string' ||
          typeof availabilityActions.createBooking !== 'function'
        ) {
          showToast?.(
            'Проверьте имя и телефон в профиле и укажите email для бронирования.',
            'error',
          );
          return;
        }
        const result = await availabilityActions.createBooking({
          requestKey,
          serviceId: selectedSlot.serviceId,
          courtId: selectedSlot.court.id,
          datetime: selectedSlot.datetime,
          email: normalizedBookingClient.email,
        });
        if (result?.outcome === 'booking_created') {
          const message =
            'Бронь создана в YCLIENTS без онлайн-оплаты. Оплату подтвердит администратор клуба.';
          setSuccessText(message);
          setLatestReservation(result.reservation);
          showToast?.(message, 'success');
          setTimesState((current) => ({
            ...current,
            slots: current.slots.filter((slot) =>
              !(
                slot.time === selectedSlot.time &&
                slot.court?.id === selectedSlot.court.id
              )),
          }));
          setSelectedSlot(null);
          return;
        }
        if (result?.outcome === 'booking_unknown') {
          setLatestReservation(result.reservation);
          setSelectedSlot(null);
          showToast?.(
            'Статус брони уточняется. Не повторяйте создание — обновите бронь или свяжитесь с администратором клуба.',
            'error',
          );
          return;
        }
        if (result?.reason === 'not_bookable') {
          setSelectedSlot(null);
          showToast?.(
            'Этот слот уже недоступен. Выберите другое время.',
            'error',
          );
          return;
        }
        if (result?.reason === 'unknown_outcome') {
          if (typeof availabilityActions.readBookingByRequestKey === 'function') {
            const recovered = await availabilityActions.readBookingByRequestKey(requestKey);
            if (recovered?.outcome === 'booking_loaded') {
              setLatestReservation(recovered.reservation);
            }
          }
          setSelectedSlot(null);
          showToast?.(
            'Статус брони не определён. Не повторяйте запрос — обратитесь к администратору клуба.',
            'error',
          );
          return;
        }
        showToast?.(
          'Не удалось создать бронь. Проверьте доступность и попробуйте позже.',
          'error',
        );
        return;
      }

      await onBookSlot?.({
        court: selectedSlot.court,
        time: selectedSlot.time,
        dateISO: selectedDateISO,
        duration,
        type: 'private',
        isPrivate: true,
        scenario: 'private',
        paymentStatus: isPublicFormat ? 'partial' : 'full',
        isRatingMatch: false,
        is_rating_match: false,
        ratingMin: 0,
        ratingMax: 6,
        description: 'Частная бронь корта',
        total: totalPrice,
        pricePerPerson: perPlayerPrice,
      });

      const message = 'Бронь создана. Оплата сейчас подтверждается через администратора клуба.';
      setSuccessText(message);
      showToast?.(message, 'success');
      setSelectedSlot(null);
    } catch (error) {
      console.error(error);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleRefreshReservation = async () => {
    if (
      isRefreshingReservation ||
      typeof latestReservation?.reservationId !== 'string' ||
      typeof availabilityActions?.readBooking !== 'function'
    ) return;
    setIsRefreshingReservation(true);
    try {
      const result = await availabilityActions.readBooking(
        latestReservation.reservationId,
      );
      if (result?.outcome === 'booking_loaded') {
        setLatestReservation(result.reservation);
        return;
      }
      showToast?.('Не удалось обновить бронь. Попробуйте позже.', 'error');
    } finally {
      setIsRefreshingReservation(false);
    }
  };

  return (
    <div className="booking-screen min-h-screen bg-app-bg px-4 text-warm-white">
      <header className="booking-hero">
        <div className="booking-hero-icon flex items-center justify-center text-coral">
          <CalendarDays size={20} />
        </div>
        <h1 className="booking-title text-[30px] font-black leading-tight">Бронирование корта</h1>
        <p className="booking-subtitle text-sm leading-relaxed text-warm-white/58">
          Выберите удобное время, длительность и формат брони.
        </p>
      </header>

      {usesBackendAvailability && (
        <div
          data-testid="booking-availability-status"
          className="mb-4 rounded-2xl bg-warm-white/6 px-4 py-3 text-xs leading-relaxed text-warm-white/58"
        >
          {availabilityStatusText}
        </div>
      )}

      <section className="booking-section booking-section-dates">
        <div className="booking-section-label">
          Дата
        </div>
        <div className="booking-horizontal-scroll booking-date-strip" style={{ scrollbarWidth: 'none' }}>
          {dates.map((item) => {
            const active = item.dateISO === selectedDateISO;
            const disabled = usesBackendAvailability && (
              datesState.status !== 'ready' ||
              datesState.queryKey !== datesQueryKey ||
              !backendDateSet.has(item.dateISO)
            );
            return (
              <button
                key={item.dateISO}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setSelectedDateISO(item.dateISO);
                  setSelectedSlot(null);
                  setSuccessText('');
                }}
                className={[
                  'booking-date-card min-w-[86px] text-left',
                  active
                    ? 'is-active text-warm-white'
                    : disabled
                      ? 'text-warm-white/24'
                      : 'text-warm-white/70',
                ].join(' ')}
              >
                <div className="text-[11px] font-extrabold uppercase tracking-[0.08em]">{item.eyebrow}</div>
                <div className="mt-1 text-lg font-black">{item.label}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="booking-section booking-control-panel">
        <div className="booking-section-label">
          Длительность
        </div>
        <div className="booking-duration-control grid grid-cols-4">
          {BOOKING_DURATIONS.map((item) => {
            const active = duration === item;
            const disabled = usesBackendAvailability && (
              servicesState.status !== 'ready' ||
              !servicesState.groups.some((group) => group.duration === item)
            );
            return (
              <button
                key={item}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setDuration(item);
                  setSelectedSlot(null);
                  setSuccessText('');
                }}
                className={[
                  'booking-duration-option px-2 text-sm font-extrabold',
                  active
                    ? 'is-active text-app-bg'
                    : disabled
                      ? 'text-warm-white/22'
                      : 'text-warm-white/62',
                ].join(' ')}
              >
                {formatDuration(item)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="booking-section booking-control-panel">
        <div className="booking-section-label">
          Корт
        </div>
        <div className="booking-court-strip flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {[{ id: ANY_COURT, name: 'Любой свободный' }, ...displayedCourts].map((court) => {
            const active = courtId === court.id;
            const disabled = usesBackendAvailability && courtsState.status !== 'ready';
            return (
              <button
                key={court.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setCourtId(court.id);
                  setSelectedSlot(null);
                  setSuccessText('');
                }}
                className={[
                  'booking-court-chip shrink-0 px-4 text-sm font-bold',
                  active
                    ? 'is-active text-accent-light'
                    : disabled
                      ? 'text-warm-white/22'
                      : 'text-warm-white/64',
                ].join(' ')}
              >
                {court.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="booking-times">
        {sectionedSlots.map((section) => (
          <div key={section.id} className="booking-time-section">
            <div className="booking-time-heading flex items-center justify-between">
              <h2 className="text-base font-black">{section.title}</h2>
              <span className="text-[11px] text-warm-white/34">шаг 30 минут</span>
            </div>
            <div className="booking-time-grid grid grid-cols-3">
              {section.slots.map(({ time, minute }) => {
                const { state } = getSlotState(time, minute);
                const disabled = state !== 'free' && state !== 'selected';
                return (
                  <button
                    key={time}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectSlot(time, minute)}
                    className={[
                      'booking-time-slot min-h-[70px] px-3 text-left',
                      state === 'selected'
                        ? 'is-selected text-warm-white'
                        : state === 'free'
                          ? 'is-free text-warm-white'
                          : `is-disabled is-${state} text-warm-white/28`,
                    ].join(' ')}
                  >
                    <div className="booking-slot-time flex items-center gap-1.5 text-base font-black tabular-nums">
                      <Clock3 className="booking-slot-icon" size={13} />
                      {time}
                    </div>
                    <div className="booking-slot-status mt-1 text-[10px] font-semibold">{getSlotLabel(state)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {selectedSlot && (
        <div className="booking-sheet-overlay" role="presentation" onClick={handleCloseConfirm}>
          <div
            className="booking-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение брони"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="booking-sheet-header">
              <div className="booking-sheet-grabber" aria-hidden="true" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-warm-white/42">
                    Подтверждение
                  </div>
                  <h2 className="text-xl font-black">
                    {selectedDate?.eyebrow}, {selectedDate?.label}
                  </h2>
                  <p className="mt-1 text-sm text-warm-white/60">
                    {selectedSlot.time} · {formatDuration(duration)} · {selectedCourt?.name}
                  </p>
                </div>
                <button
                  type="button"
                  className="booking-sheet-close"
                  aria-label="Закрыть подтверждение"
                  disabled={isSaving}
                  onClick={handleCloseConfirm}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="booking-sheet-body">
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className="booking-price-tile p-3">
                  <div className="text-xs text-warm-white/46">Цена за корт</div>
                  <div data-testid="booking-total-price" className="mt-1 text-lg font-black">{fmtPrice(totalPrice)}</div>
                </div>
                <div className="booking-price-tile p-3">
                  <div className="text-xs text-warm-white/46">На игрока при 4</div>
                  <div data-testid="booking-per-player-price" className="mt-1 text-lg font-black">{fmtPrice(perPlayerPrice)}</div>
                </div>
              </div>

              <div className="booking-format-option is-active mb-4 flex items-start gap-3 p-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-light text-app-bg">
                  <LockKeyhole size={18} />
                </span>
                <span>
                  <span className="block text-sm font-black">Частная бронь</span>
                  <span className="mt-1 block text-xs leading-relaxed text-warm-white/52">
                    Только ваша бронь. В ленте матчей не показывается.
                  </span>
                </span>
              </div>

              <p className="text-xs leading-relaxed text-warm-white/52">
                {usesBackendAvailability
                  ? normalizedBookingClient
                    ? 'Бронь появится в YCLIENTS без онлайн-оплаты. Оплату подтвердит администратор клуба.'
                    : 'Для бронирования нужны имя и телефон в профиле, а также email в форме.'
                  : 'Бронь создаётся без онлайн-оплаты. Администратор клуба подтвердит оплату отдельно.'}
              </p>

              {usesBackendAvailability && (
                <label className="mt-4 block text-xs font-bold text-warm-white/72">
                  Email для этой брони
                  <input
                    data-testid="booking-contact-email"
                    type="email"
                    value={bookingEmail}
                    onChange={(event) => setBookingEmail(event.target.value)}
                    autoComplete="email"
                    maxLength={320}
                    placeholder="name@example.com"
                    className="mt-2 w-full rounded-xl border border-warm-white/12 bg-app-bg/70 px-3 py-3 text-sm text-warm-white outline-none"
                  />
                </label>
              )}
            </div>

            <div className="booking-sheet-footer">
              <button
                type="button"
                disabled={isSaving || (
                  usesBackendAvailability && normalizedBookingClient === null
                )}
                onClick={handleConfirm}
                className="booking-confirm-cta"
              >
                {isSaving
                  ? 'Создаём бронь...'
                  : usesBackendAvailability && normalizedBookingClient === null
                    ? 'Заполните контакты'
                    : 'Создать бронь'}
              </button>
            </div>
          </div>
        </div>
      )}

      {successText && (
        <div className="booking-success p-4 text-sm font-semibold leading-relaxed text-accent-light">
          {successText}
        </div>
      )}

      {latestReservation && (
        <section data-testid="booking-reservation-card" className="booking-success mt-3 p-4 text-sm leading-relaxed">
          <div className="font-black">Статус: {latestReservation.status}</div>
          <div className="mt-1 text-warm-white/68">
            {new Date(latestReservation.startsAt).toLocaleString('ru-RU')} · корт {latestReservation.courtId}
          </div>
          {latestReservation.stale && (
            <div className="mt-2 text-amber-200">Данные YCLIENTS временно не подтверждены.</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={handleRefreshReservation} disabled={isRefreshingReservation} className="rounded-xl bg-warm-white/10 px-3 py-2 font-bold">
              {isRefreshingReservation ? 'Обновляем…' : 'Обновить бронь'}
            </button>
            <div className="rounded-xl bg-warm-white/10 px-3 py-2 text-sm">
              Для отмены или переноса свяжитесь с администратором клуба. Прямая ссылка появится после подключения официального контакта клуба.
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
