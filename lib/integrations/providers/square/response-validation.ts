import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  CurrencyCodeSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema
} from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_API_VERSION,
  SQUARE_ENVIRONMENTS,
  SQUARE_PROVIDER_KEY,
  SQUARE_RESPONSE_VALIDATION_VERSION,
  type SquareProviderEnvironmentKey
} from "@/lib/integrations/providers/square/contracts";

export type SquareSafeJsonValue =
  | null
  | boolean
  | string
  | number
  | SquareSafeJsonValue[]
  | { [key: string]: SquareSafeJsonValue };

export type SquareSafeJsonObject = Readonly<Record<string, SquareSafeJsonValue>>;
export type SquareSafeJsonArray = readonly SquareSafeJsonValue[];

export type SquareResponseParserOutcome =
  | "accepted"
  | "rejected"
  | "unsupported"
  | "incompatible-version";

export type SquareResponseDiagnostic = Readonly<{
  code: string;
  field: string;
}>;

export type SquareResponseFailureResult = Readonly<{
  outcome: Exclude<SquareResponseParserOutcome, "accepted">;
  diagnostics: readonly SquareResponseDiagnostic[];
}>;

export type SquareResponseAcceptedResult<T> = Readonly<{
  outcome: "accepted";
  value: T;
  diagnostics: readonly [];
}>;

export type SquareResponseParserResult<T> =
  | SquareResponseAcceptedResult<T>
  | SquareResponseFailureResult;

export type SquareResponseParserInput = Readonly<{
  providerKey: typeof SQUARE_PROVIDER_KEY;
  providerEnvironment: SquareProviderEnvironmentKey;
  apiVersion: typeof SQUARE_API_VERSION;
  response: unknown;
}>;

export type SquareResponseProvenance = Readonly<{
  providerKey: typeof SQUARE_PROVIDER_KEY;
  providerEnvironment: SquareProviderEnvironmentKey;
  apiVersion: typeof SQUARE_API_VERSION;
  validationVersion: typeof SQUARE_RESPONSE_VALIDATION_VERSION;
}>;

type SafeJsonLimits = Readonly<{
  maximumDepth: number;
  maximumArrayLength: number;
  maximumObjectKeys: number;
  maximumKeyLength: number;
  maximumStringLength: number;
  maximumTotalValues: number;
}>;

type SafeJsonState = {
  valueCount: number;
};

const DEFAULT_SAFE_JSON_LIMITS = {
  maximumDepth: 12,
  maximumArrayLength: 1_000,
  maximumObjectKeys: 64,
  maximumKeyLength: 128,
  maximumStringLength: 4_096,
  maximumTotalValues: 20_000
} as const satisfies SafeJsonLimits;

const SQUARE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SQUARE_CURSOR_PATTERN = /^[A-Za-z0-9._~:+/-]+={0,2}$/;
const BCP_47_SHORT_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const SQUARE_API_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const BIDIRECTIONAL_CONTROL_PATTERN = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const HTML_OR_SCRIPT_PATTERN =
  /(?:<\s*\/?\s*[a-z][^>]*>|&lt;\s*\/?\s*[a-z]|javascript\s*:|data\s*:\s*text\/html)/iu;

const POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const SQUARE_COUNTRY_CODES = new Set([
  "ZZ",
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW"
]);

const SQUARE_ENVIRONMENT_KEYS = Object.keys(
  SQUARE_ENVIRONMENTS
) as SquareProviderEnvironmentKey[];

const supportedCurrencyCodes = supportedIntlValues("currency");
const supportedTimeZones = supportedIntlValues("timeZone");

export const SquareProviderEnvironmentSchema = z.enum(["production", "sandbox"]);
export const SquareApiVersionSchema = z.literal(SQUARE_API_VERSION);
export const SquareIdentifierSchema = z
  .string()
  .min(1)
  .max(191)
  .regex(SQUARE_ID_PATTERN);
export const SquarePaginationCursorSchema = z
  .string()
  .min(1)
  .max(4_096)
  .regex(SQUARE_CURSOR_PATTERN);
export const SquareCurrencyCodeSchema = CurrencyCodeSchema.refine(
  isSquareCurrencyCode,
  "Currency must be a supported ISO 4217 code"
);
export const SquareCountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .refine((value) => SQUARE_COUNTRY_CODES.has(value), "Country must be documented");
export const SquareLanguageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(BCP_47_SHORT_PATTERN)
  .transform((value) => canonicalLanguageCode(value));
