import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Title, one-line purpose, and the endpoints the page exercises — every test screen
 * names what it calls, so a failure can be matched to a route without opening devtools.
 */
export function PageHeader({
  title,
  description,
  endpoints,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  endpoints?: string[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {endpoints && endpoints.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {endpoints.map((e) => (
              <code key={e} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {e}
              </code>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1 border-b', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            t.value === value
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Pretty JSON for "here is exactly what the API returned" panels. */
export function JsonView({
  value,
  className,
  maxHeight = 'max-h-96',
}: {
  value: unknown;
  className?: string;
  maxHeight?: string;
}) {
  const text = React.useMemo(() => {
    if (value === undefined) return '—';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <div className="relative">
      <pre
        className={cn(
          'overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs',
          maxHeight,
          className,
        )}
      >
        {text}
      </pre>
      <CopyButton text={text} className="absolute right-1.5 top-1.5" />
    </div>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7 opacity-70 hover:opacity-100', className)}
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

/** Two-column definition list for record details. */
export function DetailList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,11rem)_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? '—'}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function Pager({
  page,
  pageCount,
  onChange,
  total,
  zeroBased = false,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  total?: number;
  /** IAM pages from 0, Data and most others from 1. */
  zeroBased?: boolean;
}) {
  const first = zeroBased ? 0 : 1;
  const last = Math.max(first, pageCount - (zeroBased ? 1 : 0));
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm">
      <span className="text-muted-foreground">
        Page {page - first + 1} of {Math.max(1, pageCount)}
        {total !== undefined && ` · ${total} total`}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= first} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= last} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
