"use client";

import { useMemo, useState } from "react";
import type { WorkspaceSetupCategory } from "@/data/workspace-categories";
import { generateWorkspaceFromSetupAction } from "@/app/app/setup/actions";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";

const steps = [
  "Organization",
  "Clarity",
  "Context",
  "Environment",
  "Generate"
];

type SetupWizardProps = {
  categories: WorkspaceSetupCategory[];
  error?: string;
};

export function SetupWizard({ categories, error }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === categoryId) || categories[0],
    [categoryId, categories]
  );

  return (
    <form action={generateWorkspaceFromSetupAction} noValidate className="space-y-6">
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="organization_type" value={selectedCategory?.name || ""} />

      <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-wrap gap-2">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(index)}
              className={`min-h-11 rounded-full px-3 py-2 text-sm font-medium ${
                step === index ? "bg-vaeroex-blue text-white" : "bg-slate-100 text-muted"
              }`}
            >
              {index + 1}. {label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <ErrorNotice message={error} />
        </div>
      </div>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 0 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Organization basics</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Organization name
              <input required name="business_name" className="mt-2 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Team size
              <select required name="team_size" className="mt-2 w-full rounded-lg border border-line px-3 py-2">
                <option value="">Choose size</option>
                <option>1-10</option>
                <option>10-25</option>
                <option>25-50</option>
                <option>50-100</option>
                <option>100+</option>
              </select>
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Number of locations
              <input required name="locations" className="mt-2 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Describe your organization
              <textarea
                required
                name="organization_description"
                placeholder="Example: We manage a small regional service team with recurring customer response work, monthly reporting, and several open operational issues."
                className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
          </div>
      </section>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 1 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Clarity gaps</h2>
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium">
              What is hardest to see clearly right now?
              <textarea required name="main_problem" className="mt-2 min-h-24 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Current tools used
              <textarea name="current_tools" className="mt-2 min-h-20 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              What falls through the cracks most often?
              <textarea required name="missed_often" className="mt-2 min-h-20 w-full rounded-lg border border-line px-3 py-2" />
            </label>
          </div>
      </section>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 2 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Context to understand</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              What should Vaeroex understand?
              <textarea
                required
                name="managed_items"
                placeholder="Revenue sources, customers, locations, assets, service lines, reporting rhythms..."
                className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
            <label className="block text-sm font-medium">
              What should Vaeroex focus on first?
              <textarea
                required
                name="desired_systems"
                placeholder="Executive visibility, KPI trends, customer response, operational risk, file analysis..."
                className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
          </div>
      </section>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 3 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Choose operational environment</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            This selection helps Vaeroex tune initial terminology, dashboards, and intelligence signals.
            It is only a starting point. You can adjust this later.
          </p>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={`min-h-11 rounded-lg border p-4 text-left ${
                  categoryId === category.id ? "border-vaeroex-blue bg-vaeroex-soft" : "border-line bg-white"
                }`}
              >
                <span className="text-sm font-semibold">{category.name}</span>
                <span className="mt-2 block text-sm leading-6 text-muted">{category.description}</span>
                <span className="mt-3 block text-xs font-semibold uppercase tracking-wide text-vaeroex-blue">
                  Starting configuration only
                </span>
                {category.complianceNotice ? (
                  <span className="mt-3 block rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    {category.complianceNotice}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
      </section>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 4 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Generate workspace</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Vaeroex will create a practical starting workspace for operational visibility and decision support.
            Your selected environment and organization description will shape initial dashboards, terminology,
            Business Signals, reports, and intelligence outputs.
          </p>
          <div className="mt-5">
            <ComplianceNotice />
          </div>
          {selectedCategory?.complianceNotice ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              {selectedCategory.complianceNotice}
            </div>
          ) : null}
          <ConfirmSubmitButton
            message="Generate this workspace now? Vaeroex will create the first records for review before you use them with real activity."
            className="mt-6 min-h-11 rounded-lg bg-vaeroex-blue px-5 py-2.5 text-sm font-semibold text-white"
          >
            Generate workspace
          </ConfirmSubmitButton>
      </section>

      <div className="grid gap-3 sm:flex sm:justify-between">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          className="min-h-11 rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
          className="min-h-11 rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium"
        >
          Next
        </button>
      </div>
    </form>
  );
}