export const SquareDisplayTextSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !hasUnsafeTrustedText(value), "Display text must be safe")
  );
export const SquareIntegerVersionSchema = z
  .number()
  .int()
  .positive()
  .safe();
export const SquareTimeZoneSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/)
  .refine(isSupportedIanaTimeZone, "Timezone must be a supported IANA zone");
export const SquareResponseProvenanceSchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    apiVersion: SquareApiVersionSchema,
    validationVersion: z.literal(SQUARE_RESPONSE_VALIDATION_VERSION)
  })
  .strict();

export function squareAcceptedResult<T>(
  value: T
): SquareResponseAcceptedResult<T> {
  return { outcome: "accepted", value, diagnostics: [] };
}

export function squareUnsupportedResult(
  code: string,
  field: string
): SquareResponseFailureResult {
  return {
    outcome: "unsupported",
    diagnostics: [safeDiagnostic(code, field)]
  };
}

export function squareFailureResult(error: unknown): SquareResponseFailureResult {
  if (error instanceof SquareResponseIncompatibleVersionFailure) {
    return {
      outcome: "incompatible-version",
      diagnostics: [safeDiagnostic(error.code, error.field)]
    };
  }
  if (error instanceof SquareResponseValidationFailure) {
    return {
      outcome: "rejected",
      diagnostics: [safeDiagnostic(error.code, error.field)]
    };
  }
  return {
    outcome: "rejected",
    diagnostics: [
      safeDiagnostic("square_response_internal_rejection", "$response")
    ]
  };
}

export function squareResponseProvenance(
  input: SquareResponseParserInput
): SquareResponseProvenance {
  return SquareResponseProvenanceSchema.parse({
    providerKey: input.providerKey,
    providerEnvironment: input.providerEnvironment,
    apiVersion: input.apiVersion,
    validationVersion: SQUARE_RESPONSE_VALIDATION_VERSION
  });
}

export function squareResponseParserInput(
  input: unknown
): SquareResponseParserInput {
  const record = squareParserInputRecord(input);
  const providerKey = optionalDataProperty(record, "providerKey") ?? SQUARE_PROVIDER_KEY;
  const providerEnvironment = requiredDataProperty(record, "providerEnvironment");
  const apiVersion = requiredDataProperty(record, "apiVersion");
  const response = requiredDataProperty(record, "response");

  if (providerKey !== SQUARE_PROVIDER_KEY) {
    throw new SquareResponseValidationFailure(
      "square_provider_key_invalid",
      "$input.providerKey"
    );
  }
  if (
    typeof providerEnvironment !== "string" ||
    !SQUARE_ENVIRONMENT_KEYS.includes(
      providerEnvironment as SquareProviderEnvironmentKey
    )
  ) {
    throw new SquareResponseValidationFailure(
      "square_provider_environment_invalid",
      "$input.providerEnvironment"
    );
  }
  if (
    typeof apiVersion !== "string" ||
    !SQUARE_API_VERSION_PATTERN.test(apiVersion) ||
    apiVersion !== SQUARE_API_VERSION
  ) {
    throw new SquareResponseIncompatibleVersionFailure(
      "square_api_version_incompatible",
      "$input.apiVersion"
    );
  }

  return {
    providerKey,
    providerEnvironment: providerEnvironment as SquareProviderEnvironmentKey,
    apiVersion,
    response
  };
}

export function squareSafeJsonObject(
  input: unknown,
  field = "$response",
  limits: SafeJsonLimits = DEFAULT_SAFE_JSON_LIMITS
): SquareSafeJsonObject {
  const value = squareSafeJsonValue(input, field, limits);
  if (!isSquareSafeJsonObject(value)) {
    throw new SquareResponseValidationFailure(
      "square_response_object_expected",
      field
    );
  }
  return value;
}

export function squareSafeJsonArray(
  input: unknown,
  field = "$response",
  limits: SafeJsonLimits = DEFAULT_SAFE_JSON_LIMITS
): SquareSafeJsonArray {
  const value = squareSafeJsonValue(input, field, limits);
  if (!Array.isArray(value)) {
    throw new SquareResponseValidationFailure(
      "square_response_array_expected",
      field
    );
  }
  return value;
}

