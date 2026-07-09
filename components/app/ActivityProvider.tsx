"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type ActivityInput = string | {
  label?: string;
  source?: string;
  timeoutMs?: number;
};

type ActivityRecord = {
  id: string;
  label: string;
  source?: string;
  startedAt: number;
};

type ActivityContextValue = {
  startActivity: (input?: ActivityInput) => string;
  updateActivity: (id: string, label: string) => void;
  endActivity: (id?: string | null) => void;
  clearActivity: () => void;
  isActive: boolean;
};

const ActivityContext = createContext<ActivityContextValue>({
  startActivity: () => "",
  updateActivity: () => undefined,
  endActivity: () => undefined,
  clearActivity: () => undefined,
  isActive: false
});

const DEFAULT_ACTIVITY_LABEL = "Processing...";
const DEFAULT_TIMEOUT_MS = 90000;

function activityLabelFromInput(input?: ActivityInput) {
  if (typeof input === "string") {
    return input.trim() || DEFAULT_ACTIVITY_LABEL;
  }

  return input?.label?.trim() || DEFAULT_ACTIVITY_LABEL;
}

function activityTimeoutFromInput(input?: ActivityInput) {
  return typeof input === "object" && input.timeoutMs ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
}

function sourceFromInput(input?: ActivityInput) {
  return typeof input === "object" ? input.source : undefined;
}

function activityLabelFromText(value: string) {
  const text = value.toLowerCase();

  if (text.includes("checkout")) return "Opening checkout...";
  if (text.includes("billing")) return "Opening billing...";
  if (text.includes("workspace")) return "Switching workspace...";
  if (text.includes("upload")) return "Uploading...";
  if (text.includes("analyz") || text.includes("review")) return "Reviewing evidence...";
  if (text.includes("report") || text.includes("brief") || text.includes("generate") || text.includes("creating")) return "Generating...";
  if (text.includes("search")) return "Searching...";
  if (text.includes("save")) return "Saving...";
  if (text.includes("delete") || text.includes("archive") || text.includes("restore")) return "Updating records...";

  return DEFAULT_ACTIVITY_LABEL;
}

function activityLabelFromForm(form: HTMLFormElement, submitter?: HTMLElement | null) {
  const explicit = submitter?.getAttribute("data-vaeroex-activity-label") || form.getAttribute("data-vaeroex-activity-label");

  if (explicit) {
    return explicit;
  }

  const action = form.getAttribute("action") || "";
  const encoding = form.getAttribute("enctype") || "";
  const submitterText = submitter?.textContent || "";

  if (encoding.toLowerCase().includes("multipart")) {
    return "Uploading...";
  }

  return activityLabelFromText(`${action} ${submitterText}`);
}

function activityLabelFromLink(anchor: HTMLAnchorElement) {
  const explicit = anchor.getAttribute("data-vaeroex-activity-label");

  if (explicit) {
    return explicit;
  }

  return activityLabelFromText(`${anchor.href} ${anchor.textContent || ""}`);
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const idCounterRef = useRef(0);
  const timersRef = useRef(new Map<string, number>());

  const clearActivity = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    setActivities([]);
  }, []);

  const endActivity = useCallback((id?: string | null) => {
    if (!id) {
      return;
    }

    const timer = timersRef.current.get(id);

    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setActivities((current) => current.filter((activity) => activity.id !== id));
  }, []);

  const startActivity = useCallback((input?: ActivityInput) => {
    idCounterRef.current += 1;
    const id = `activity-${Date.now()}-${idCounterRef.current}`;
    const record: ActivityRecord = {
      id,
      label: activityLabelFromInput(input),
      source: sourceFromInput(input),
      startedAt: Date.now()
    };

    setActivities((current) => [...current, record]);

    const timeout = window.setTimeout(() => {
      endActivity(id);
    }, activityTimeoutFromInput(input));
    timersRef.current.set(id, timeout);

    return id;
  }, [endActivity]);

  const updateActivity = useCallback((id: string, label: string) => {
    if (!id || !label.trim()) {
      return;
    }

    setActivities((current) => current.map((activity) => (activity.id === id ? { ...activity, label: label.trim() } : activity)));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("vaeroex-activity-active", activities.length > 0);

    return () => {
      document.documentElement.classList.remove("vaeroex-activity-active");
    };
  }, [activities.length]);

  useEffect(() => {
    clearActivity();
  }, [pathname, clearActivity]);

  useEffect(() => {
    function handlePageChange() {
      clearActivity();
    }

    window.addEventListener("pagehide", handlePageChange);
    window.addEventListener("beforeunload", handlePageChange);
    window.addEventListener("popstate", handlePageChange);

    return () => {
      window.removeEventListener("pagehide", handlePageChange);
      window.removeEventListener("beforeunload", handlePageChange);
      window.removeEventListener("popstate", handlePageChange);
      clearActivity();
    };
  }, [clearActivity]);

  useEffect(() => {
    function handleSubmit(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;

      if (!form || event.defaultPrevented || form.matches("[data-vaeroex-skip-global-activity]")) {
        return;
      }

      startActivity({
        label: activityLabelFromForm(form, submitter),
        source: "form-submit",
        timeoutMs: submitter?.matches("[data-vaeroex-local-activity]") ? 1800 : 15000
      });
    }

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");

      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.matches("[data-vaeroex-local-activity]") ||
        anchor.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }

      const href = anchor.getAttribute("href") || "";

      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      const nextUrl = new URL(href, window.location.href);

      if (nextUrl.origin !== window.location.origin || (nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search)) {
        return;
      }

      startActivity({ label: activityLabelFromLink(anchor), source: "navigation", timeoutMs: 12000 });
    }

    document.addEventListener("submit", handleSubmit);
    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("submit", handleSubmit);
      document.removeEventListener("click", handleClick, true);
    };
  }, [startActivity]);

  useEffect(() => {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      window.setTimeout(clearActivity, 0);
      return result;
    };

    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      window.setTimeout(clearActivity, 0);
      return result;
    };

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [clearActivity]);

  const value = useMemo<ActivityContextValue>(
    () => ({
      startActivity,
      updateActivity,
      endActivity,
      clearActivity,
      isActive: activities.length > 0
    }),
    [activities.length, clearActivity, endActivity, startActivity, updateActivity]
  );

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useVaeroexActivity() {
  return useContext(ActivityContext);
}

export function useActivitySignal(active: boolean, label = DEFAULT_ACTIVITY_LABEL, options?: { source?: string; timeoutMs?: number }) {
  const { startActivity, updateActivity, endActivity } = useVaeroexActivity();
  const activityIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (active) {
      if (!activityIdRef.current) {
        activityIdRef.current = startActivity({ label, source: options?.source, timeoutMs: options?.timeoutMs });
      } else {
        updateActivity(activityIdRef.current, label);
      }

      return;
    }

    if (activityIdRef.current) {
      endActivity(activityIdRef.current);
      activityIdRef.current = null;
    }
  }, [active, endActivity, label, options?.source, options?.timeoutMs, startActivity, updateActivity]);

  useEffect(() => {
    return () => {
      if (activityIdRef.current) {
        endActivity(activityIdRef.current);
        activityIdRef.current = null;
      }
    };
  }, [endActivity]);
}
