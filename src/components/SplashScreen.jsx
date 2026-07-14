import React, { useCallback, useEffect, useRef } from 'react';
import padelBall from '../assets/padel-ball.png';
import prostoPadelLogo from '../assets/prosto-padel-logo.png';
import './SplashScreen.css';

const FALLBACK_TIMEOUT_MS = 3200;

export default function SplashScreen({ onComplete }) {
  const completedRef = useRef(false);

  const complete = useCallback(() => {
    if (completedRef.current) return;

    completedRef.current = true;
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const fallbackTimeout = window.setTimeout(complete, FALLBACK_TIMEOUT_MS);

    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(fallbackTimeout);
      document.body.style.overflow = previousOverflow;
    };
  }, [complete]);

  const handleAnimationEnd = (event) => {
    if (
      event.target === event.currentTarget
      && (event.animationName === 'splash-screen-exit'
        || event.animationName === 'splash-screen-exit-reduced')
    ) {
      complete();
    }
  };

  return (
    <div
      className="splash-screen"
      aria-hidden="true"
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="splash-screen__scene">
        <div className="splash-screen__trail splash-screen__trail--left" />
        <div className="splash-screen__trail splash-screen__trail--center" />
        <div className="splash-screen__trail splash-screen__trail--right" />

        <img
          className="splash-screen__ball splash-screen__ball--left"
          src={padelBall}
          alt=""
          draggable="false"
        />
        <img
          className="splash-screen__ball splash-screen__ball--center"
          src={padelBall}
          alt=""
          draggable="false"
        />
        <img
          className="splash-screen__ball splash-screen__ball--right"
          src={padelBall}
          alt=""
          draggable="false"
        />

        <img
          className="splash-screen__logo"
          src={prostoPadelLogo}
          alt=""
          draggable="false"
        />
      </div>
    </div>
  );
}