export function squareRequiredObject(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): SquareSafeJsonObject {
  const value = squareRequiredField(record, key, field);
  if (!isSquareSafeJsonObject(value)) {
    throw new SquareResponseValidationFailure(
      "square_response_object_expected",
      field
    );
  }
  return value;
}

export function squareOptionalNullableObject(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): SquareSafeJsonObject | null {
  return squareOptionalNullableField(record, key, field, (value) => {
    if (!isSquareSafeJsonObject(value)) {
      throw new SquareResponseValidationFailure(
        "square_response_object_expected",
        field
      );
    }
    return value;
  });
}

export function squareRequiredArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
): SquareSafeJsonArray {
  const value = squareRequiredField(record, key, field);
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new SquareResponseValidationFailure(
      "square_response_array_invalid",
      field
    );
  }
  return value;
}

export function squareOptionalNullableArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
): SquareSafeJsonArray | null {
  return squareOptionalNullableField(record, key, field, (value) => {
    if (!Array.isArray(value) || value.length > maximumLength) {
      throw new SquareResponseValidationFailure(
        "square_response_array_invalid",
        field
      );
    }
    return value;
  });
}

export function squareRequiredString(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
): string {
  const value = squareRequiredField(record, key, field);
  return squareBoundedString(value, field, { minimumLength: 1, maximumLength });
}

export function squareOptionalNullableString(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
): string | null {
  return squareOptionalNullableField(record, key, field, (value) =>
    squareBoundedString(value, field, {
      minimumLength: 1,
      maximumLength
    })
  );
}

export function squareRequiredIdentifier(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength = 191
): string {
  const value = squareRequiredString(record, key, field, maximumLength);
  if (!SQUARE_ID_PATTERN.test(value)) {
    throw new SquareResponseValidationFailure(
      "square_identifier_invalid",
      field
    );
  }
  return value;
}

export function squareOptionalNullableIdentifier(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength = 191
): string | null {
  return squareOptionalNullableField(record, key, field, (value) => {
    const candidate = squareBoundedString(value, field, {
      minimumLength: 1,
      maximumLength
    });
    if (!SQUARE_ID_PATTERN.test(candidate)) {
      throw new SquareResponseValidationFailure(
        "square_identifier_invalid",
        field
      );
    }
    return candidate;
  });
}

export function squareOptionalNullableDisplayText(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength = 255
): string | null {
  return squareOptionalNullableField(record, key, field, (value) => {
    if (typeof value !== "string") {
      throw new SquareResponseValidationFailure(
        "square_display_text_invalid",
        field
      );
    }
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (
      trimmed.length > maximumLength ||
      hasUnsafeTrustedText(trimmed)
    ) {
      throw new SquareResponseValidationFailure(
        "square_display_text_invalid",
        field
      );
    }
    return trimmed;
  });
}

export function squareRequiredEnum<T extends string>(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  allowedValues: readonly T[]
): T {
  const value = squareRequiredString(record, key, field, 128);
  if (!allowedValues.includes(value as T)) {
    throw new SquareResponseValidationFailure("square_enum_invalid", field);
  }
  return value as T;
}

export function squareOptionalNullableEnum<T extends string>(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  allowedValues: readonly T[]
): T | null {
  return squareOptionalNullableField(record, key, field, (value) => {
    const candidate = squareBoundedString(value, field, {
      minimumLength: 1,
      maximumLength: 128
    });
    if (!allowedValues.includes(candidate as T)) {
      throw new SquareResponseValidationFailure("square_enum_invalid", field);
    }
    return candidate as T;
  });
}

