import * as React from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }
>(({ className, mono, ...props }, ref) => (
  <textarea
    ref={ref}
    spellCheck={mono ? false : undefined}
    className={cn(control, 'min-h-[5rem] resize-y', mono && 'font-mono text-xs', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(control, 'h-10 py-0', className)} {...props} />
  ),
);
Select.displayName = 'Select';

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Comma/newline separated text ↔ string[] — the shape most "list of ids/emails" inputs want. */
export function splitList(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Parses a JSON textarea, throwing a readable error instead of a bare SyntaxError. */
export function parseJsonInput<T = unknown>(text: string, label = 'JSON'): T | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}
