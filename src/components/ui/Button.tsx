import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'amber';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  disabled,
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary: 'bg-stone-900 text-white hover:bg-stone-800 active:bg-stone-950 shadow-sm',
    secondary: 'bg-stone-100 text-stone-900 hover:bg-stone-200 active:bg-stone-300',
    outline: 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 active:bg-stone-100',
    ghost: 'text-stone-600 hover:bg-stone-100 active:bg-stone-200',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800',
    amber: 'bg-amber-600 text-white hover:bg-amber-700 active:bg-amber-800 shadow-sm shadow-amber-600/20',
  };

  const sizes = {
    sm: 'min-h-[40px] sm:min-h-0 h-9 sm:h-8 px-3 text-xs rounded-lg',
    md: 'min-h-[42px] sm:min-h-0 h-10 px-4 text-sm rounded-lg',
    lg: 'h-12 px-6 text-base rounded-xl font-medium',
    icon: 'min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 h-10 w-10 sm:h-9 sm:w-9 p-0 rounded-lg flex items-center justify-center',
  };

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer touch-manipulation select-none active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