export function squareOptionalNullableTimestamp(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string | null {
  return squareOptionalNullableField(record, key, field, (value) =>
    squareTimestamp(value, field)
  );
}

export function squareRequiredCountryCode(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string {
  const value = squareRequiredString(record, key, field, 2);
  return squareCountryCode(value, field);
}

export function squareOptionalNullableCountryCode(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string | null {
  return squareOptionalNullableField(record, key, field, (value) =>
    squareCountryCode(value, field)
  );
}

export function squareOptionalNullableCurrencyCode(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string | null {
  return squareOptionalNullableField(record, key, field, (value) =>
    squareCurrencyCode(value, field)
  );
}

export function squareRequiredCurrencyCode(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string {
  const value = squareRequiredField(record, key, field);
  return squareCurrencyCode(value, field);
}

export function squareOptionalNullableLanguageCode(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string | null {
  return squareOptionalNullableField(record, key, field, (value) =>
    squareLanguageCode(value, field)
  );
}

export function squareOptionalNullableTimeZone(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string | null {
  return squareOptionalNullableField(record, key, field, (value) =>
    squareTimeZone(value, field)
  );
}

export function squareEntityVersion(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): number {
  return squareOptionalNullableField(record, key, field, (value) =>
    squareIntegerVersion(value, field)
  ) ?? 1;
}

export function squareIntegerVersion(value: SquareSafeJsonValue, field: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    Object.is(value, -0)
  ) {
    throw new SquareResponseValidationFailure(
      "square_integer_version_invalid",
      field
    );
  }
  return value;
}

export function squarePaginationCursorFingerprint(
  value: SquareSafeJsonValue,
  field: string
) {
  const cursor = squareBoundedString(value, field, {
    minimumLength: 1,
    maximumLength: 4_096
  });
  if (!SQUARE_CURSOR_PATTERN.test(cursor)) {
    throw new SquareResponseValidationFailure(
      "square_pagination_cursor_invalid",
      field
    );
  }
  return Sha256FingerprintSchema.parse(
    contractSha256({
      fingerprintPurpose: "square_response_cursor",
      fingerprintVersion: "square_response_cursor_fingerprint_v1",
      value: cursor
    })
  );
}

export function squareOptionalCursorState(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): { present: true; cursorFingerprint: string } | null {
  return squareOptionalNullableField(record, key, field, (value) => ({
    present: true,
    cursorFingerprint: squarePaginationCursorFingerprint(value, field)
  }));
}

export function squareMinimizedProjectionFingerprint(input: unknown) {
  return Sha256FingerprintSchema.parse(contractSha256(input));
}

function squareSafeJsonValue(
  input: unknown,
  field: string,
  limits: SafeJsonLimits,
  ancestors = new Set<object>(),
  depth = 0,
  state: SafeJsonState = { valueCount: 0 }
): SquareSafeJsonValue {
  state.valueCount += 1;
  if (state.valueCount > limits.maximumTotalValues) {
    throw new SquareResponseValidationFailure(
      "square_response_too_many_values",
      field
    );
  }
  if (depth > limits.maximumDepth) {
    throw new SquareResponseValidationFailure(
      "square_response_nesting_too_deep",
      field
    );
  }
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "string") {
    if (
      input.length > limits.maximumStringLength ||
      hasUnsafeTrustedText(input)
    ) {
      throw new SquareResponseValidationFailure(
        "square_response_string_invalid",
        field
      );
    }
    return input;
  }
  if (typeof input === "number") {
    if (
      !Number.isFinite(input) ||
      Math.abs(input) > Number.MAX_SAFE_INTEGER ||
      Object.is(input, -0)
    ) {
      throw new SquareResponseValidationFailure(
        "square_response_number_invalid",
        field
      );
    }
    return input;
  }
  if (
    typeof input === "undefined" ||
    typeof input === "bigint" ||
    typeof input === "function" ||
    typeof input === "symbol"
  ) {
    throw new SquareResponseValidationFailure(
      "square_response_json_type_invalid",
      field
    );
  }
  if (typeof input !== "object") {
    throw new SquareResponseValidationFailure(
      "square_response_json_type_invalid",
      field
    );
  }
  if (ancestors.has(input)) {
    throw new SquareResponseValidationFailure("square_response_cyclic", field);
  }

  ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      return squareSafeJsonArrayValue(input, field, limits, ancestors, depth, state);
    }
    return squareSafeJsonObjectValue(input, field, limits, ancestors, depth, state);
  } finally {
    ancestors.delete(input);
  }
}

function squareSafeJsonArrayValue(
  input: unknown[],
  field: string,
  limits: SafeJsonLimits,
  ancestors: Set<object>,
  depth: number,
  state: SafeJsonState
): SquareSafeJsonValue[] {
  if (Object.getPrototypeOf(input) !== Array.prototype) {
    throw new SquareResponseValidationFailure(
      "square_response_unexpected_prototype",
      field
    );
  }
  if (input.length > limits.maximumArrayLength) {
    throw new SquareResponseValidationFailure(
      "square_response_array_too_large",
      field
    );
  }
  const allowedKeys = new Set(["length"]);
  for (let index = 0; index < input.length; index += 1) {
    allowedKeys.add(String(index));
    if (!Object.prototype.hasOwnProperty.call(input, index)) {
      throw new SquareResponseValidationFailure(
        "square_response_array_sparse",
        field
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new SquareResponseValidationFailure(
        "square_response_accessor_rejected",
        childField(field, "[]")
      );
    }
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new SquareResponseValidationFailure(
        "square_response_array_custom_property",
        field
      );
    }
  }
  return input.map((item) =>
    squareSafeJsonValue(
      item,
      childField(field, "[]"),
      limits,
      ancestors,
      depth + 1,
      state
    )
  );
}

function squareSafeJsonObjectValue(
  input: object,
  field: string,
  limits: SafeJsonLimits,
  ancestors: Set<object>,
  depth: number,
  state: SafeJsonState
): SquareSafeJsonObject {
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SquareResponseValidationFailure(
      "square_response_unexpected_prototype",
      field
    );
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > limits.maximumObjectKeys) {
    throw new SquareResponseValidationFailure(
      "square_response_object_too_large",
      field
    );
  }
  const output: Record<string, SquareSafeJsonValue> = {};
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new SquareResponseValidationFailure(
        "square_response_symbol_key_rejected",
        field
      );
    }
    if (
      key.length < 1 ||
      key.length > limits.maximumKeyLength ||
      CONTROL_CHARACTER_PATTERN.test(key) ||
      BIDIRECTIONAL_CONTROL_PATTERN.test(key) ||
      POLLUTION_KEYS.has(key)
    ) {
      throw new SquareResponseValidationFailure(
        "square_response_key_invalid",
        childField(field, "*")
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new SquareResponseValidationFailure(
        "square_response_accessor_rejected",
        childField(field, key)
      );
    }
    output[key] = squareSafeJsonValue(
      descriptor.value,
      childField(field, key),
      limits,
      ancestors,
      depth + 1,
      state
    );
  }
  return output;
}

function squareParserInputRecord(input: unknown): Readonly<Record<string, unknown>> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new SquareResponseValidationFailure(
      "square_parser_input_invalid",
      "$input"
    );
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SquareResponseValidationFailure(
      "square_parser_input_invalid",
      "$input"
    );
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || POLLUTION_KEYS.has(key)) {
      throw new SquareResponseValidationFailure(
        "square_parser_input_invalid",
        "$input"
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new SquareResponseValidationFailure(
        "square_parser_input_invalid",
        "$input"
      );
    }
  }
  return input as Readonly<Record<string, unknown>>;
}

