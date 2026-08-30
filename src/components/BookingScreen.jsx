import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Clock3, LockKeyhole, X } from 'lucide-react';
import PullToRefresh from './PullToRefresh';
import { WORKING_HOURS, fromMin } from '../lib/booking';
import { getBackendBookingStatusPresentation } from '../lib/backendBookingHomeAdapter';
import {
  groupRentalServices,
  mergeBookingCourts,
} from '../lib/bookingServiceCatalog';
import { YOOKASSA_COURT_CHECKOUT_ENABLED } from '../lib/paidCourtCheckout';
import { getMoscowDateRange, hasMoscowSlotStarted } from '../lib/moscowDateTime';
import {
  MIN_PRIVATE_BOOKING_SLOTS,
  PRIVATE_BOOKING_SLOT_MINUTES,
  findPrivateBookingRangeOption,
  formatPrivateBookingMinute,
  getPrivateBookingDuration,
  getPrivateBookingRangeEndMinute,
  isPrivateBookingTileCovered,
  updatePrivateBookingRange,
} from '../lib/privateBookingSlotSelection';
import { fmtPrice, getPerPlayerPrice, getTotalPrice } from '../lib/pricing';

const ANY_COURT = 'any';
const PAYMENT_PROVIDER_READY = YOOKASSA_COURT_CHECKOUT_ENABLED;
const MAX_BOOKING_SERVICE_VARIANTS = 16;
const MAX_BOOKING_QUERY_COURTS = 8;
const MAX_BOOKING_AVAILABILITY_REQUESTS = 64;
const TIME_SECTIONS = [
  { id: 'morning', title: 'Утро', from: 7 * 60, to: 12 * 60 },
  { id: 'day', title: 'День', from: 12 * 60, to: 17 * 60 },
  { id: 'evening', title: 'Вечер', from: 17 * 60, to: 24 * 60 },
];

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const CLUB_DATE_TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const CLUB_TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
});

function formatReservationDateTime(startsAt, endsAt) {
  return `${CLUB_DATE_TIME_FORMAT.format(new Date(startsAt))}–${CLUB_TIME_FORMAT.format(new Date(endsAt))}`;
}

function formatReservationDuration(startsAt, endsAt) {
  const hours = (Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? formatDuration(hours) : 'Уточняется';
}

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
  if (state === 'incompatible') return 'Не добавить';
  if (state === 'loading') return 'Загрузка';
  if (state === 'unknown') return 'Нет данных';
  if (state === 'outside') return 'Вне времени';
  if (state === 'past') return 'Прошло';
  if (state === 'occupied') return 'Занято';
  return 'Недоступно';
}

function getSelectionHint(reason, targetMinute, range = null) {
  if (reason === 'maximum') return 'Можно выбрать не больше 2 часов.';
  if (reason === 'gap') return 'Выбирайте только соседние слоты без разрывов.';
  if (reason === 'minimum' && targetMinute === 23 * 60 + 30) {
    return 'Начните не позднее 23:00: минимум бронирования — 1 час.';
  }
  if (reason === 'minimum') {
    return 'Этот интервал доступен только как продолжение соседнего диапазона.';
  }
  if (reason === 'unavailable' && range) {
    const rangeEndMinute = getPrivateBookingRangeEndMinute(range);
    const nextStartMinute = Math.min(range.startMinute, targetMinute);
    const nextEndMinute = Math.max(
      rangeEndMinute,
      targetMinute + PRIVATE_BOOKING_SLOT_MINUTES,
    );
    return [
      `${formatPrivateBookingMinute(targetMinute)} свободен отдельно,`,
      `но весь диапазон ${formatPrivateBookingMinute(nextStartMinute)}–${formatPrivateBookingMinute(nextEndMinute)}`,
      'недоступен на одном корте.',
    ].join(' ');
  }
  if (reason === 'unavailable') {
    return 'Выбранный диапазон оставлен без изменений: после этого действия нельзя оформить непрерывную бронь.';
  }
  return 'Этот диапазон недоступен целиком. Выберите соседний свободный слот.';
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
  if (
    fullName.length === 0 ||
    fullName.length > 256 ||
    !/^\d{10,15}$/u.test(phone)
  ) {
    return null;
  }
  return Object.freeze({ phone, fullName });
}

