import React from 'react';

// Level badge aligned with RATING_CONFIG in lib/ratingEngine.js.
// All seven canonical levels supported (D, D+, C, C+, B, B+, A).
// Pass `level` to drive the color scheme; children override the displayed label.

const LEVEL_STYLES = {
  'D':  'bg-warm-white/8    text-warm-white/65 border-warm-white/15',
  'D+': 'bg-warm-white/10   text-warm-white/75 border-warm-white/18',
  'C':  'bg-accent-light/10 text-accent-light border-accent-light/24',
  'C+': 'bg-accent-light/14 text-accent-light border-accent-light/32',
  'B':  'bg-coral/10        text-coral border-coral/22',
  'B+': 'bg-coral/14        text-coral border-coral/32',
  'A':  'bg-accent-light/18 text-accent-light border-accent-light/40',
};

const SIZES = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2   py-0.5 text-xs',
  lg: 'px-2.5 py-1   text-sm',
};

export default function PadelBadge({
  level     = 'C',
  size      = 'md',
  className = '',
  children,
  ...rest
}) {
  const variant = LEVEL_STYLES[level] ?? LEVEL_STYLES['D'];

  const classes = [
    'inline-flex items-center gap-1 rounded-full border',
    'font-bold tracking-wide uppercase',
    variant,
    SIZES[size] ?? SIZES.md,
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={classes} {...rest}>
      {children ?? level}
    </span>
  );
}