function requiredDataProperty(
  record: Readonly<Record<string, unknown>>,
  key: string
) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    throw new SquareResponseValidationFailure(
      "square_parser_input_invalid",
      `$input.${key}`
    );
  }
  return descriptor.value;
}

function optionalDataProperty(
  record: Readonly<Record<string, unknown>>,
  key: string
) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new SquareResponseValidationFailure(
      "square_parser_input_invalid",
      `$input.${key}`
    );
  }
  return descriptor.value;
}

function squareRequiredField(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new SquareResponseValidationFailure(
      "square_required_field_missing",
      field
    );
  }
  const value = record[key];
  if (value === null) {
    throw new SquareResponseValidationFailure(
      "square_required_field_missing",
      field
    );
  }
  return value;
}

function squareOptionalNullableField<T>(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  parser: (value: SquareSafeJsonValue) => T
): T | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return null;
  const value = record[key];
  if (value === null) return null;
  return parser(value);
}

function squareBoundedString(
  value: SquareSafeJsonValue,
  field: string,
  options: Readonly<{ minimumLength: number; maximumLength: number }>
) {
  if (typeof value !== "string") {
    throw new SquareResponseValidationFailure(
      "square_response_string_invalid",
      field
    );
  }
  if (
    value.length < options.minimumLength ||
    value.length > options.maximumLength ||
    hasUnsafeTrustedText(value)
  ) {
    throw new SquareResponseValidationFailure(
      "square_response_string_invalid",
      field
    );
  }
  return value;
}

function squareTimestamp(value: SquareSafeJsonValue, field: string) {
  const candidate = squareBoundedString(value, field, {
    minimumLength: 20,
    maximumLength: 35
  });
  try {
    IsoTimestampSchema.parse(candidate);
  } catch {
    throw new SquareResponseValidationFailure(
      "square_timestamp_invalid",
      field
    );
  }
  if (!Number.isFinite(Date.parse(candidate))) {
    throw new SquareResponseValidationFailure(
      "square_timestamp_invalid",
      field
    );
  }
  return candidate;
}

