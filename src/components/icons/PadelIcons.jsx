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

// A solid perforated face and short grip distinguish a padel racket from strings.
function RacketFace() {
  return (
    <>
      <path d="M-3.4-7c0-4.5 6.8-4.5 6.8 0 0 2.2-.8 4.3-2.4 5.6h-2C-2.6-2.7-3.4-4.8-3.4-7Z" />
      <path d="m-1-1.4.2 2.2h1.6L1-1.4M-.8.8v6H.8v-6" />
      <g fill="currentColor" stroke="none">
        <circle cx="-1.2" cy="-7" r=".5" />
        <circle cx="1.2" cy="-7" r=".5" />
        <circle cx="-1.2" cy="-5" r=".5" />
        <circle cx="1.2" cy="-5" r=".5" />
      </g>
    </>
  );
}

export function CrossedPadelRacketsIcon(props) {
  return (
    <PadelIcon {...props} data-padel-icon="matches">
      <g transform="translate(12 13) rotate(-40)"><RacketFace /></g>
      <g transform="translate(12 13) rotate(40)"><RacketFace /></g>
    </PadelIcon>
  );
}

export function PadelTrainingIcon(props) {
  return (
    <PadelIcon {...props} data-padel-icon="trainings">
      <g transform="translate(7.5 11.5) rotate(25)"><RacketFace /></g>
      <circle cx="17" cy="17" r="4" />
      <circle cx="17" cy="17" r="1.3" />
    </PadelIcon>
  );
}
