import { z } from "zod";

import {
  EXTERNAL_INTEGRATION_DECIMAL_LIMITS,
  EXTERNAL_INTEGRATION_LIMITS
} from "@/lib/integrations/contracts/versions";

export const UuidSchema = z.string().uuid();
export const IsoTimestampSchema = z.string().datetime({ offset: true });
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const Sha256FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const TimeZoneSchema = z.string().min(1).max(64).regex(/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/);
export const BoundedIdentifierSchema = z
  .string()
  .min(1)
  .max(EXTERNAL_INTEGRATION_LIMITS.boundedIdentifier)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
export const ProviderEnvironmentKeySchema = BoundedIdentifierSchema;
export const BoundedLabelSchema = z.string().trim().min(1).max(EXTERNAL_INTEGRATION_LIMITS.boundedLabel);
export const BoundedTextSchema = z.string().max(EXTERNAL_INTEGRATION_LIMITS.boundedText);
export const ProviderKeySchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);
export const ContractVersionSchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*_v\d+$/);

const canonicalDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const canonicalIntegerPattern = /^-?(?:0|[1-9]\d*)$/;

export const CanonicalDecimalSchema = z
  .string()
  .regex(canonicalDecimalPattern)
  .refine((value) => value !== "-0", "Negative zero is not canonical");

export const NonNegativeCanonicalDecimalSchema = CanonicalDecimalSchema.refine(
  (value) => !value.startsWith("-"),
  "Value must be non-negative"
);

export const PositiveCanonicalDecimalSchema = CanonicalDecimalSchema.refine(
  (value) => value !== "0" && !value.startsWith("-"),
  "Value must be positive"
);

export const UnitIntervalCanonicalDecimalSchema = NonNegativeCanonicalDecimalSchema.refine(
  (value) => value === "0" || value === "1" || value.startsWith("0."),
  "Value must be between zero and one"
);

export const CanonicalIntegerSchema = z
  .string()
  .regex(canonicalIntegerPattern)
  .refine((value) => value !== "-0", "Negative zero is not canonical");

function fitsNumeric(value: string, precision: number, scale: number) {
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  return integer.length <= precision - scale && fraction.length <= scale;
}

const persistedFactLimits = EXTERNAL_INTEGRATION_DECIMAL_LIMITS.persistedFact;
const persistedExchangeRateLimits = EXTERNAL_INTEGRATION_DECIMAL_LIMITS.persistedExchangeRate;

export const PersistedFactDecimalSchema = CanonicalDecimalSchema.refine(
  (value) => fitsNumeric(value, persistedFactLimits.precision, persistedFactLimits.scale),
  `Value must fit PostgreSQL numeric(${persistedFactLimits.precision},${persistedFactLimits.scale}) without rounding`
);

export const PersistedFactIntegerSchema = CanonicalIntegerSchema.refine(
  (value) => fitsNumeric(value, persistedFactLimits.precision, persistedFactLimits.scale),
  `Value must fit PostgreSQL numeric(${persistedFactLimits.precision},${persistedFactLimits.scale}) without rounding`
);

export const PersistedNonNegativeFactDecimalSchema = PersistedFactDecimalSchema.refine(
  (value) => !value.startsWith("-"),
  "Value must be non-negative"
);

export const PersistedUnitIntervalDecimalSchema = PersistedNonNegativeFactDecimalSchema.refine(
  (value) => value === "0" || value === "1" || value.startsWith("0."),
  "Value must be between zero and one"
);

export const PersistedExchangeRateSchema = CanonicalDecimalSchema.refine(
  (value) => fitsNumeric(value, persistedExchangeRateLimits.precision, persistedExchangeRateLimits.scale),
  `Value must fit PostgreSQL numeric(${persistedExchangeRateLimits.precision},${persistedExchangeRateLimits.scale}) without rounding`
).refine((value) => value !== "0" && !value.startsWith("-"), "Value must be positive");

export type ContractJsonValue =
  | null
  | boolean
  | string
  | number
  | ContractJsonValue[]
  | { [key: string]: ContractJsonValue };

const SafeJsonIntegerSchema = z
  .number()
  .int()
  .refine(Number.isSafeInteger, "JSON numbers must be safe integers");

export const ContractJsonValueSchema: z.ZodType<ContractJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.string(),
    SafeJsonIntegerSchema,
    z.array(ContractJsonValueSchema),
    z.record(ContractJsonValueSchema)
  ])
);

export const ContractJsonObjectSchema = z.record(ContractJsonValueSchema);

export function uniqueStringArray<T extends z.ZodType<string>>(schema: T, max: number) {
  return z.array(schema).max(max).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Values must be unique" });
    }
  });
}