function squareCountryCode(value: SquareSafeJsonValue, field: string) {
  const candidate = squareBoundedString(value, field, {
    minimumLength: 2,
    maximumLength: 2
  });
  if (!/^[A-Z]{2}$/.test(candidate) || !SQUARE_COUNTRY_CODES.has(candidate)) {
    throw new SquareResponseValidationFailure(
      "square_country_invalid",
      field
    );
  }
  return candidate;
}

function squareCurrencyCode(value: SquareSafeJsonValue, field: string) {
  const candidate = squareBoundedString(value, field, {
    minimumLength: 3,
    maximumLength: 3
  });
  try {
    CurrencyCodeSchema.parse(candidate);
  } catch {
    throw new SquareResponseValidationFailure(
      "square_currency_invalid",
      field
    );
  }
  if (!isSquareCurrencyCode(candidate)) {
    throw new SquareResponseValidationFailure(
      "square_currency_invalid",
      field
    );
  }
  return candidate;
}

function squareLanguageCode(value: SquareSafeJsonValue, field: string) {
  const candidate = squareBoundedString(value, field, {
    minimumLength: 2,
    maximumLength: 16
  });
  if (!BCP_47_SHORT_PATTERN.test(candidate)) {
    throw new SquareResponseValidationFailure(
      "square_language_code_invalid",
      field
    );
  }
  try {
    return canonicalLanguageCode(candidate);
  } catch {
    throw new SquareResponseValidationFailure(
      "square_language_code_invalid",
      field
    );
  }
}

function squareTimeZone(value: SquareSafeJsonValue, field: string) {
  const candidate = squareBoundedString(value, field, {
    minimumLength: 1,
    maximumLength: 30
  });
  if (
    !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(candidate) ||
    !isSupportedIanaTimeZone(candidate)
  ) {
    throw new SquareResponseValidationFailure(
      "square_timezone_invalid",
      field
    );
  }
  return candidate;
}

function canonicalLanguageCode(value: string) {
  const canonical = Intl.getCanonicalLocales([value]);
  if (canonical.length !== 1) {
    throw new TypeError("invalid_language_code");
  }
  return canonical[0];
}

function isSquareSafeJsonObject(
  value: SquareSafeJsonValue
): value is SquareSafeJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function childField(field: string, key: string) {
  if (key === "[]") return `${field}[]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `${field}.${key}`;
  return `${field}.*`;
}

function safeDiagnostic(code: string, field: string): SquareResponseDiagnostic {
  return {
    code: code.replace(/[^a-z0-9_:-]/gi, "_").slice(0, 96),
    field: field.replace(/[^A-Za-z0-9_$.[\]*-]/g, "*").slice(0, 160)
  };
}

function hasUnsafeTrustedText(value: string) {
  return (
    CONTROL_CHARACTER_PATTERN.test(value) ||
    BIDIRECTIONAL_CONTROL_PATTERN.test(value) ||
    HTML_OR_SCRIPT_PATTERN.test(value)
  );
}

function supportedIntlValues(key: "currency" | "timeZone"): ReadonlySet<string> | null {
  try {
    if (typeof Intl.supportedValuesOf !== "function") return null;
    return new Set(Intl.supportedValuesOf(key));
  } catch {
    return null;
  }
}

function isSquareCurrencyCode(value: string) {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  return supportedCurrencyCodes === null || supportedCurrencyCodes.has(value);
}

function isSupportedIanaTimeZone(value: string) {
  if (supportedTimeZones === null) {
    try {
      const resolved = new Intl.DateTimeFormat("en-US", {
        timeZone: value
      }).resolvedOptions().timeZone;
      return resolved === value;
    } catch {
      return false;
    }
  }
  return supportedTimeZones.has(value);
}

class SquareResponseValidationFailure extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string) {
    super("square_response_validation_failed");
    this.name = "SquareResponseValidationFailure";
    this.code = code;
    this.field = field;
  }
}

class SquareResponseIncompatibleVersionFailure extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string) {
    super("square_response_api_version_incompatible");
    this.name = "SquareResponseIncompatibleVersionFailure";
    this.code = code;
    this.field = field;
  }
}
