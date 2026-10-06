import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load the human check. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

/** Cloudflare Turnstile widget. Calls onToken with a fresh token (or '' when it expires). */
export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; onToken: (t: string) => void; onError?: (msg: string) => void }>(
  function Turnstile({ siteKey, onToken, onError }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const cb = useRef({ onToken, onError });
    cb.current = { onToken, onError };

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
        cb.current.onToken('');
      },
    }));

    useEffect(() => {
      let cancelled = false;
      loadScript()
        .then(() => {
          if (cancelled || !el.current || !window.turnstile) return;
          widgetId.current = window.turnstile.render(el.current, {
            sitekey: siteKey,
            callback: (t: string) => cb.current.onToken(t),
            'expired-callback': () => cb.current.onToken(''),
            'error-callback': () => cb.current.onError?.('Human check failed. Please retry.'),
            theme: 'light',
            size: 'flexible',
          });
        })
        .catch((e: Error) => cb.current.onError?.(e.message));
      return () => {
        cancelled = true;
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      };
    }, [siteKey]);

    return <div ref={el} className="min-h-[65px]" />;
  },
);
