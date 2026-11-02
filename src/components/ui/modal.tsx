import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A dependency-free dialog. The project has no @radix-ui/react-dialog, and the two
 * screens that need one (create role, assign roles) want the same small surface:
 * a backdrop, Escape to close, and a scroll lock while open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}>) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <dialog
      open
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-black/50 p-0 text-inherit"
    >
      <div className="relative flex min-h-full items-start justify-center p-4 sm:items-center">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close"
          className="absolute inset-0 cursor-default"
          // Only a press that starts *and* ends on the backdrop closes — a text
          // selection dragged out of the panel shouldn't dismiss the form.
          onMouseDown={() => onClose()}
        />
        <div
          className={cn(
            'relative my-auto w-full max-w-lg rounded-lg border bg-card text-card-foreground shadow-lg',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div className="min-w-0">
              <h2 className="font-semibold leading-none tracking-tight">{title}</h2>
              {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>

          <div className="space-y-4 p-5">{children}</div>

          {footer && <div className="flex justify-end gap-2 border-t p-5">{footer}</div>}
        </div>
      </div>
    </dialog>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: Readonly<{
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
