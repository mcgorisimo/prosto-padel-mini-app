import React, { useEffect, useState } from 'react';

const C = {
  infoBg: 'rgba(7,31,22,0.94)',
  infoBorder: 'rgba(216,243,74,0.24)',
  infoText: '#F5F1E8',
  successBg: 'rgba(216,243,74,0.94)',
  successBorder: 'rgba(216,243,74,0.38)',
  successText: '#050F0B',
  errorBg: 'rgba(255,111,97,0.94)',
  errorBorder: 'rgba(255,111,97,0.38)',
  errorText: '#050F0B',
};

export default function Toast({ message, variant = 'info', onClose }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Allow time for fade-out transition
    }, 3000); // Display for 3 seconds

    return () => clearTimeout(timer);
  }, [message, onClose]);

  let bg, border, color, icon;

  switch (variant) {
    case 'success':
      bg = C.successBg;
      border = C.successBorder;
      color = C.successText;
      icon = 'OK';
      break;
    case 'error':
      bg = C.errorBg;
      border = C.errorBorder;
      color = C.errorText;
      icon = '!';
      break;
    case 'info':
    default:
      bg = C.infoBg;
      border = C.infoBorder;
      color = C.infoText;
      icon = 'i';
      break;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: `translateX(-50%) translateY(${isVisible ? '0' : '-100%'})`,
        opacity: isVisible ? 1 : 0,
        zIndex: 9000,
        maxWidth: '340px',
        width: 'calc(100% - 32px)',
        background: bg,
        borderRadius: '12px',
        padding: '12px 16px',
        border: `1px solid ${border}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
      }}
    >
      <span style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.08em', flexShrink: 0, marginTop: '2px', color }}>{icon}</span>
      <div style={{ flex: 1, fontSize: '13px', fontWeight: 600, lineHeight: 1.5, color: color }}>
        {message}
      </div>
    </div>
  );
}
