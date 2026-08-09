import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const PULL_THRESHOLD = 64;
const MAX_PULL_DISTANCE = 104;
const PULL_DAMPING = 0.5;
const MIN_INDICATOR_TIME_MS = 320;

function pageScrollTop() {
  return Math.max(
    0,
    Number(globalThis.scrollY) || 0,
    Number(document.documentElement?.scrollTop) || 0,
    Number(document.body?.scrollTop) || 0,
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export default function PullToRefresh({
  children,
  disabled = false,
  onRefresh = null,
  testId = 'pull-to-refresh',
}) {
  const rootRef = useRef(null);
  const mountedRef = useRef(true);
  const trackingRef = useRef(null);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  onRefreshRef.current = onRefresh;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || disabled || typeof onRefreshRef.current !== 'function') {
      return undefined;
    }

    const resetTracking = () => {
      trackingRef.current = null;
    };

    const updateDistance = (nextDistance) => {
      distanceRef.current = nextDistance;
      setDistance(nextDistance);
    };

    const handleTouchStart = (event) => {
      if (
        refreshingRef.current ||
        event.touches.length !== 1 ||
        pageScrollTop() > 0
      ) {
        resetTracking();
        return;
      }

      const touch = event.touches[0];
      trackingRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
      };
    };

    const handleTouchMove = (event) => {
      const tracking = trackingRef.current;
      if (!tracking || refreshingRef.current) {
        return;
      }
      if (event.touches.length !== 1) {
        resetTracking();
        updateDistance(0);
        return;
      }
      if (pageScrollTop() > 0) {
        resetTracking();
        updateDistance(0);
        return;
      }

      const touch = event.touches[0];
      const deltaX = touch.clientX - tracking.startX;
      const deltaY = touch.clientY - tracking.startY;
      if (deltaY <= 0 || Math.abs(deltaX) > deltaY) {
        resetTracking();
        updateDistance(0);
        return;
      }

      if (event.cancelable) event.preventDefault();
      updateDistance(Math.min(MAX_PULL_DISTANCE, deltaY * PULL_DAMPING));
    };

    const finishGesture = (event) => {
      if (event.touches.length > 0) {
        resetTracking();
        updateDistance(0);
        return;
      }
      const shouldRefresh =
        distanceRef.current >= PULL_THRESHOLD &&
        !refreshingRef.current;
      resetTracking();

      if (!shouldRefresh) {
        updateDistance(0);
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      updateDistance(PULL_THRESHOLD);

      void Promise.allSettled([
        Promise.resolve().then(() => onRefreshRef.current?.()),
        wait(MIN_INDICATOR_TIME_MS),
      ]).finally(() => {
        if (!mountedRef.current) return;
        refreshingRef.current = false;
        setRefreshing(false);
        updateDistance(0);
      });
    };

    const cancelGesture = () => {
      resetTracking();
      if (!refreshingRef.current) updateDistance(0);
    };

    root.addEventListener('touchstart', handleTouchStart, { passive: true });
    root.addEventListener('touchmove', handleTouchMove, { passive: false });
    root.addEventListener('touchend', finishGesture, { passive: true });
    root.addEventListener('touchcancel', cancelGesture, { passive: true });

    return () => {
      root.removeEventListener('touchstart', handleTouchStart);
      root.removeEventListener('touchmove', handleTouchMove);
      root.removeEventListener('touchend', finishGesture);
      root.removeEventListener('touchcancel', cancelGesture);
      resetTracking();
      if (!refreshingRef.current) {
        distanceRef.current = 0;
      }
    };
  }, [disabled]);

  const ready = distance >= PULL_THRESHOLD;
  const label = refreshing
    ? 'Обновляем…'
    : ready
      ? 'Отпустите для обновления'
      : 'Потяните вниз для обновления';

  return (
    <div
      ref={rootRef}
      className="pull-to-refresh"
      data-testid={testId}
      data-refreshing={refreshing ? 'true' : 'false'}
      style={{ '--pull-distance': `${distance}px` }}
    >
      <div
        className="pull-to-refresh__indicator"
        data-testid={`${testId}-indicator`}
        aria-hidden={distance === 0 && !refreshing}
        aria-live="polite"
      >
        <RefreshCw
          size={18}
          strokeWidth={2.2}
          className={refreshing ? 'animate-spin' : ''}
          style={refreshing ? undefined : { transform: `rotate(${Math.min(180, distance * 2.5)}deg)` }}
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
      <div className="pull-to-refresh__content">{children}</div>
    </div>
  );
}
