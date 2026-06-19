"use client";

import { useMemo, useState } from "react";
import { COMPLIANCE_NOTICE, type IndustryTemplate } from "@/data/industry-templates";
import { generateWorkspaceFromSetupAction } from "@/app/app/setup/actions";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";

const steps = [
  "Business",
  "Clarity",
  "Systems",
  "Profile",
  "Generate"
];

type SetupWizardProps = {
  templates: IndustryTemplate[];
  error?: string;
};

export function SetupWizard({ templates, error }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState(templates[0]?.id || "");
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) || templates[0],
    [templateId, templates]
  );

  return (
    <form action={generateWorkspaceFromSetupAction} noValidate className="space-y-6">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="industry" value={selectedTemplate?.name || ""} />

      <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-wrap gap-2">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(index)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                step === index ? "bg-vaeroex-blue text-white" : "bg-slate-100 text-muted"
              }`}
            >
              {index + 1}. {label}
            </button>
          ))}
        </div>
        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
      </div>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 0 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Business basics</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Business name
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
          <h2 className="text-xl font-semibold">Structure to build</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              What do you manage?
              <textarea
                required
                name="managed_items"
                placeholder="Employees, vehicles, equipment, customers, jobs, appointments, locations..."
                className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
            <label className="block text-sm font-medium">
              What should Vaeroex help structure first?
              <textarea
                required
                name="desired_systems"
                placeholder="Visibility dashboard, accountability follow-ups, reports, checklists, SOPs, CRM, KPI tracking..."
                className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
          </div>
      </section>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 3 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Choose business profile</h2>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setTemplateId(template.id)}
                className={`rounded-lg border p-4 text-left ${
                  templateId === template.id ? "border-vaeroex-blue bg-vaeroex-soft" : "border-line bg-white"
                }`}
              >
                <span className="text-sm font-semibold">{template.name}</span>
                <span className="mt-2 block text-sm leading-6 text-muted">{template.description}</span>
                {template.complianceNotice ? (
                  <span className="mt-3 block rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    {template.complianceNotice}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
      </section>

      <section className={`rounded-lg border border-line bg-white p-6 shadow-panel ${step === 4 ? "" : "hidden"}`}>
          <h2 className="text-xl font-semibold">Generate workspace</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Vaeroex will create a practical first workspace for visibility, accountability, and execution:
            forms, checklists, SOP drafts, issue categories, follow-up records, relevant assets, a report,
            and a Vaeroex review result.
          </p>
          <div className="mt-5">
            <ComplianceNotice />
          </div>
          {selectedTemplate?.complianceNotice && selectedTemplate.complianceNotice !== COMPLIANCE_NOTICE ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              {selectedTemplate.complianceNotice}
            </div>
          ) : null}
          <ConfirmSubmitButton
            message="Generate this workspace now? Vaeroex will create the first records for review before you use them with real activity."
            className="mt-6 rounded-lg bg-vaeroex-blue px-5 py-2.5 text-sm font-semibold text-white"
          >
            Generate workspace
          </ConfirmSubmitButton>
      </section>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium"
        >
          Next
        </button>
      </div>
    </form>
  );
}
