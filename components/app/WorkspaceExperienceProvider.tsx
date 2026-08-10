"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_WORKSPACE_EXPERIENCE,
  normalizeWorkspaceExperience,
  VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY,
  type WorkspaceExperience
} from "@/lib/presentation/workspace-experience";

type WorkspaceExperienceContextValue = Readonly<{
  experience: WorkspaceExperience;
  ready: boolean;
  setExperience: (experience: WorkspaceExperience) => void;
}>;

const WorkspaceExperienceContext = createContext<WorkspaceExperienceContextValue | null>(null);

function applyWorkspaceExperience(experience: WorkspaceExperience) {
  document.documentElement.dataset.workspaceExperience = experience;
}

export function WorkspaceExperienceProvider({ children }: { children: ReactNode }) {
  const [experience, setExperienceState] = useState<WorkspaceExperience>(DEFAULT_WORKSPACE_EXPERIENCE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const syncStoredPreference = () => {
      let stored = DEFAULT_WORKSPACE_EXPERIENCE;
      try {
        stored = normalizeWorkspaceExperience(window.localStorage.getItem(VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY));
      } catch {
        stored = DEFAULT_WORKSPACE_EXPERIENCE;
      }
      setExperienceState(stored);
      applyWorkspaceExperience(stored);
      setReady(true);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY) return;
      const nextExperience = normalizeWorkspaceExperience(event.newValue);
      setExperienceState(nextExperience);
      applyWorkspaceExperience(nextExperience);
    };

    syncStoredPreference();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setExperience = useCallback((nextExperience: WorkspaceExperience) => {
    setExperienceState(nextExperience);
    applyWorkspaceExperience(nextExperience);
    try {
      window.localStorage.setItem(VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY, nextExperience);
    } catch {
      // The in-memory preference remains usable when browser storage is unavailable.
    }
  }, []);

  const value = useMemo(() => ({ experience, ready, setExperience }), [experience, ready, setExperience]);
  return <WorkspaceExperienceContext.Provider value={value}>{children}</WorkspaceExperienceContext.Provider>;
}

export function useWorkspaceExperience() {
  const context = useContext(WorkspaceExperienceContext);
  if (!context) throw new Error("Workspace experience must be read inside WorkspaceExperienceProvider.");
  return context;
}
