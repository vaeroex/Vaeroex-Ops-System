import type { ReactNode } from "react";

export function TextInput({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  step,
  min
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  placeholder?: string;
  step?: string;
  min?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        step={step}
        min={min}
        className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent focus:ring-2 focus:ring-vaeroex-accent/20"
      />
    </label>
  );
}

export function TextArea({
  label,
  name,
  required = false,
  defaultValue,
  placeholder,
  rows = 3
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string | null;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <textarea
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        rows={rows}
        className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent focus:ring-2 focus:ring-vaeroex-accent/20"
      />
    </label>
  );
}

export function SelectInput({
  label,
  name,
  options: options,
  defaultValue,
  required = false
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue?: string | null;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-vaeroex-accent focus:ring-2 focus:ring-vaeroex-accent/20"
      >
        <option value="">Choose...</option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

export function PrimaryButton({ children }: { children: ReactNode }) {
  return <button className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-900/10 hover:bg-blue-950/70 hover:text-white hover:ring-1 hover:ring-vaeroex-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">{children}</button>;
}
