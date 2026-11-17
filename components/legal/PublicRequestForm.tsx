"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { createContactRequestAction } from "@/app/support/actions";
import { PROJECT_AGREEMENT_NOTICE } from "@/lib/marketing/solutions";
import {
  INQUIRY_CATEGORIES,
  isProjectInquiry,
  type ContactFormState,
} from "@/lib/contact/inquiries";

const controlClass =
  "mt-2 min-h-11 w-full rounded-lg border border-white/20 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-blue-300";
const initialState: ContactFormState = {};
export function PublicRequestForm({ issueType }: { issueType: string }) {
  const [category, setCategory] = useState(issueType);
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState(
    async (previous: ContactFormState, data: FormData) => {
      try {
        return await createContactRequestAction(previous, data);
      } catch {
        return {
          error:
            "We could not confirm receipt. Please use the direct email links before retrying.",
        };
      }
    },
    initialState,
  );
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.message) feedback.current?.focus();
  }, [state]);
  const project = isProjectInquiry(category);
  function field(
    name: string,
    label: string,
    {
      required = false,
      maxLength = 200,
      type = "text",
      multiline = false,
      hint,
    }: {
      required?: boolean;
      maxLength?: number;
      type?: string;
      multiline?: boolean;
      hint?: string;
    } = {},
  ) {
    const error = state.fieldErrors?.[name];
    const props = {
      id: `contact-${name}`,
      name,
      required,
      maxLength,
      value: values[name] || "",
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setValues((current) => ({ ...current, [name]: event.target.value })),
      "aria-invalid": Boolean(error),
      "aria-describedby":
        [hint ? `contact-${name}-hint` : "", error ? `contact-${name}-error` : ""]
          .filter(Boolean)
          .join(" ") || undefined,
      className: controlClass,
    };
    return (
      <div className="text-sm font-medium">
        <label className="block" htmlFor={props.id}>
          {label}
          {required ? " *" : " (optional)"}
        </label>
        {hint ? (
          <p
            id={`contact-${name}-hint`}
            className="mt-2 text-sm font-normal leading-6 text-slate-300"
          >
            {hint}
          </p>
        ) : null}
        {multiline ? (
          <textarea {...props} rows={5} />
        ) : (
          <input
            {...props}
            type={type}
            autoComplete={
              name === "name"
                ? "name"
                : name === "email"
                  ? "email"
                  : name === "company"
                    ? "organization"
                    : "off"
            }
          />
        )}
        {error ? (
          <span
            id={`contact-${name}-error`}
            className="mt-2 block text-sm text-red-200"
          >
            {error}
          </span>
        ) : null}
      </div>
    );
  }
  function choice(name: string, label: string, options: string[]) {
    return (
      <label className="block text-sm font-medium" htmlFor={`contact-${name}`}>
        {label} (optional)
        <select
          id={`contact-${name}`}
          name={name}
          value={values[name] || "Not sure yet"}
          onChange={(event) =>
            setValues((current) => ({ ...current, [name]: event.target.value }))
          }
          className={controlClass}
        >
          {["Not sure yet", ...options].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="vx-request-form rounded-lg border border-white/20 bg-[#10151e] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
        Contact form
      </p>
      <h2 className="mt-2 text-2xl font-semibold">
        Tell us what you have in mind.
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        A brief description is enough to start. Fields marked * are required.
      </p>
      <div
        ref={feedback}
        tabIndex={-1}
        role={state.error ? "alert" : "status"}
        aria-live="polite"
        className={
          state.error || state.message
            ? "mt-4 rounded-lg border border-white/20 p-4 text-sm"
            : undefined
        }
      >
        {state.error || state.message}
      </div>
      {state.message ? (
        <a href="/contact" className="vx-text-link mt-5">
          Start another inquiry
        </a>
      ) : (
        <form
          action={action}
          onSubmit={(event) => {
            // Dispatch explicitly so failed actions do not reset the browser's
            // native select state or erase the visitor's controlled input.
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => action(data));
          }}
          className="mt-5"
          aria-busy={pending}
        >
          <fieldset
            disabled={pending}
            className="grid min-w-0 gap-4 md:grid-cols-2"
          >
            <legend className="sr-only">Your inquiry</legend>
            <div className="md:col-span-2">
              <label
                className="block text-sm font-medium"
                htmlFor="contact-category"
              >
                Inquiry type *
                <select
                  id="contact-category"
                  name="issue_type"
                  required
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className={controlClass}
                  aria-invalid={Boolean(state.fieldErrors?.issue_type)}
                  aria-describedby={
                    state.fieldErrors?.issue_type
                      ? "contact-category-error"
                      : undefined
                  }
                >
                  {Object.values(INQUIRY_CATEGORIES).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              {state.fieldErrors?.issue_type ? (
                <p id="contact-category-error" className="mt-2 text-red-200">
                  {state.fieldErrors.issue_type}
                </p>
              ) : null}
            </div>
            {field("name", "Name", { required: true, maxLength: 160 })}
            {field("email", "Email", {
              required: true,
              type: "email",
              maxLength: 320,
            })}
            <div className="md:col-span-2">
              {field("company", "Business name")}
            </div>
            <div className="md:col-span-2">
              {field(
                "message",
                project
                  ? "Problem to solve or project description"
                  : "How can Vaeroex help?",
                {
                  required: true,
                  multiline: true,
                  maxLength: 6000,
                  hint: project
                    ? `Tell us whether you need a new ${category === "Custom Business Systems" ? "system" : "website"} or improvements to an existing one, and what you want it to do.`
                    : undefined,
                },
              )}
            </div>
            {project ? (
              <>
                <div className="md:col-span-2">
                  {field("existing_tools", "Existing software or website", {
                    maxLength: 1000,
                    hint: "Describe the tools you use today, include a website URL if relevant, and tell us what you want to keep or improve.",
                  })}
                </div>
                {category === "Custom Business Systems"
                  ? choice("expected_users", "Approximate expected users", [
                      "1–10",
                      "11–50",
                      "51–200",
                      "More than 200",
                    ])
                  : null}
                {choice("project_budget", "Approximate budget", [
                  "Under $5,000",
                  "$5,000–$15,000",
                  "$15,000–$50,000",
                  "$50,000 or more",
                ])}
                {choice("project_timeline", "Approximate timeline", [
                  "Within a month",
                  "1–3 months",
                  "3–6 months",
                  "More than 6 months",
                ])}
                <p className="text-xs leading-5 text-slate-400 md:col-span-2">
                  Budget ranges help us understand your plans; they are not
                  service prices or quotes.
                </p>
                <p className="text-sm leading-6 text-slate-300 md:col-span-2">
                  {PROJECT_AGREEMENT_NOTICE}
                </p>
              </>
            ) : null}
            <p className="text-xs leading-5 text-slate-400 md:col-span-2">
              Do not include patient data, Social Security numbers, payment card
              numbers, government IDs, or regulated sensitive data.
            </p>
            <div className="md:col-span-2">
              <button
                disabled={pending}
                className="vx-button vx-button--primary disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send inquiry"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
