import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * The centred single-purpose auth screen (recover, reset, callbacks) — everything
 * outside the split-panel sign-in page.
 */
export function AuthScreen({
  icon: Icon,
  tone = 'primary',
  title,
  description,
  children,
  backTo,
  backLabel = 'Back to sign in',
  wide = false,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: 'primary' | 'destructive' | 'success';
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  backTo?: string;
  backLabel?: string;
  /** Roomier column, for forms with side-by-side fields. */
  wide?: boolean;
}) {
  const tones = {
    primary: 'bg-primary/10 text-primary',
    destructive: 'bg-destructive/10 text-destructive',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  } as const;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div
        className={`w-full space-y-6 duration-500 animate-in fade-in slide-in-from-bottom-2 ${
          wide ? 'max-w-lg' : 'max-w-sm'
        }`}
      >
        <div className="space-y-3 text-center">
          <span
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl ${tones[tone]}`}
          >
            <Icon className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>

        {children}

        {backTo && (
          <Link
            to={backTo}
            className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
