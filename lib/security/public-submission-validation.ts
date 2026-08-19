import { z } from "zod";

export const PUBLIC_FORM_MAX_BODY_BYTES = 24 * 1024;
export const SUPPORT_FORM_MAX_BODY_BYTES = 20 * 1024;
export const ACTIVATION_FORM_MAX_BODY_BYTES = 8 * 1024;

const supportIssueTypes = [
  "Subscription access",
  "Workspace setup",
  "Intelligence result",
  "Vaeroex result",
  "Bug or error",
  "Billing question",
  "Other",
  "Demo request",
  "Product Demo",
  "Contact request",
  "General Question",
  "General Inquiry",
  "Platform Questions",
  "Support Request",
  "Network Interest",
  "Strategic Partnership",
  "Advisor Interest",
  "Investor / Strategic Relationship",
  "Implementation Partner",
  "Partnership Opportunities",
  "Business Inquiry",
  "Billing or Subscription"
] as const;

const priorities = ["Low", "Medium", "High", "Urgent"] as const;
const email = z.string().trim().toLowerCase().email().max(320);
const optionalText = (max: number) => z.string().trim().max(max).default("");

export const supportRequestSchema = z
  .object({
    return_path: optionalText(120),
    name: z.string().trim().min(1).max(160),
    email,
    issue_type: z.enum(supportIssueTypes),
    message: z.string().trim().min(1).max(6000),
    priority: z.enum(priorities).default("Medium"),
    workspace: optionalText(200),
    workspace_id: optionalText(80),
    page_module: optionalText(160),
    company: optionalText(200),
    role: optionalText(120),
    business_type: optionalText(120),
    team_size: optionalText(80),
    improvement_goal: optionalText(1000),
    preferred_contact_method: optionalText(80)
  })
  .strict();

export const manualActivationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email,
    company: optionalText(200),
    plan_purchased: optionalText(120),
    order_number: optionalText(120),
    message: optionalText(2000)
  })
  .strict();

const publicFormValueSchema = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);

export const publicFormSubmissionSchema = z
  .object({
    submitter_name: optionalText(160),
    submitter_email: z.union([email, z.literal("")]).default(""),
    fields: z.record(z.string(), publicFormValueSchema),
    website: optionalText(200)
  })
  .strict();

export class PublicSubmissionValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PublicSubmissionValidationError";
    this.status = status;
  }
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertContentLength(request: Request, maximumBytes: number) {
  const contentLength = request.headers.get("content-length");

  if (!contentLength) return;

  const parsed = Number(contentLength);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximumBytes) {
    throw new PublicSubmissionValidationError("The submitted request is too large.", 413);
  }
}

async function readBoundedRequestText(request: Request, maximumBytes: number) {
  assertContentLength(request, maximumBytes);
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let value = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new PublicSubmissionValidationError("The submitted request is too large.", 413);
    }
    value += decoder.decode(chunk.value, { stream: true });
  }

  return value + decoder.decode();
}

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const text = await readBoundedRequestText(request, maximumBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicSubmissionValidationError("The submitted request is not valid JSON.");
  }
}

export async function readBoundedUrlEncodedFormData(request: Request, maximumBytes: number) {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new PublicSubmissionValidationError("The submitted form format is not supported.", 415);
  }

  const parameters = new URLSearchParams(await readBoundedRequestText(request, maximumBytes));
  const formData = new FormData();
  for (const [key, value] of parameters) formData.append(key, value);
  return formData;
}

export function boundedFormData(
  formData: FormData,
  allowedKeys: readonly string[],
  maximumBytes: number
): Record<string, string> {
  const allowed = new Set(allowedKeys);
  const values: Record<string, string> = {};
  let totalBytes = 0;
  let entryCount = 0;

  for (const [key, rawValue] of formData.entries()) {
    entryCount += 1;
    if (entryCount > allowed.size + 8) {
      throw new PublicSubmissionValidationError("The submitted request contains too many fields.");
    }
    if (typeof rawValue !== "string") {
      throw new PublicSubmissionValidationError("File attachments are not accepted through this form.");
    }

    totalBytes += byteLength(key) + byteLength(rawValue);
    if (totalBytes > maximumBytes) {
      throw new PublicSubmissionValidationError("The submitted request is too large.", 413);
    }

    if (key.startsWith("$ACTION_")) continue;
    if (!allowed.has(key) || Object.prototype.hasOwnProperty.call(values, key)) {
      throw new PublicSubmissionValidationError("The submitted request contains unsupported fields.");
    }

    values[key] = rawValue;
  }

  return values;
}

type PublicFormDefinition = {
  key: string;
  required: boolean;
};

function publicFormDefinition(schemaJson: unknown): PublicFormDefinition[] {
  if (!Array.isArray(schemaJson) || schemaJson.length > 40) {
    throw new PublicSubmissionValidationError("This public form is not available.", 404);
  }

  const definitions = schemaJson.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new PublicSubmissionValidationError("This public form is not available.", 404);
    }

    const key = "key" in entry && typeof entry.key === "string" ? entry.key.trim() : "";
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(key)) {
      throw new PublicSubmissionValidationError("This public form is not available.", 404);
    }

    return { key, required: "required" in entry && entry.required === true };
  });

  if (new Set(definitions.map((definition) => definition.key)).size !== definitions.length) {
    throw new PublicSubmissionValidationError("This public form is not available.", 404);
  }

  return definitions;
}

export function validatePublicFormFields(fields: Record<string, string | number | boolean | null>, schemaJson: unknown) {
  const definitions = publicFormDefinition(schemaJson);
  const allowed = new Set(definitions.map((definition) => definition.key));
  const suppliedKeys = Object.keys(fields);

  if (suppliedKeys.length > 40 || suppliedKeys.some((key) => !allowed.has(key))) {
    throw new PublicSubmissionValidationError("The submitted form contains unsupported fields.");
  }

  let textBytes = 0;
  for (const value of Object.values(fields)) {
    if (typeof value === "string") textBytes += byteLength(value);
  }
  if (textBytes > 12 * 1024) {
    throw new PublicSubmissionValidationError("The submitted form is too large.", 413);
  }

  for (const definition of definitions) {
    if (!definition.required) continue;
    if (!Object.prototype.hasOwnProperty.call(fields, definition.key)) {
      throw new PublicSubmissionValidationError("Complete all required form fields.");
    }
    const value = fields[definition.key];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      throw new PublicSubmissionValidationError("Complete all required form fields.");
    }
  }

  return Object.fromEntries(suppliedKeys.map((key) => [key, fields[key]]));
}

export const SUPPORT_REQUEST_KEYS = Object.keys(supportRequestSchema.shape);
export const MANUAL_ACTIVATION_REQUEST_KEYS = Object.keys(manualActivationRequestSchema.shape);