export default function BookingScreen({
  availabilityActions = null,
  bookingClient = null,
  initialReservationId = null,
  reservationPurpose = 'private',
  onConfirmedReservation = null,
  onBack = null,
  onCloseReservation = null,
  courtNamesById = {},
  onCourtCatalogChange = null,
  onOpenProfile = null,
  showToast,
}) {
  const dates = useMemo(() => buildDates(14), []);
  const times = useMemo(buildTimes, []);
  const usesBackendAvailability = availabilityActions !== null;
  const isReservationDetailsMode =
    typeof initialReservationId === 'string' && initialReservationId.length > 0;
  const isMatchCreation = reservationPurpose === 'match';
  const normalizedBookingClient = useMemo(
    () => normalizeBookingClient(bookingClient),
    [bookingClient],
  );
  const [selectedDateISO, setSelectedDateISO] = useState(dates[0]?.dateISO);
  const [courtId, setCourtId] = useState(ANY_COURT);
  const [selectedRange, setSelectedRange] = useState(null);
  const [selectionHint, setSelectionHint] = useState('');
  const [isBookingSheetOpen, setIsBookingSheetOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successText, setSuccessText] = useState('');
  const [latestReservation, setLatestReservation] = useState(null);
  const [completionStatus, setCompletionStatus] = useState('idle');
  const [pendingCompletionReservation, setPendingCompletionReservation] = useState(null);
  const [reservationReadStatus, setReservationReadStatus] = useState('idle');
  const bookingSheetCloseScrollRef = useRef(null);
  const reservationRefreshInFlightRef = useRef(false);
  const completionInFlightRef = useRef(false);
  const servicesRequestRef = useRef(0);
  const [servicesState, setServicesState] = useState({
    status: 'idle',
    groups: [],
  });
  const [courtsState, setCourtsState] = useState({
    status: 'idle',
    serviceKey: '',
    courts: [],
    pairs: [],
  });
  const [datesState, setDatesState] = useState({
    status: 'idle',
    queryKey: '',
    dates: [],
  });
  const datesRequestKeyRef = useRef('');
  const [timesState, setTimesState] = useState({
    status: 'idle',
    queryKey: '',
    slots: [],
    partial: false,
  });

  const alignBookingScreenAfterCreate = useCallback(() => {
    bookingSheetCloseScrollRef.current = 0;
  }, []);

  const completeConfirmedReservation = useCallback(async (reservation) => {
    if (!isMatchCreation) return true;
    if (
      completionInFlightRef.current ||
      reservation?.status !== 'confirmed' ||
      typeof reservation?.reservationId !== 'string' ||
      typeof onConfirmedReservation !== 'function'
    ) return false;
    completionInFlightRef.current = true;
    setCompletionStatus('linking');
    try {
      const result = await onConfirmedReservation(reservation);
      if (result?.outcome !== 'match_created') {
        setCompletionStatus('failed');
        setPendingCompletionReservation(reservation);
        showToast?.(
          'Корт подтверждён, но матч пока не создан. Повторите завершение — новая бронь не появится.',
          'error',
        );
        return false;
      }
      setCompletionStatus('completed');
      setPendingCompletionReservation(null);
      setSuccessText('Корт подтверждён, матч создан и связан с бронью.');
      return true;
    } catch {
      setCompletionStatus('failed');
      setPendingCompletionReservation(reservation);
      showToast?.(
        'Корт подтверждён, но матч пока не создан. Повторите завершение — новая бронь не появится.',
        'error',
      );
      return false;
    } finally {
      completionInFlightRef.current = false;
    }
  }, [isMatchCreation, onConfirmedReservation, showToast]);

  useEffect(() => {
    const canReadExact =
      typeof initialReservationId === 'string' &&
      typeof availabilityActions?.readBooking === 'function';
    if (!isReservationDetailsMode) {
      setLatestReservation(null);
      setReservationReadStatus('idle');
      return undefined;
    }
    if (!canReadExact) {
      setLatestReservation(null);
      setReservationReadStatus('error');
      return undefined;
    }
    let active = true;
    void (async () => {
      setLatestReservation(null);
      setReservationReadStatus('loading');
      try {
        const refreshed = await availabilityActions.readBooking(initialReservationId);
        if (!active) return;
        if (refreshed?.outcome === 'booking_loaded') {
          setLatestReservation(refreshed.reservation);
          setReservationReadStatus('ready');
        } else {
          setReservationReadStatus('error');
        }
      } catch {
        if (active) setReservationReadStatus('error');
      }
    })();
    return () => { active = false; };
  }, [availabilityActions, initialReservationId, isReservationDetailsMode]);
  const isSavingRef = useRef(false);

  const loadServices = useCallback(async () => {
    if (!usesBackendAvailability || isReservationDetailsMode) return;
    const requestId = servicesRequestRef.current + 1;
    servicesRequestRef.current = requestId;
    datesRequestKeyRef.current = '';
    setCourtsState({ status: 'idle', serviceKey: '', courts: [], pairs: [] });
    setDatesState({ status: 'idle', queryKey: '', dates: [] });
    setTimesState({ status: 'idle', queryKey: '', slots: [], partial: false });
    setServicesState({ status: 'loading', groups: [] });

    try {
      const result = await availabilityActions.listServices();
      if (servicesRequestRef.current !== requestId) return;
      if (result?.outcome !== 'services_loaded') {
        setServicesState({ status: 'error', groups: [] });
        return;
      }
      const groups = groupRentalServices(result.services);
      const serviceVariantCount = groups.reduce(
        (sum, group) => sum + group.services.length,
        0,
      );
      setServicesState({
        status:
          groups.length > 0 && serviceVariantCount <= MAX_BOOKING_SERVICE_VARIANTS
            ? 'ready'
            : 'error',
        groups: serviceVariantCount <= MAX_BOOKING_SERVICE_VARIANTS ? groups : [],
      });
    } catch {
      if (servicesRequestRef.current === requestId) {
        setServicesState({ status: 'error', groups: [] });
      }
    }
  }, [availabilityActions, isReservationDetailsMode, usesBackendAvailability]);

  useEffect(() => {
    void loadServices();
    return () => {
      servicesRequestRef.current += 1;
    };
  }, [loadServices]);

  const selectedServices = useMemo(() => (
    servicesState.groups.flatMap((group) =>
      group.services.map((service) => ({
        ...service,
        duration: group.duration,
      })))
  ), [servicesState.groups]);
  const selectedServiceIds = useMemo(
    () => selectedServices.map((service) => service.id),
    [selectedServices],
  );
  const selectedServiceKey = selectedServiceIds.join(',');

  useEffect(() => {
    if (
      !usesBackendAvailability ||
      isReservationDetailsMode ||
      selectedServiceIds.length === 0
    ) {
      return undefined;
    }
    let active = true;
    const serviceKey = selectedServiceKey;
    setCourtsState({ status: 'loading', serviceKey, courts: [], pairs: [] });

    void Promise.all(
      selectedServiceIds.map((serviceId) =>
        availabilityActions.listCourts(serviceId)),
    ).then((results) => {
      if (!active) return;
      if (results.some((result) => result?.outcome !== 'courts_loaded')) {
        setCourtsState({ status: 'error', serviceKey, courts: [], pairs: [] });
        return;
      }
      const courts = mergeBookingCourts(results);
      const pairs = results.flatMap((result, index) =>
        result.courts.map((court) => ({
          serviceId: selectedServiceIds[index],
          courtId: court.id,
        })),
      );
      onCourtCatalogChange?.(courts);
      setCourtsState({
        status: courts.length > 0 && pairs.length > 0 ? 'ready' : 'error',
        serviceKey,
        courts,
        pairs,
      });
      setCourtId((current) => {
        const fallbackCourtId = courts[0]?.id ?? ANY_COURT;
        return current !== ANY_COURT && courts.some((court) => court.id === current)
          ? current
          : fallbackCourtId;
      });
    }).catch(() => {
      if (active) {
        setCourtsState({ status: 'error', serviceKey, courts: [], pairs: [] });
      }
    });

    return () => {
      active = false;
    };
  }, [
    availabilityActions,
    isReservationDetailsMode,
    selectedServiceIds,
    selectedServiceKey,
    onCourtCatalogChange,
    usesBackendAvailability,
  ]);

  const backendCourts = useMemo(() => (
    courtsState.serviceKey === selectedServiceKey
      ? courtsState.courts
      : []
  ), [courtsState.courts, courtsState.serviceKey, selectedServiceKey]);
  const latestReservationCourtName =
    courtNamesById?.[latestReservation?.courtId] ??
    backendCourts.find((court) => court.id === latestReservation?.courtId)?.name ??
    'Корт';
  const queryCourtIds = useMemo(() => {
    if (courtId === ANY_COURT) {
      return backendCourts.map((court) => court.id);
    }
    return backendCourts.some((court) => court.id === courtId) ? [courtId] : [];
  }, [backendCourts, courtId]);
  const queryCourtKey = queryCourtIds.join(',');
  const serviceDurationById = useMemo(() => new Map(
    selectedServices.map((service) => [service.id, service.duration]),
  ), [selectedServices]);
  const queryServiceCourtPairs = useMemo(() => {
    if (courtsState.serviceKey !== selectedServiceKey) return [];
    const allowedCourtIds = new Set(queryCourtIds);
    return courtsState.pairs.flatMap((pair) => {
      const duration = serviceDurationById.get(pair.serviceId);
      return allowedCourtIds.has(pair.courtId) && duration
        ? [{ ...pair, duration }]
        : [];
    });
  }, [
    courtsState.pairs,
    courtsState.serviceKey,
    queryCourtIds,
    selectedServiceKey,
    serviceDurationById,
  ]);
  const datesQueryKey = `${selectedServiceKey}|${queryCourtKey}`;
  const initialTimesQueryKey = `${datesQueryKey}|${selectedDateISO}`;

  useEffect(() => {
    if (
      !usesBackendAvailability ||
      isReservationDetailsMode ||
      courtsState.status !== 'ready' ||
      queryServiceCourtPairs.length === 0 ||
      queryCourtIds.length === 0 ||
      dates.length === 0 ||
      timesState.status !== 'ready' ||
      timesState.queryKey !== initialTimesQueryKey
    ) {
      return undefined;
    }
    if (datesRequestKeyRef.current === datesQueryKey) {
      return undefined;
    }
    let active = true;
    let settled = false;
    const queryKey = datesQueryKey;
    datesRequestKeyRef.current = queryKey;
    if (
      queryCourtIds.length > MAX_BOOKING_QUERY_COURTS ||
      queryServiceCourtPairs.length > MAX_BOOKING_AVAILABILITY_REQUESTS
    ) {
      setDatesState({ status: 'error', queryKey, dates: [] });
      return undefined;
    }
    setDatesState({ status: 'loading', queryKey, dates: [] });
    const requests = queryServiceCourtPairs.map(({ serviceId, courtId: selectedCourtId }) =>
      availabilityActions.listDates({
        serviceId,
        courtId: selectedCourtId,
        dateFrom: dates[0].dateISO,
        dateTo: dates[dates.length - 1].dateISO,
      }));

    void Promise.all(requests).then((results) => {
      if (!active) return;
      settled = true;
      if (results.some((result) => result?.outcome !== 'dates_loaded')) {
        setDatesState({ status: 'error', queryKey, dates: [] });
        return;
      }
      setDatesState({ status: 'ready', queryKey, dates: mergeDates(results) });
    }).catch(() => {
      if (active) {
        settled = true;
        setDatesState({ status: 'error', queryKey, dates: [] });
      }
    });

    return () => {
      active = false;
      if (!settled && datesRequestKeyRef.current === queryKey) {
        datesRequestKeyRef.current = '';
      }
    };
  }, [
    availabilityActions,
    courtsState.status,
    dates,
    datesQueryKey,
    initialTimesQueryKey,
    isReservationDetailsMode,
    queryCourtIds,
    queryServiceCourtPairs,
    timesState.queryKey,
    timesState.status,
    usesBackendAvailability,
  ]);

  const backendDates = useMemo(() => (
    datesState.queryKey === datesQueryKey
      ? datesState.dates
      : []
  ), [datesQueryKey, datesState.dates, datesState.queryKey]);
  const backendDateSet = useMemo(() => new Set(backendDates), [backendDates]);
  const backendDateBlocksTimes = usesBackendAvailability &&
    datesState.queryKey === datesQueryKey &&
    (
      datesState.status === 'error' ||
      (
        datesState.status === 'ready' &&
        !backendDateSet.has(selectedDateISO)
      )
    );

  useEffect(() => {
    if (
      !usesBackendAvailability ||
      isReservationDetailsMode ||
      datesState.status !== 'ready' ||
      datesState.queryKey !== datesQueryKey
    ) {
      return;
    }
    const nextDate = nextAvailableDate(selectedDateISO, backendDates);
    if (nextDate === selectedDateISO) return;
    setSelectedDateISO(nextDate);
    setSelectedRange(null);
    setIsBookingSheetOpen(false);
  }, [
    backendDateSet,
    backendDates,
    datesQueryKey,
    datesState.queryKey,
    datesState.status,
    isReservationDetailsMode,
    selectedDateISO,
    usesBackendAvailability,
  ]);

  const timesQueryKey = `${datesQueryKey}|${selectedDateISO}`;

  useEffect(() => {
    if (
      !usesBackendAvailability ||
      isReservationDetailsMode ||
      queryServiceCourtPairs.length === 0 ||
      queryCourtIds.length === 0
    ) {
      return undefined;
    }
    let active = true;
    const queryKey = timesQueryKey;
    if (
      queryCourtIds.length > MAX_BOOKING_QUERY_COURTS ||
      queryServiceCourtPairs.length > MAX_BOOKING_AVAILABILITY_REQUESTS
    ) {
      setTimesState({ status: 'error', queryKey, slots: [], partial: false });
      return undefined;
    }
    setTimesState({ status: 'loading', queryKey, slots: [], partial: false });
    const requests = queryServiceCourtPairs;

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
      if (loadedResults.length !== results.length) {
        setTimesState({ status: 'error', queryKey, slots: [], partial: false });
        return;
      }
      const courtById = new Map(backendCourts.map((court) => [court.id, court]));
      const slots = [];
      let hasDurationMismatch = false;
      loadedResults.forEach(({ request, result }) => {
        for (const time of result.times) {
          if (time.durationSeconds === request.duration * 3_600) {
            const [hour, minute] = time.time.split(':').map(Number);
            slots.push({
              ...time,
              startMinute: hour * 60 + minute,
              durationSlots: request.duration * 2,
              serviceId: request.serviceId,
              duration: request.duration,
              court: courtById.get(request.courtId),
            });
          } else {
            hasDurationMismatch = true;
          }
        }
      });
      if (hasDurationMismatch) {
        setTimesState({ status: 'error', queryKey, slots: [], partial: false });
        return;
      }
      const validSlots = slots
        .filter((slot) => slot.court)
        .sort((left, right) => (
          left.time.localeCompare(right.time) ||
          left.duration - right.duration ||
          left.court.id - right.court.id
        ));
      setTimesState({
        status: 'ready',
        queryKey,
        slots: validSlots,
        partial: false,
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
    isReservationDetailsMode,
    queryCourtIds,
    queryServiceCourtPairs,
    selectedDateISO,
    timesQueryKey,
    usesBackendAvailability,
  ]);

  const backendTimeSlots = useMemo(() => (
    !backendDateBlocksTimes && timesState.queryKey === timesQueryKey
      ? timesState.slots
      : []
  ), [
    backendDateBlocksTimes,
    timesQueryKey,
    timesState.queryKey,
    timesState.slots,
  ]);

  const selectedDate = dates.find((item) => item.dateISO === selectedDateISO) ?? dates[0];
  const displayedCourts = backendCourts;
  const availabilityOptions = backendTimeSlots;
  const selectedOption = selectedRange?.slotCount >= MIN_PRIVATE_BOOKING_SLOTS
    ? findPrivateBookingRangeOption(availabilityOptions, selectedRange, {
        exact: true,
        preferredCourtId: selectedRange.courtId,
      })
    : null;
  const selectedCourt = selectedOption?.court ?? displayedCourts.find(
    (court) => court.id === selectedRange?.courtId,
  );

  const getSlotState = (time, minute) => {
    const selectedEndMinute = getPrivateBookingRangeEndMinute(selectedRange);
    const isSelected = selectedRange !== null &&
      minute >= selectedRange.startMinute &&
      minute < selectedEndMinute;

    if (minute + PRIVATE_BOOKING_SLOT_MINUTES > WORKING_HOURS.endHour * 60) {
      return { state: 'outside' };
    }

    if (isPastSlot(selectedDateISO, time)) {
      return { state: 'past' };
    }

    if (backendDateBlocksTimes) {
      return {
        state: datesState.status === 'error' ? 'unknown' : 'unavailable',
      };
    }

    if (usesBackendAvailability && timesState.queryKey !== timesQueryKey) {
      return { state: 'loading' };
    }
    if (usesBackendAvailability && timesState.status === 'loading') {
      return { state: 'loading' };
    }
    if (usesBackendAvailability && timesState.status !== 'ready') {
      return { state: 'unknown' };
    }

    if (isSelected) return { state: 'selected' };
    const isCovered = isPrivateBookingTileCovered(availabilityOptions, minute);
    if (isCovered && selectedRange) {
      const continuation = updatePrivateBookingRange({
        range: selectedRange,
        targetMinute: minute,
        options: availabilityOptions,
      });
      if (
        continuation.outcome === 'rejected' &&
        continuation.reason === 'unavailable'
      ) {
        return { state: 'incompatible' };
      }
    }
    return { state: isCovered ? 'free' : 'unavailable' };
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
      ? 'Для выбранного корта нет доступных дат.'
    : timesState.status === 'ready' && timesState.queryKey === timesQueryKey
      ? 'Показаны актуальные свободные слоты клуба.'
      : 'Загружаем актуальные свободные слоты…';

  useEffect(() => {
    if (!selectedRange || (usesBackendAvailability && timesState.status !== 'ready')) return;
    const option = findPrivateBookingRangeOption(availabilityOptions, selectedRange, {
      preferredCourtId: selectedRange.courtId,
    });
    if (!option) {
      setSelectedRange(null);
      setIsBookingSheetOpen(false);
      return;
    }
    if (option.court.id !== selectedRange.courtId) {
      setSelectedRange((current) => current ? {
        ...current,
        courtId: option.court.id,
      } : current);
    }
  }, [
    availabilityOptions,
    backendTimeSlots,
    courtId,
    selectedDateISO,
    selectedRange,
    timesState.status,
    usesBackendAvailability,
  ]);

  useEffect(() => {
    if (!isBookingSheetOpen) return undefined;

    const scrollTop = Math.max(
      0,
      Number(window.scrollY) || 0,
      Number(document.documentElement.scrollTop) || 0,
      Number(document.body.scrollTop) || 0,
    );
    bookingSheetCloseScrollRef.current = null;
    document.documentElement.classList.add('booking-sheet-open');
    document.body.classList.add('booking-sheet-open');
    document.body.style.setProperty(
      '--booking-sheet-scroll-offset',
      `${-scrollTop}px`,
    );

    return () => {
      document.documentElement.classList.remove('booking-sheet-open');
      document.body.classList.remove('booking-sheet-open');
      document.body.style.removeProperty('--booking-sheet-scroll-offset');
      const targetScroll = bookingSheetCloseScrollRef.current ?? scrollTop;
      bookingSheetCloseScrollRef.current = null;
      window.scrollTo({ top: targetScroll, left: 0, behavior: 'auto' });
    };
  }, [isBookingSheetOpen]);

  const duration = getPrivateBookingDuration(selectedRange);
  const selectedStartTime = selectedRange
    ? formatPrivateBookingMinute(selectedRange.startMinute)
    : '';
  const selectedEndTime = selectedRange
    ? formatPrivateBookingMinute(getPrivateBookingRangeEndMinute(selectedRange))
    : '';
  const totalPrice = selectedOption
    ? getTotalPrice(selectedStartTime, duration, selectedOption.court.type, selectedDateISO)
    : 0;
  const perPlayerPrice = selectedOption
    ? getPerPlayerPrice(selectedStartTime, duration, selectedOption.court.type, selectedDateISO)
    : 0;

  const handleSelectSlot = (time, minute) => {
    const slot = getSlotState(time, minute);
    if (
      slot.state !== 'free' &&
      slot.state !== 'selected' &&
      slot.state !== 'incompatible'
    ) return;

    setSuccessText('');
    const result = updatePrivateBookingRange({
      range: selectedRange,
      targetMinute: minute,
      options: availabilityOptions,
    });
    if (result.outcome === 'rejected') {
      const hint = getSelectionHint(
        result.reason,
        minute,
        slot.state === 'incompatible' ? selectedRange : null,
      );
      setSelectionHint(hint);
      showToast?.(hint, 'info');
      return;
    }
    setSelectionHint(
      result.range?.slotCount === 1
        ? 'Выберите ещё один соседний слот: минимум бронирования — 1 час.'
        : '',
    );
    setSelectedRange(result.range);
    setIsBookingSheetOpen(false);
  };

  const handleCloseConfirm = () => {
    if (isSavingRef.current) return;
    setIsBookingSheetOpen(false);
  };

  const handleConfirm = async () => {
    if (!PAYMENT_PROVIDER_READY) {
      showToast?.('Онлайн-оплата пока не подключена. Бронь не создана.', 'info');
      return;
    }
    if (!selectedOption || !selectedRange || isSavingRef.current) return;

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      if (!usesBackendAvailability) {
        showToast?.('Сервис бронирования временно недоступен.', 'error');
        return;
      }
      const requestKey = createRequestKey();
        if (
          normalizedBookingClient === null ||
          requestKey === null ||
          !Number.isSafeInteger(selectedOption.serviceId) ||
          !Number.isSafeInteger(selectedOption.court?.id) ||
          typeof selectedOption.datetime !== 'string' ||
          typeof availabilityActions.createBooking !== 'function'
        ) {
          showToast?.(
            'Заполните имя и телефон в профиле перед бронированием.',
            'error',
          );
          return;
        }
        const result = await availabilityActions.createBooking({
          requestKey,
          serviceId: selectedOption.serviceId,
          courtId: selectedOption.court.id,
          datetime: selectedOption.datetime,
        });
        if (result?.outcome === 'booking_created') {
          setSuccessText(
            isMatchCreation
              ? 'Корт подтверждён. Завершаем создание матча…'
              : 'Бронь создана в YCLIENTS без онлайн-оплаты. Оплату подтвердит администратор клуба.',
          );
          setTimesState((current) => ({
            ...current,
            slots: current.slots.filter((slot) =>
              !(
                slot.time === selectedStartTime &&
                slot.court?.id === selectedOption.court.id
              )),
          }));
          setSelectedRange(null);
          setIsBookingSheetOpen(false);
          alignBookingScreenAfterCreate();
          await completeConfirmedReservation(result.reservation);
          return;
        }
        if (result?.outcome === 'booking_unknown') {
          setSelectedRange(null);
          setIsBookingSheetOpen(false);
          showToast?.(
            'Статус брони уточняется. Не повторяйте создание — обновите бронь или свяжитесь с администратором клуба.',
            'error',
          );
          return;
        }
        if (result?.reason === 'not_bookable') {
          setSelectedRange(null);
          setIsBookingSheetOpen(false);
          showToast?.(
            'Этот слот уже недоступен. Выберите другое время.',
            'error',
          );
          return;
        }
        if (result?.reason === 'unknown_outcome') {
          if (typeof availabilityActions.readBookingByRequestKey === 'function') {
            const recovered = await availabilityActions.readBookingByRequestKey(requestKey);
            if (
              recovered?.outcome === 'booking_loaded' &&
              recovered.reservation?.status === 'confirmed'
            ) {
              const completed = await completeConfirmedReservation(
                recovered.reservation,
              );
              if (completed) {
                setSelectedRange(null);
                setIsBookingSheetOpen(false);
                setSuccessText(
                  isMatchCreation
                    ? 'Корт подтверждён, матч создан и связан с бронью.'
                    : 'Бронь восстановлена и подтверждена.',
                );
                return;
              }
            }
          }
          setSelectedRange(null);
          setIsBookingSheetOpen(false);
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
    } catch (error) {
      console.error(error);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleRefreshReservation = useCallback(async () => {
    const reservationId = typeof latestReservation?.reservationId === 'string'
      ? latestReservation.reservationId
      : isReservationDetailsMode && typeof initialReservationId === 'string'
        ? initialReservationId
        : null;
    if (
      reservationRefreshInFlightRef.current ||
      reservationId === null ||
      typeof availabilityActions?.readBooking !== 'function'
    ) return;
    reservationRefreshInFlightRef.current = true;
    try {
      const result = await availabilityActions.readBooking(
        reservationId,
      );
      if (result?.outcome === 'booking_loaded') {
        setLatestReservation(result.reservation);
        if (result.reservation.status === 'cancelled') setSuccessText('');
        setReservationReadStatus('ready');
        return;
      }
      if (isReservationDetailsMode) setReservationReadStatus('error');
      showToast?.('Не удалось обновить бронь. Попробуйте позже.', 'error');
    } finally {
      reservationRefreshInFlightRef.current = false;
    }
  }, [
    availabilityActions,
    initialReservationId,
    isReservationDetailsMode,
    latestReservation?.reservationId,
    showToast,
  ]);

  const handleBookingPullRefresh = useCallback(async () => {
    const refreshes = [];
    if (!isReservationDetailsMode) refreshes.push(loadServices());
    if (
      typeof latestReservation?.reservationId === 'string' ||
      (isReservationDetailsMode && typeof initialReservationId === 'string')
    ) {
      refreshes.push(handleRefreshReservation());
    }
    await Promise.allSettled(refreshes);
  }, [
    handleRefreshReservation,
    initialReservationId,
    isReservationDetailsMode,
    latestReservation?.reservationId,
    loadServices,
  ]);

  if (isReservationDetailsMode) {
    const statusPresentation = latestReservation
      ? getBackendBookingStatusPresentation(latestReservation.status)
      : null;

    return (
      <PullToRefresh
        onRefresh={handleBookingPullRefresh}
        testId="pull-to-refresh-booking-details"
      >
      <div
        data-testid="booking-reservation-details"
        className="booking-screen min-h-screen bg-app-bg px-4 text-warm-white"
      >
        <header className="booking-hero">
          {typeof onCloseReservation === 'function' && (
            <button
              type="button"
              onClick={onCloseReservation}
              className="mb-5 text-sm font-bold text-warm-white/64"
            >
              ← Назад к моим броням
            </button>
          )}
          <div className="booking-hero-icon flex items-center justify-center text-coral">
            <CalendarDays size={20} />
          </div>
          <h1 className="booking-title text-[30px] font-black leading-tight">
            Детали брони
          </h1>
          <p className="booking-subtitle text-sm leading-relaxed text-warm-white/58">
            Актуальные данные брони из YCLIENTS.
          </p>
        </header>

        {['idle', 'loading'].includes(reservationReadStatus) && (
          <div
            data-testid="booking-reservation-loading"
            className="booking-success p-4 text-sm font-semibold"
            aria-live="polite"
          >
            Обновляем данные брони…
          </div>
        )}

        {reservationReadStatus === 'error' && (
          <div
            data-testid="booking-reservation-error"
            className="rounded-2xl border border-coral/25 bg-coral/10 p-4 text-sm leading-relaxed text-warm-white/76"
          >
            Не удалось открыть бронь. Вернитесь в «Мои брони» и попробуйте ещё раз.
          </div>
        )}

        {latestReservation && statusPresentation && (
          <section className="booking-success p-4 text-sm leading-relaxed">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-warm-white/42">
              Статус брони
            </div>
            <div
              data-testid="booking-reservation-status"
              className="mt-2 text-xl font-black text-accent-light"
            >
              {statusPresentation.label}
            </div>

            <div className="mt-5 rounded-2xl border border-warm-white/8 bg-app-bg/35 p-4">
              <div className="text-xs font-bold text-warm-white/46">Дата и время</div>
              <div className="mt-1 text-base font-black">
                {formatReservationDateTime(
                  latestReservation.startsAt,
                  latestReservation.endsAt,
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-bold text-warm-white/46">Корт</div>
                  <div className="mt-1 font-black">{latestReservationCourtName}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-warm-white/46">Длительность</div>
                  <div className="mt-1 font-black">
                    {formatReservationDuration(
                      latestReservation.startsAt,
                      latestReservation.endsAt,
                    )}
                  </div>
                </div>
              </div>
            </div>

            {latestReservation.stale && (
              <div className="mt-3 rounded-xl bg-amber-300/10 px-3 py-3 text-amber-200">
                Актуальность данных YCLIENTS временно не подтверждена. Слот остаётся удержанным.
              </div>
            )}

            <div className="mt-3 rounded-xl bg-warm-white/10 px-3 py-3 text-sm">
              Для отмены или переноса обратитесь к администратору клуба. Прямая ссылка появится после подключения официального контакта клуба.
            </div>
          </section>
        )}
      </div>
      </PullToRefresh>
    );
  }

  return (
    <PullToRefresh
      onRefresh={handleBookingPullRefresh}
      testId="pull-to-refresh-booking"
    >
    <div className="booking-screen min-h-screen bg-app-bg px-4 text-warm-white">
      <header className="booking-hero">
        {typeof onBack === 'function' && (
          <button
            type="button"
            aria-label="Назад к параметрам матча"
            onClick={onBack}
            className="mb-4 min-h-11 min-w-11 rounded-xl border border-warm-white/10 bg-warm-white/5 px-3 text-left text-xl text-warm-white/64"
          >
            ←
          </button>
        )}
        <div className="booking-hero-icon flex items-center justify-center text-coral">
          <CalendarDays size={20} />
        </div>
        <h1 className="booking-title text-[30px] font-black leading-tight">
          {isMatchCreation ? 'Корт для матча' : 'Бронирование корта'}
        </h1>
        <p className="booking-subtitle text-sm leading-relaxed text-warm-white/58">
          Выберите соседние свободные интервалы от 1 до 2 часов.
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

      {successText && (
        <div
          data-testid="booking-success-message"
          role="status"
          className="booking-success mb-4 p-4 text-sm font-semibold leading-relaxed text-accent-light"
        >
          {successText}
        </div>
      )}

      {completionStatus === 'linking' && (
        <div className="booking-success mb-4 p-4 text-sm font-semibold">
          Создаём матч и атомарно связываем подтверждённую бронь…
        </div>
      )}

      {completionStatus === 'failed' && pendingCompletionReservation && (
        <div className="mb-4 rounded-2xl border border-coral/30 bg-coral/10 p-4 text-sm leading-relaxed">
          <p>Бронь уже подтверждена. Повторите только создание и привязку матча.</p>
          <button
            type="button"
            data-testid="match-finalize-retry"
            disabled={isSaving}
            onClick={() => completeConfirmedReservation(pendingCompletionReservation)}
            className="mt-3 min-h-11 w-full rounded-xl border border-warm-white/14 bg-warm-white/8 px-3 font-black text-warm-white"
          >
            Завершить создание матча
          </button>
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
                  setSelectedRange(null);
                  setSelectionHint('');
                  setIsBookingSheetOpen(false);
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
                  setSelectedRange(null);
                  setSelectionHint('');
                  setIsBookingSheetOpen(false);
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

      {selectionHint && (
        <p
          data-testid="booking-selection-hint"
          className="mb-5 rounded-xl bg-warm-white/6 px-3 py-3 text-xs leading-relaxed text-warm-white/64"
          role="status"
        >
          {selectionHint}
        </p>
      )}

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
                const disabled = ![
                  'free',
                  'selected',
                  'incompatible',
                ].includes(state);
                const intervalEnd = formatPrivateBookingMinute(
                  minute + PRIVATE_BOOKING_SLOT_MINUTES,
                );
                return (
                  <button
                    key={time}
                    type="button"
                    disabled={disabled}
                    aria-label={`${time}–${intervalEnd} ${getSlotLabel(state)}`}
                    onClick={() => handleSelectSlot(time, minute)}
                    className={[
                      'booking-time-slot min-h-[70px] px-3 text-left',
                      state === 'selected'
                        ? 'is-selected text-warm-white'
                        : state === 'free'
                          ? 'is-free text-warm-white'
                          : state === 'incompatible'
                            ? 'is-incompatible text-warm-white'
                            : `is-disabled is-${state} text-warm-white/28`,
                    ].join(' ')}
                  >
                    <div className="booking-slot-time flex items-center gap-1.5 text-base font-black tabular-nums">
                      <Clock3 className="booking-slot-icon" size={13} />
                      {time}
                    </div>
                    <div className="booking-slot-status mt-1 text-[10px] font-semibold">
                      до {intervalEnd} · {getSlotLabel(state)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {selectedRange && (
        <section
          data-testid="booking-selection-summary"
          className="booking-selection-summary mb-5"
          aria-live="polite"
        >
          <div>
            <div className="booking-selection-label text-[10px] font-extrabold uppercase tracking-[0.16em]">
              Выбранный интервал
            </div>
            <div className="mt-1 text-lg font-black tabular-nums">
              {selectedStartTime}–{selectedEndTime}
            </div>
            <div className="booking-selection-meta mt-1 text-xs">
              {formatDuration(duration)} · {selectedOption ? fmtPrice(totalPrice) : 'добавьте соседний слот'}
            </div>
          </div>
          <button
            type="button"
            className="booking-selection-continue"
            disabled={!selectedOption}
            onClick={() => setIsBookingSheetOpen(true)}
          >
            Продолжить
          </button>
        </section>
      )}

      {selectedOption && isBookingSheetOpen && createPortal(
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
                    {isMatchCreation ? 'Корт для матча' : 'Подтверждение'}
                  </div>
                  <h2 className="text-xl font-black">
                    {selectedDate?.eyebrow}, {selectedDate?.label}
                  </h2>
                  <p className="mt-1 text-sm text-warm-white/60">
                    {selectedStartTime}–{selectedEndTime} · {formatDuration(duration)} · {selectedCourt?.name}
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
                  <span className="block text-sm font-black">
                    {isMatchCreation ? 'Бронь корта для матча' : 'Частная бронь'}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-warm-white/52">
                    {isMatchCreation
                      ? 'Матч будет создан только после подтверждения и привязки этой брони.'
                      : 'Только ваша бронь. В ленте матчей не показывается.'}
                  </span>
                </span>
              </div>

              <p className="text-xs leading-relaxed text-warm-white/52">
                {normalizedBookingClient
                  ? 'Контакты будут взяты из вашего профиля. Онлайн-оплата пока не подключена, поэтому бронь не будет создана на этом шаге.'
                  : 'Заполните имя и телефон в профиле, затем вернитесь к бронированию.'}
              </p>

              {normalizedBookingClient === null && typeof onOpenProfile === 'function' && (
                <button
                  type="button"
                  className="mt-4 min-h-11 w-full rounded-xl border border-warm-white/12 bg-warm-white/6 px-3 text-sm font-black text-warm-white"
                  onClick={() => {
                    setIsBookingSheetOpen(false);
                    onOpenProfile();
                  }}
                >
                  Перейти в профиль
                </button>
              )}
            </div>

            <div className="booking-sheet-footer">
              <button
                type="button"
                disabled={
                  isSaving ||
                  normalizedBookingClient === null ||
                  !PAYMENT_PROVIDER_READY
                }
                onClick={handleConfirm}
                className="booking-confirm-cta"
              >
                {isSaving
                  ? 'Переходим к оплате...'
                  : `${isMatchCreation ? 'Оплатить и создать матч' : 'Оплатить'} ${fmtPrice(totalPrice)}`}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

    </div>
    </PullToRefresh>
  );
}
