import type { ReactNode } from "react";

export function TextInput({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  placeholder?: string;
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
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
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
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
      />
    </label>
  );
}

export function SelectInput({
  label,
  name,
  options,
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
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
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
  return <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">{children}</button>;
}
