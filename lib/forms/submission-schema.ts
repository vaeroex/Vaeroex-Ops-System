export const FORM_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const MAX_FORM_FIELDS = 50;
export const MAX_FIELD_LENGTH = 2000;
export type SubmissionField = { key: string; label: string; type: "text" | "date" | "priority"; required: boolean };

export function parseSubmissionSchema(value: unknown): SubmissionField[] {
  if (!Array.isArray(value) || value.length > MAX_FORM_FIELDS) throw new Error("This form has an unsupported schema. Ask a workspace administrator to review it.");
  const seen = new Set<string>();
  return value.map((field) => {
    if (!field || typeof field !== "object" || typeof field.key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(field.key) || ["__proto__", "constructor", "prototype"].includes(field.key) || seen.has(field.key) || typeof field.label !== "string" || !field.label.trim() || field.label.length > 120 || !["text", "date", "priority"].includes(field.type) || typeof field.required !== "boolean") {
      throw new Error("This form has an unsupported schema. Ask a workspace administrator to review it.");
    }
    seen.add(field.key);
    return { key: field.key, label: field.label, type: field.type, required: field.required };
  });
}

export function createSubmissionSchema(fieldLines: string): SubmissionField[] {
  const labels = fieldLines.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!labels.length) labels.push("Submitted by", "Business details", "Priority", "Manager notes");
  if (labels.length > MAX_FORM_FIELDS || labels.some((label) => label.length > 120)) throw new Error("Use at most 50 form fields, with labels of 120 characters or fewer.");
  const used = new Set<string>();
  return labels.map((label, index) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 110) || "field";
    let key = base;
    let suffix = 1;
    while (used.has(key) || ["constructor", "prototype"].includes(key)) key = `${base}-${suffix++}`;
    used.add(key);
    return { key, label, type: label.toLowerCase().includes("priority") ? "priority" : label.toLowerCase().includes("date") ? "date" : "text", required: index < 2 };
  });
}

export function validateSubmissionFields(schema: SubmissionField[], data: FormData): Record<string, string> {
  const allowed = new Set(schema.map((field) => `field:${field.key}`));
  for (const name of data.keys()) {
    if (name.startsWith("field:") && !allowed.has(name)) throw new Error("The form fields have changed. Refresh the form and try again.");
  }
  const values: Record<string, string> = {};
  let totalLength = 0;
  for (const field of schema) {
    const entries = data.getAll(`field:${field.key}`);
    if (entries.length > 1 || entries.some((entry) => typeof entry !== "string")) throw new Error(`${field.label} must have one text value.`);
    const value = typeof entries[0] === "string" ? entries[0].trim() : "";
    if (field.required && !value) throw new Error(`${field.label} is required.`);
    if (value.length > MAX_FIELD_LENGTH) throw new Error(`${field.label} must be ${MAX_FIELD_LENGTH} characters or fewer.`);
    if (value && field.type === "priority" && !FORM_PRIORITIES.includes(value)) throw new Error(`${field.label} must be a listed priority.`);
    if (value && field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new Error(`${field.label} must be a valid date.`);
    totalLength += value.length;
    values[field.key] = value;
  }
  if (totalLength > 50000) throw new Error("The form response is too long. Use 50,000 characters or fewer across its fields.");
  return values;
}
