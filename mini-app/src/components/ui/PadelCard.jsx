import React from 'react';

// Premium glass container for the dark green club canvas.

export default function PadelCard({
  as: Component = 'div',
  padding       = 'md',
  className     = '',
  children,
  ...rest
}) {
  const PADDING = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' };

  const classes = [
    'rounded-[24px]',
    'bg-white/[0.045] backdrop-blur-xl',
    'border border-warm-white/10',
    'shadow-[0_18px_60px_rgba(0,0,0,0.34)]',
    PADDING[padding] ?? PADDING.md,
    className,
  ].filter(Boolean).join(' ');

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
