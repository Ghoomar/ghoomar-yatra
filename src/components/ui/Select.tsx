'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className = '', children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={`flex h-11 w-full items-center justify-between rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-900 placeholder:text-stone-400 transition-all hover:border-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 shadow-2xs cursor-pointer ${className}`}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 text-stone-400 transition-transform shrink-0" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectScrollUpButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className = '', ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={`flex cursor-default items-center justify-center py-1 text-stone-500 ${className}`}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

export const SelectScrollDownButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className = '', ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={`flex cursor-default items-center justify-center py-1 text-stone-500 ${className}`}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className = '', children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={`relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-xl border border-stone-200 bg-white text-stone-900 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 ${
        position === 'popper'
          ? 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1'
          : ''
      } ${className}`}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={`p-1 ${
          position === 'popper'
            ? 'w-full min-w-[var(--radix-select-trigger-width)]'
            : ''
        }`}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className = '', ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={`px-2 py-1.5 text-[11px] font-bold text-stone-500 uppercase tracking-wider ${className}`}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className = '', children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={`relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-3 pr-8 text-xs font-semibold outline-none transition-colors focus:bg-amber-50 focus:text-amber-950 data-[state=checked]:bg-amber-50/60 data-[state=checked]:text-amber-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${className}`}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-amber-600" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className = '', ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-stone-100 ${className}`}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export interface SimpleSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SimpleSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: SimpleSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  'aria-label'?: string;
  id?: string;
  name?: string;
}

export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  triggerClassName = '',
  'aria-label': ariaLabel,
  id,
  name,
}: SimpleSelectProps) {
  return (
    <div className={`relative w-full ${className}`}>
      <Select
        value={value || ''}
        onValueChange={(val) => onChange(val)}
        disabled={disabled}
        name={name}
      >
        <SelectTrigger
          id={id}
          aria-label={ariaLabel || placeholder}
          className={triggerClassName}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
