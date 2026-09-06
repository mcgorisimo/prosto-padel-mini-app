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
