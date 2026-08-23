import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CAPTCHA_CONFIG_KEY,
  captchaSiteKeyFromError,
  getCaptchaConfig,
  type CaptchaConfig,
} from './captcha';

/**
 * The CAPTCHA challenge, rendered from whatever the project configured.
 *
 * Both supported providers expose the same explicit-render API (`render` into an
 * element, `reset` by widget id), so one component covers them — only the script URL
 * and the global differ. Explicit rendering, rather than the auto `g-recaptcha`
 * class, is what lets the widget live inside a React tree and be reset after a failed
 * submit: a solved code is single-use, so replaying it always fails.
 */

interface CaptchaApi {
  ready?: (cb: () => void) => void;
  render: (el: HTMLElement, params: Record<string, unknown>) => number;
  reset: (widgetId?: number) => void;
}

declare global {
  interface Window {
    grecaptcha?: CaptchaApi;
    hcaptcha?: CaptchaApi;
  }
}

const PROVIDERS = {
  recaptcha: {
    scriptId: 'blocks-recaptcha-script',
    src: 'https://www.google.com/recaptcha/api.js?render=explicit',
    api: () => window.grecaptcha,
  },
  hcaptcha: {
    scriptId: 'blocks-hcaptcha-script',
    src: 'https://js.hcaptcha.com/1/api.js?render=explicit',
    api: () => window.hcaptcha,
  },
} as const;

type ProviderName = keyof typeof PROVIDERS;

const providerOf = (provider: string | undefined): ProviderName =>
  provider?.toLowerCase() === 'hcaptcha' ? 'hcaptcha' : 'recaptcha';

/** One in-flight load per provider, shared by every widget on the page. */
const loading = new Map<ProviderName, Promise<CaptchaApi>>();

function loadCaptchaApi(name: ProviderName): Promise<CaptchaApi> {
  const provider = PROVIDERS[name];
  const alreadyThere = provider.api();
  if (alreadyThere?.render) return Promise.resolve(alreadyThere);

  const cached = loading.get(name);
  if (cached) return cached;

  const pending = new Promise<CaptchaApi>((resolve, reject) => {
    const settle = () => {
      const api = provider.api();
      if (!api) return reject(new Error(`${name} loaded but exposed no API`));
      // grecaptcha is defined before its internals are — ready() bridges that gap.
      if (api.ready) api.ready(() => resolve(api));
      else resolve(api);
    };
    const fail = () => reject(new Error(`The ${name} script could not be loaded.`));

    const existing = document.getElementById(provider.scriptId);
    if (existing) {
      existing.addEventListener('load', settle);
      existing.addEventListener('error', fail);
      return;
    }

    const script = document.createElement('script');
    script.id = provider.scriptId;
    script.src = provider.src;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', settle);
    script.addEventListener('error', fail);
    document.head.appendChild(script);
  });

  // A failed load must not poison later attempts — the next mount retries.
  pending.catch(() => loading.delete(name));
  loading.set(name, pending);
  return pending;
}

/** Mirrors the `dark` class the theme toggle writes onto the <html> element. */
function useIsDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
}

export interface CaptchaHandle {
  /** Clear the solved code and hand the user a fresh challenge. */
  reset(): void;
}

export interface CaptchaProps {
  siteKey: string;
  provider: string;
  /** Fires with the solved code, and with '' when it expires or errors out. */
  onVerify(code: string): void;
  onLoadError?(message: string): void;
  className?: string;
}

export const Captcha = forwardRef<CaptchaHandle, CaptchaProps>(function Captcha(
  { siteKey, provider, onVerify, onLoadError, className },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<number | null>(null);
  const apiRef = useRef<CaptchaApi | null>(null);
  const isDark = useIsDark();

  // Held in refs so a parent re-render never tears the widget down and rebuilds it,
  // which would throw away a challenge the user has already solved.
  const onVerifyRef = useRef(onVerify);
  const onLoadErrorRef = useRef(onLoadError);
  onVerifyRef.current = onVerify;
  onLoadErrorRef.current = onLoadError;

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetId.current !== null) apiRef.current?.reset(widgetId.current);
      onVerifyRef.current('');
    },
  }));

  const name = providerOf(provider);
  const theme = isDark ? 'dark' : 'light';

  useEffect(() => {
    let cancelled = false;

    loadCaptchaApi(name)
      .then((api) => {
        const el = container.current;
        if (cancelled || !el) return;
        apiRef.current = api;
        // render() refuses a container that already holds a widget, so the element is
        // emptied first — that is also how a theme or key change re-renders it.
        el.innerHTML = '';
        widgetId.current = api.render(el, {
          sitekey: siteKey,
          theme,
          size: 'normal',
          callback: (code: string) => onVerifyRef.current(code),
          'expired-callback': () => onVerifyRef.current(''),
          'error-callback': () => onVerifyRef.current(''),
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) onLoadErrorRef.current?.(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [name, siteKey, theme]);

  // The reserved height is the widget's own 78px, so the form does not jump on load.
  return <div ref={container} className={className} style={{ minHeight: 78 }} />;
});

export interface UseCaptcha {
  /** The project wants a challenge and we have a key to render one with. */
  enabled: boolean;
  /** Still asking IAM whether a challenge is needed. */
  isLoading: boolean;
  /** The solved code, or '' while unsolved. Send it with the request. */
  code: string;
  /** True while a required challenge is unsolved — use it to gate submit. */
  blocking: boolean;
  /** Set when the provider's script never loaded; worth showing next to the form. */
  loadError: string | null;
  /** Call after every failed submit: a solved code cannot be replayed. */
  reset(): void;
  /** Feed a rejected request in; picks up a site key IAM names in the error. */
  handleError(error: unknown): void;
  /** Spread onto <Captcha />. */
  props: CaptchaProps & { ref: Ref<CaptchaHandle> };
}

/**
 * Wires a form to the project's CAPTCHA.
 *
 * The config query is the only thing that decides whether a challenge appears, so a
 * project without one configured gets `enabled: false` and an unchanged form. A
 * failed config fetch is deliberately not fatal — it degrades to no challenge and
 * lets IAM be the one to insist, via `captcha_enabled`, if it really requires one.
 */
export function useCaptcha(): UseCaptcha {
  const { data: config, isPending } = useQuery<CaptchaConfig | null>({
    queryKey: CAPTCHA_CONFIG_KEY,
    queryFn: getCaptchaConfig,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [code, setCode] = useState('');
  // Set only when IAM names a key in a rejection — see captchaSiteKeyFromError.
  const [keyFromError, setKeyFromError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const handle = useRef<CaptchaHandle>(null);

  const siteKey = keyFromError ?? config?.key ?? '';
  const enabled = siteKey.length > 0;

  const reset = useCallback(() => {
    setCode('');
    handle.current?.reset();
  }, []);

  const handleError = useCallback((error: unknown) => {
    const named = captchaSiteKeyFromError(error);
    if (named) setKeyFromError(named);
    setCode('');
    handle.current?.reset();
  }, []);

  return {
    enabled,
    isLoading: isPending,
    code,
    // A challenge that never rendered must not lock the form: an ad blocker or a
    // firewalled google.com would otherwise make signing in impossible. Let the
    // request through unanswered and leave the verdict to IAM, which is the only
    // side that can actually enforce it.
    blocking: enabled && !loadError && code === '',
    loadError,
    reset,
    handleError,
    props: {
      ref: handle,
      siteKey,
      provider: config?.provider ?? 'recaptcha',
      onVerify: setCode,
      onLoadError: setLoadError,
    },
  };
}
