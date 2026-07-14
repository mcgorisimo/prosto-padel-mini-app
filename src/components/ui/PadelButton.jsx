import React from 'react';

// Premium button. Variants keep legacy names while mapping to the club palette.

const VARIANTS = {
  yellow:
    'bg-accent-light/12 text-accent-light border border-accent-light/32 shadow-[0_14px_36px_rgba(0,0,0,0.18)] hover:bg-accent-light/16 active:bg-accent-light/20',
  dark: 'bg-surface/90 text-warm-white border border-warm-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.24)] hover:bg-white/[0.06] active:bg-app-bg',
  ghost:
    'bg-transparent text-warm-white border border-warm-white/18 hover:bg-white/[0.05] active:bg-white/[0.08]',
  success:
    'bg-accent-light text-app-bg shadow-[0_14px_36px_rgba(216,243,74,0.16)] hover:bg-[#e3fb64] active:bg-[#cce939]',
  danger:
    'bg-transparent text-coral border border-coral/35 hover:bg-coral/10 active:bg-coral/15',
  info: 'bg-surface text-accent-light border border-accent-light/35 shadow-[0_14px_36px_rgba(0,0,0,0.18)] hover:bg-accent-light/10 active:bg-accent-light/15',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3.5 text-base',
};

export default function PadelButton({
  variant   = 'yellow',
  size      = 'md',
  fullWidth = false,
  className = '',
  disabled  = false,
  children,
  ...rest
}) {
  const classes = [
    'inline-flex items-center justify-center gap-2',
    'rounded-2xl font-semibold tracking-normal',
    'transition-all duration-200 ease-out active:scale-[0.98] transform-gpu',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:scale-100',
    VARIANTS[variant] ?? VARIANTS.yellow,
    SIZES[size]       ?? SIZES.md,
    fullWidth ? 'w-full' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button disabled={disabled} className={classes} {...rest}>
      {children}
    </button>
  );
}
