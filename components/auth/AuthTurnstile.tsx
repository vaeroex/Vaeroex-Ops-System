"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_CAPTCHA_FIELD_NAME } from "@/lib/auth/captcha";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileRenderOptions = {
  sitekey: string;
  theme: "light";
  size: "flexible";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  "timeout-callback": () => void;
  "refresh-expired": "auto";
  "refresh-timeout": "auto";
};

type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type AuthTurnstileProps = {
  siteKey?: string;
};

export function AuthTurnstile({ siteKey }: AuthTurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Security check loading.");

  const clearToken = useCallback(() => {
    setToken("");
    setStatus("Complete the security check to continue.");
  }, []);

  const renderWidget = useCallback(() => {
    if (!siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "light",
      size: "flexible",
      callback: (nextToken) => {
        setToken(nextToken);
        setStatus("Security check complete.");
      },
      "expired-callback": clearToken,
      "error-callback": clearToken,
      "timeout-callback": clearToken,
      "refresh-expired": "auto",
      "refresh-timeout": "auto"
    });
  }, [clearToken, siteKey]);

  useEffect(() => {
    if (scriptReady) {
      renderWidget();
    }
  }, [renderWidget, scriptReady]);

  useEffect(
    () => () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    },
    []
  );

  if (!siteKey) {
    return null;
  }

  return (
    <div className="space-y-2" data-auth-captcha="turnstile">
      <Script
        id="cloudflare-turnstile"
        src={TURNSTILE_SCRIPT_URL}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onReady={() => setScriptReady(true)}
      />
      <input type="hidden" name={AUTH_CAPTCHA_FIELD_NAME} value={token} />
      <div ref={containerRef} className="min-h-[65px] w-full" />
      <p className="text-xs text-muted" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
