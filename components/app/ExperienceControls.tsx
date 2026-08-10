"use client";

import { useWorkspaceExperience } from "@/components/app/WorkspaceExperienceProvider";
import type { WorkspaceExperience } from "@/lib/presentation/workspace-experience";

const experiences: Array<{ value: WorkspaceExperience; label: string }> = [
  { value: "intel3d", label: "Intel 3D" },
  { value: "simple", label: "Simple" }
];

export function ExperienceControls() {
  const { experience, ready, setExperience } = useWorkspaceExperience();

  return (
    <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 shadow-sm shadow-black/10">
      <span className="hidden sm:inline">Experience</span>
      <select
        aria-label="Workspace experience"
        value={experience}
        disabled={!ready}
        onChange={(event) => setExperience(event.target.value as WorkspaceExperience)}
        className="rounded-md border border-white/10 bg-vaeroex-navy px-2 py-1 text-xs font-semibold text-white outline-none hover:border-vaeroex-accent focus:border-vaeroex-accent disabled:opacity-70"
      >
        {experiences.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
