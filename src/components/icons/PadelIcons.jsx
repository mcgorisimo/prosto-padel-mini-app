function PadelIcon({ size = 24, strokeWidth = 2, className, children, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

// Broad perforated head, open throat and short flared grip: original padel geometry.
function RacketFace({ strokeWidth }) {
  return (
    <g data-padel-part="racket" strokeWidth={strokeWidth}>
      <path d="M0-10C-3.3-10-5.2-7.8-5.2-4.6c0 3.1 1.5 5.1 3.8 7.2l.1 1.5L-1.7 8h3.4l-.4-3.9.1-1.5C3.7.5 5.2-1.5 5.2-4.6 5.2-7.8 3.3-10 0-10Z" />
      <path d="m-1.7 1.2 1.7 2 1.7-2ZM-1.3 4.4h2.6" strokeWidth={strokeWidth * 0.65} />
      <g fill="currentColor" stroke="none">
        <circle cx="-2" cy="-6.6" r=".55" /><circle cy="-6.6" r=".55" /><circle cx="2" cy="-6.6" r=".55" />
        <circle cx="-2" cy="-4.2" r=".55" /><circle cy="-4.2" r=".55" /><circle cx="2" cy="-4.2" r=".55" />
        <circle cx="-2" cy="-1.8" r=".55" /><circle cy="-1.8" r=".55" /><circle cx="2" cy="-1.8" r=".55" />
      </g>
    </g>
  );
}

export function PadelTrainingIcon({ size = 24, strokeWidth = 2, ...props }) {
  return (
    <PadelIcon {...props} size={size} strokeWidth={strokeWidth} data-padel-icon="trainings">
      <g transform="translate(8.8 12.5) rotate(-18) scale(1.1)"><RacketFace strokeWidth={strokeWidth} /></g>
      <g data-padel-part="ball" transform="translate(18.5 17.5)">
        <circle r="4.2" />
        <path d="M-2.6-3.3c2.3 1.8 2.3 4.8 0 6.6" strokeWidth={strokeWidth * 0.7} />
        <path d="M2.6-3.3c-2.3 1.8-2.3 4.8 0 6.6" strokeWidth={strokeWidth * 0.7} />
      </g>
    </PadelIcon>
  );
}

export function CrossedPadelRacketsIcon({ strokeWidth = 2, ...props }) {
  const racket = (
    <g data-padel-part="racket">
      <g data-padel-part="head">
        <path
          data-padel-part="head-outline"
          d="M0-5C-3.2-5-5-2.9-4.8.1c.15 2.8 1.7 4.8 3.9 5.8l.9.4.9-.4c2.2-1 3.75-3 3.9-5.8C5-2.9 3.2-5 0-5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth * 0.65}
        />
        <g fill="currentColor" stroke="none">
          <circle cx="-1.4" cy="-3" r=".52" />
          <circle cx="1.4" cy="-3" r=".52" />
          <circle cx="-2.4" cy="-1" r=".52" />
          <circle cy="-1" r=".52" />
          <circle cx="2.4" cy="-1" r=".52" />
          <circle cx="-2.4" cy="1.2" r=".52" />
          <circle cy="1.2" r=".52" />
          <circle cx="2.4" cy="1.2" r=".52" />
          <circle cx="-1.2" cy="3.25" r=".52" />
          <circle cx="1.2" cy="3.25" r=".52" />
        </g>
      </g>
      <g data-padel-part="grip" stroke="none">
        <path d="M-1.45 5.2h2.9v8.2q0 .8-.8.8h-1.3q-.8 0-.8-.8Z" fill="currentColor" />
        <path d="M-.5 6.6h1v6.55q0 .25-.25.25h-.5q-.25 0-.25-.25Z" fill="#071F16" />
      </g>
    </g>
  );

  return (
    <PadelIcon {...props} strokeWidth={strokeWidth} data-padel-icon="matches">
      <g data-padel-part="ball">
        <circle cx="12" cy="3.25" r="2.55" fill="currentColor" stroke="none" />
        <g fill="none" stroke="#071F16" strokeWidth={strokeWidth * 0.34}>
          <path d="M10.5 1.2c1.25 1 1.25 3.1 0 4.1" />
          <path d="M13.5 1.2c-1.25 1-1.25 3.1 0 4.1" />
        </g>
      </g>
      <g transform="translate(5.95 11.8) rotate(-36)">{racket}</g>
      <g transform="translate(18.05 11.8) rotate(36)">{racket}</g>
    </PadelIcon>
  );
}

export function PadelBookingIcon({ strokeWidth = 2, ...props }) {
  return (
    <PadelIcon {...props} strokeWidth={strokeWidth} data-padel-icon="bookings">
      <g data-padel-part="calendar" stroke="#F5F1E8">
        <path d="M5.2 4.5h13.6A2.2 2.2 0 0 1 21 6.7v12.1a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 18.8V6.7a2.2 2.2 0 0 1 2.2-2.2Z" />
        <path d="M3 9h18M7 2.5v4M17 2.5v4" />
      </g>
      <g data-padel-part="ball">
        <circle cx="12" cy="15.3" r="4.35" fill="#78B83F" stroke="#78B83F" />
        <g fill="none" stroke="#F5F1E8" strokeWidth={strokeWidth * 0.78}>
          <path d="M9.4 11.8c2.1 1.8 2.1 5.2 0 7" />
          <path d="M14.6 11.8c-2.1 1.8-2.1 5.2 0 7" />
        </g>
      </g>
    </PadelIcon>
  );
}
