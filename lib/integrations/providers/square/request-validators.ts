import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  ContractJsonObjectSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  type ContractJsonValue
} from "@/lib/integrations/contracts/primitives";
import type { ProviderDescriptor } from "@/lib/integrations/contracts/provider-adapter";
import {
  assertDeclaredReadOnlyPostOperation,
  providerReadOnlyPostValidatorRegistryKey,
  type ProviderReadOnlyPostOperationDecision,
  type ProviderReadOnlyPostRequestValidationInput,
  type ProviderReadOnlyPostRequestValidationResult,
  type ProviderReadOnlyPostRequestValidator,
  type ProviderReadOnlyPostRequestValidatorRegistry
} from "@/lib/integrations/provider-runtime/read-only-operation-policy";
import {
  SQUARE_ALLOWED_CATALOG_OBJECT_TYPES,
  SQUARE_ALLOWED_INVENTORY_CHANGE_TYPES,
  SQUARE_ALLOWED_INVENTORY_STATES,
  SQUARE_ALLOWED_ORDER_SORT_FIELDS,
  SQUARE_ALLOWED_ORDER_STATES,
  SQUARE_ALLOWED_PAYMENT_SORT_FIELDS,
  SQUARE_ALLOWED_PAYMENT_SOURCE_TYPES,
  SQUARE_ALLOWED_REFUND_STATUSES,
  SQUARE_ALLOWED_SORT_ORDERS,
  SQUARE_API_VERSION,
  SQUARE_ENVIRONMENTS,
  SQUARE_GET_OPERATIONS,
  SQUARE_MINIMUM_READ_SCOPES,
  SQUARE_PROVIDER_KEY,
  SQUARE_READ_ONLY_POST_OPERATIONS,
  SQUARE_WRITE_OR_DEFERRED_SCOPE_PATTERNS,
  type SquareMinimumReadScope,
  type SquareProviderEnvironmentKey
} from "@/lib/integrations/providers/square/contracts";
import { SQUARE_PROVIDER_DESCRIPTOR } from "@/lib/integrations/providers/square/descriptor";

const SQUARE_READ_OPERATION_POLICY_VERSION =
  "square_read_operation_policy_v1" as const;

type ContractJsonObject = Readonly<Record<string, ContractJsonValue>>;
type MutableContractJsonObject = Record<string, ContractJsonValue>;

export type SquareHeaderValue =
  | string
  | readonly string[]
  | undefined
  | null;

export type SquareHeaderMap = Readonly<Record<string, SquareHeaderValue>>;

export type SquareReadOperationAuthorizationInput = Readonly<{
  providerKey: string;
  providerEnvironment: string;
  method: string;
  url: string;
  headers: SquareHeaderMap;
  body?: string | Uint8Array | null;
  expectedCursorBindingFingerprint?: string | null;
  retryAttempt?: Readonly<{
    attempt: number;
    priorRetryClassification?: "non_retryable_read" | "idempotent_read_with_backoff";
  }>;
}>;

export type SquareReadOperationDecision = Readonly<{
  policyVersion: typeof SQUARE_READ_OPERATION_POLICY_VERSION;
  readOnly: true;
  providerKey: typeof SQUARE_PROVIDER_KEY;
  providerEnvironment: SquareProviderEnvironmentKey;
  operationKey: string;
  hostname: string;
  pathTemplate: string;
  method: "GET" | "POST";
  squareVersion: typeof SQUARE_API_VERSION;
  contentType: "application/json" | null;
  maximumResponseBytes: number;
  timeoutMs: number;
  retryClassification: "non_retryable_read" | "idempotent_read_with_backoff";
  redirectPolicy: "manual";
  requestValidatorKey: string | null;
  requestFingerprint: string;
  cursorBindingFingerprint: string;
  providerReadOnlyPostPolicyVersion?: ProviderReadOnlyPostOperationDecision["policyVersion"];
}>;

type ParsedSquareUrl = Readonly<{
  hostname: string;
  rawPath: string;
  queryParameters: readonly (readonly [string, string])[];
}>;

type NormalizedRequest = Readonly<{
  normalizedQueryParameters: ContractJsonObject;
  normalizedBody: ContractJsonObject;
  normalizedCursorBindingQueryParameters: ContractJsonObject;
  normalizedCursorBindingBody: ContractJsonObject;
  cursorPresent: boolean;
}>;

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const DIGITS_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/;

const ROUTING_OR_SECRET_KEYS = new Set([
  "access_token",
  "api_version",
  "authorization",
  "authorization_code",
  "bearer",
  "callback",
  "client_secret",
  "code",
  "environment",
  "headers",
  "host",
  "hostname",
  "method",
  "origin",
  "path",
  "pathname",
  "provider",
  "provider_environment",
  "provider_key",
  "providerenvironment",
  "providerkey",
  "redirect_uri",
  "refresh_token",
  "square-version",
  "square_version",
  "token",
  "uri",
  "url",
  "version"
]);

const WRITE_SHAPED_KEYS = new Set([
  "amount_money",
  "autocomplete",
  "catalog_object",
  "changes",
  "customer_id",
  "idempotency_key",
  "objects",
  "payment",
  "refund",
  "source_id"
]);

function deny(): never {
  throw new Error("square_read_operation_denied");
}

function safeFingerprint(label: string, value: unknown) {
  return contractSha256({
    fingerprintPurpose: "square_request_value",
    fingerprintVersion: "square_request_value_fingerprint_v1",
    label,
    value
  });
}

function isRecord(value: unknown): value is Record<string, ContractJsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectKeys(value: ContractJsonObject) {
  return Object.keys(value).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}

function requireAllowedKeys(
  value: ContractJsonObject,
  allowedKeys: readonly string[]
) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) deny();
  }
}

function assertNoForbiddenKeys(value: ContractJsonValue): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      ROUTING_OR_SECRET_KEYS.has(normalizedKey) ||
      WRITE_SHAPED_KEYS.has(normalizedKey)
    ) {
      deny();
    }
    assertNoForbiddenKeys(nested);
  }
}

function stringValue(value: ContractJsonValue, maximumLength = 255) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    deny();
  }
  return value;
}

function idValue(value: ContractJsonValue) {
  const candidate = stringValue(value, 191);
  if (!ID_PATTERN.test(candidate)) deny();
  return candidate;
}

function cursorValue(value: ContractJsonValue) {
  const candidate = stringValue(value, 4096);
  if (!CURSOR_PATTERN.test(candidate)) deny();
  return candidate;
}

function integerValue(value: ContractJsonValue, minimum: number, maximum: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    deny();
  }
  return value;
}

function booleanValue(value: ContractJsonValue) {
  if (typeof value !== "boolean") deny();
  return value;
}

function optionalBoolean(
  output: MutableContractJsonObject,
  key: string,
  value: ContractJsonObject
) {
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    output[key] = booleanValue(value[key]);
  }
}

function rfc3339Value(value: ContractJsonValue) {
  const candidate = stringValue(value, 34);
  try {
    IsoTimestampSchema.parse(candidate);
  } catch {
    deny();
  }
  if (!Number.isFinite(Date.parse(candidate))) deny();
  return candidate;
}

function enumValue<T extends string>(
  value: ContractJsonValue,
  allowedValues: readonly T[]
) {
  const candidate = stringValue(value, 128);
  if (!allowedValues.includes(candidate as T)) deny();
  return candidate as T;
}

function arrayOfStrings(
  value: ContractJsonValue,
  options: Readonly<{
    minimum: number;
    maximum: number;
    item: "id" | "cursor" | "enum" | "search";
    enumValues?: readonly string[];
  }>
) {
  if (!Array.isArray(value)) deny();
  if (value.length < options.minimum || value.length > options.maximum) deny();
  const normalized = value.map((item) => {
    if (options.item === "id") return idValue(item);
    if (options.item === "cursor") return cursorValue(item);
    if (options.item === "enum") {
      if (!options.enumValues) deny();
      return enumValue(item, options.enumValues);
    }
    return stringValue(item, 255);
  });
  if (new Set(normalized).size !== normalized.length) deny();
  return normalized;
}

function redactedStringSet(label: string, values: readonly string[]) {
  return {
    count: values.length,
    fingerprints: values
      .map((value) => safeFingerprint(label, value))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  } satisfies ContractJsonObject;
}

function redactedString(label: string, value: string) {
  return {
    fingerprint: safeFingerprint(label, value)
  } satisfies ContractJsonObject;
}

function optionalCursor(
  output: MutableContractJsonObject,
  _bindingOutput: MutableContractJsonObject,
  value: ContractJsonObject
) {
  const rawCursor = value.cursor;
  if (rawCursor === undefined) return false;
  const cursor = cursorValue(rawCursor);
  output.cursor = redactedString("cursor", cursor);
  return true;
}

function parseJsonBody(body: string | Uint8Array, maximumBytes: number) {
  const rawBodyByteLength =
    typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
  if (rawBodyByteLength <= 0 || rawBodyByteLength > maximumBytes) deny();
  const bodyText =
    typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    deny();
  }
  try {
    const checked = ContractJsonObjectSchema.parse(parsed);
    assertNoForbiddenKeys(checked);
    return checked;
  } catch {
    deny();
  }
}

function requireNoQueryParameters(
  queryParameters: readonly (readonly [string, string])[]
) {
  if (queryParameters.length > 0) deny();
}

function normalizeContentType(contentType: string) {
  const [mediaType, ...parameterParts] = contentType.split(";");
  if (mediaType.trim().toLowerCase() !== "application/json") deny();
  for (const rawParameter of parameterParts) {
    const parameter = rawParameter.trim();
    if (parameter === "") deny();
    const equalsIndex = parameter.indexOf("=");
    if (equalsIndex <= 0 || equalsIndex !== parameter.lastIndexOf("=")) deny();
    const key = parameter.slice(0, equalsIndex).trim().toLowerCase();
    const rawValue = parameter.slice(equalsIndex + 1).trim();
    if (
      (rawValue.startsWith("\"") && !rawValue.endsWith("\"")) ||
      (!rawValue.startsWith("\"") && rawValue.endsWith("\""))
    ) {
      deny();
    }
    const value = rawValue.replace(/^"|"$/g, "").toLowerCase();
    if (key !== "charset" || (value !== "utf-8" && value !== "utf8")) deny();
  }
  return "application/json" as const;
}

function headerValue(headers: SquareHeaderMap, name: string) {
  const matches = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === name
  );
  if (matches.length !== 1) deny();
  const value = matches[0][1];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }
  deny();
}

function optionalHeaderValue(headers: SquareHeaderMap, name: string) {
  const matches = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === name
  );
  if (matches.length > 1) deny();
  if (matches.length === 0) return null;
  const value = matches[0][1];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }
  deny();
}

function requireSquareVersion(headers: SquareHeaderMap) {
  if (headerValue(headers, "square-version") !== SQUARE_API_VERSION) deny();
}

function parseExactSquareUrl(urlText: string): ParsedSquareUrl {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)?(?:\?([^#]*))?(?:#.*)?$/.exec(
    urlText
  );
  if (!match) deny();
  const [, rawScheme, rawAuthority, rawPath = "", rawQuery] = match;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    deny();
  }
  const rawPathname = rawPath === "" ? "/" : rawPath;
  if (
    rawScheme !== "https" ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "" ||
    rawAuthority.includes("@") ||
    rawAuthority.includes(":") ||
    rawAuthority.includes("%") ||
    rawAuthority.endsWith(".") ||
    rawAuthority !== url.hostname
  ) {
    deny();
  }
  if (
    rawPathname.includes("%") ||
    rawPathname.includes("\\") ||
    rawPathname.includes("//") ||
    rawPathname.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    deny();
  }
  if (rawQuery?.includes("%") || rawQuery?.includes("\\") || rawQuery?.includes("#")) {
    deny();
  }
  const queryParameters = parseRawQuery(rawQuery ?? "");
  return {
    hostname: url.hostname,
    rawPath: rawPathname,
    queryParameters
  };
}

function parseRawQuery(rawQuery: string) {
  if (rawQuery === "") return [];
  return rawQuery.split("&").map((part) => {
    if (part === "") deny();
    const equalsIndex = part.indexOf("=");
    if (equalsIndex <= 0) deny();
    const key = part.slice(0, equalsIndex);
    const value = part.slice(equalsIndex + 1);
    if (
      key.length < 1 ||
      key.length > 64 ||
      value.length < 1 ||
      value.length > 4096 ||
      !/^[A-Za-z0-9_]+$/.test(key) ||
      /[\u0000-\u001F\u007F]/.test(value)
    ) {
      deny();
    }
    return [key, value] as const;
  });
}

function parseQueryMap(
  queryParameters: readonly (readonly [string, string])[],
  allowedKeys: readonly string[]
) {
  const allowed = new Set(allowedKeys);
  const seen = new Set<string>();
  const map: Record<string, string> = {};
  for (const [key, value] of queryParameters) {
    if (!allowed.has(key) || seen.has(key)) deny();
    seen.add(key);
    map[key] = value;
  }
  return map;
}

function parseBooleanQuery(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  deny();
}

function parseLimitQuery(value: string, maximum: number) {
  if (!/^[1-9][0-9]{0,3}$/.test(value)) deny();
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) deny();
  return parsed;
}

function parseIntegerQuery(value: string) {
  if (!DIGITS_PATTERN.test(value)) deny();
  return redactedString("integer", value);
}

function parseCursorQuery(value: string) {
  if (!CURSOR_PATTERN.test(value)) deny();
  return redactedString("cursor", value);
}

function parseIdQuery(value: string) {
  if (!ID_PATTERN.test(value)) deny();
  return redactedString("id", value);
}

function parseTimestampQuery(value: string) {
  rfc3339Value(value);
  return redactedString("timestamp", value);
}

function parseCommaSeparatedIds(value: string, maximum: number) {
  const values = value.split(",");
  if (values.length < 1 || values.length > maximum) deny();
  for (const item of values) {
    if (!ID_PATTERN.test(item)) deny();
  }
  if (new Set(values).size !== values.length) deny();
  return redactedStringSet("id_set", values);
}

function parseCommaSeparatedCatalogTypes(value: string) {
  const values = value.split(",");
  if (values.length < 1 || values.length > SQUARE_ALLOWED_CATALOG_OBJECT_TYPES.length) {
    deny();
  }
  for (const item of values) {
    if (!SQUARE_ALLOWED_CATALOG_OBJECT_TYPES.includes(item as never)) deny();
  }
  if (new Set(values).size !== values.length) deny();
  return {
    count: values.length,
    values: [...values].sort()
  } satisfies ContractJsonObject;
}

function normalizeGetQuery(operationKey: string, queryParameters: readonly (readonly [string, string])[]) {
  if (
    operationKey === "retrieve_merchant" ||
    operationKey === "list_locations" ||
    operationKey === "retrieve_location" ||
    operationKey === "retrieve_order" ||
    operationKey === "retrieve_payment" ||
    operationKey === "retrieve_payment_refund" ||
    operationKey === "retrieve_inventory_adjustment" ||
    operationKey === "retrieve_inventory_physical_count"
  ) {
    if (queryParameters.length > 0) deny();
    return {
      normalizedQueryParameters: {},
      normalizedCursorBindingQueryParameters: {},
      cursorPresent: false
    } as const;
  }
  if (operationKey === "list_merchants") {
    const query = parseQueryMap(queryParameters, ["cursor"]);
    const normalized: MutableContractJsonObject = {};
    const binding: MutableContractJsonObject = {};
    let cursorPresent = false;
    if (query.cursor !== undefined) {
      normalized.cursor = parseCursorQuery(query.cursor);
      cursorPresent = true;
    }
    return {
      normalizedQueryParameters: normalized,
      normalizedCursorBindingQueryParameters: binding,
      cursorPresent
    } as const;
  }
  if (operationKey === "list_payments") {
    const query = parseQueryMap(queryParameters, [
      "begin_time",
      "end_time",
      "sort_order",
      "cursor",
      "location_id",
      "total",
      "limit",
      "is_offline_payment",
      "offline_begin_time",
      "offline_end_time",
      "updated_at_begin_time",
      "updated_at_end_time",
      "sort_field"
    ]);
    const normalized = normalizeTimeWindowListQuery(query, 100);
    if (query.total !== undefined) normalized.normalizedQueryParameters.total = parseIntegerQuery(query.total);
    if (query.is_offline_payment !== undefined) {
      normalized.normalizedQueryParameters.is_offline_payment = parseBooleanQuery(query.is_offline_payment);
    }
    if (query.offline_begin_time !== undefined) {
      normalized.normalizedQueryParameters.offline_begin_time = parseTimestampQuery(query.offline_begin_time);
    }
    if (query.offline_end_time !== undefined) {
      normalized.normalizedQueryParameters.offline_end_time = parseTimestampQuery(query.offline_end_time);
    }
    if (query.sort_field !== undefined) {
      normalized.normalizedQueryParameters.sort_field = enumValue(
        query.sort_field,
        SQUARE_ALLOWED_PAYMENT_SORT_FIELDS
      );
    }
    return normalized;
  }
  if (operationKey === "list_payment_refunds") {
    const query = parseQueryMap(queryParameters, [
      "begin_time",
      "end_time",
      "sort_order",
      "cursor",
      "location_id",
      "status",
      "source_type",
      "limit",
      "updated_at_begin_time",
      "updated_at_end_time",
      "sort_field"
    ]);
    const normalized = normalizeTimeWindowListQuery(query, 100);
    if (query.status !== undefined) {
      normalized.normalizedQueryParameters.status = enumValue(
        query.status,
        SQUARE_ALLOWED_REFUND_STATUSES
      );
    }
    if (query.source_type !== undefined) {
      normalized.normalizedQueryParameters.source_type = enumValue(
        query.source_type,
        SQUARE_ALLOWED_PAYMENT_SOURCE_TYPES
      );
    }
    if (query.sort_field !== undefined) {
      normalized.normalizedQueryParameters.sort_field = enumValue(query.sort_field, [
        "CREATED_AT",
        "UPDATED_AT"
      ] as const);
    }
    return normalized;
  }
  if (operationKey === "list_catalog") {
    const query = parseQueryMap(queryParameters, [
      "cursor",
      "types",
      "catalog_version"
    ]);
    if (query.types === undefined) deny();
    const normalized: MutableContractJsonObject = {
      types: parseCommaSeparatedCatalogTypes(query.types)
    };
    const binding: MutableContractJsonObject = {
      types: normalized.types
    };
    let cursorPresent = false;
    if (query.cursor !== undefined) {
      normalized.cursor = parseCursorQuery(query.cursor);
      cursorPresent = true;
    }
    if (query.catalog_version !== undefined) {
      normalized.catalog_version = parseIntegerQuery(query.catalog_version);
      binding.catalog_version = normalized.catalog_version;
    }
    return {
      normalizedQueryParameters: normalized,
      normalizedCursorBindingQueryParameters: binding,
      cursorPresent
    } as const;
  }
  if (operationKey === "retrieve_catalog_object") {
    const query = parseQueryMap(queryParameters, [
      "include_related_objects",
      "catalog_version",
      "include_category_path_to_root"
    ]);
    const normalized: MutableContractJsonObject = {};
    if (query.include_related_objects !== undefined) {
      normalized.include_related_objects = parseBooleanQuery(query.include_related_objects);
    }
    if (query.catalog_version !== undefined) {
      normalized.catalog_version = parseIntegerQuery(query.catalog_version);
    }
    if (query.include_category_path_to_root !== undefined) {
      normalized.include_category_path_to_root = parseBooleanQuery(
        query.include_category_path_to_root
      );
    }
    return {
      normalizedQueryParameters: normalized,
      normalizedCursorBindingQueryParameters: normalized,
      cursorPresent: false
    } as const;
  }
  if (operationKey === "retrieve_inventory_count") {
    const query = parseQueryMap(queryParameters, ["location_ids", "cursor"]);
    const normalized: MutableContractJsonObject = {};
    const binding: MutableContractJsonObject = {};
    let cursorPresent = false;
    if (query.location_ids !== undefined) {
      normalized.location_ids = parseCommaSeparatedIds(query.location_ids, 100);
      binding.location_ids = normalized.location_ids;
    }
    if (query.cursor !== undefined) {
      normalized.cursor = parseCursorQuery(query.cursor);
      cursorPresent = true;
    }
    return {
      normalizedQueryParameters: normalized,
      normalizedCursorBindingQueryParameters: binding,
      cursorPresent
    } as const;
  }
  deny();
}

function normalizeTimeWindowListQuery(
  query: Readonly<Record<string, string>>,
  maximumLimit: number
) {
  const normalized: MutableContractJsonObject = {};
  const binding: MutableContractJsonObject = {};
  let cursorPresent = false;
  for (const key of [
    "begin_time",
    "end_time",
    "updated_at_begin_time",
    "updated_at_end_time"
  ]) {
    if (query[key] !== undefined) {
      normalized[key] = parseTimestampQuery(query[key]);
      binding[key] = normalized[key];
    }
  }
  if (query.sort_order !== undefined) {
    normalized.sort_order = enumValue(query.sort_order, SQUARE_ALLOWED_SORT_ORDERS);
    binding.sort_order = normalized.sort_order;
  }
  if (query.cursor !== undefined) {
    normalized.cursor = parseCursorQuery(query.cursor);
    cursorPresent = true;
  }
  if (query.location_id !== undefined) {
    normalized.location_id = parseIdQuery(query.location_id);
    binding.location_id = normalized.location_id;
  }
  if (query.limit !== undefined) {
    normalized.limit = parseLimitQuery(query.limit, maximumLimit);
    binding.limit = normalized.limit;
  }
  return {
    normalizedQueryParameters: normalized,
    normalizedCursorBindingQueryParameters: binding,
    cursorPresent
  };
}

function normalizeTimeRange(
  value: ContractJsonValue,
  label: string
): ContractJsonObject {
  if (!isRecord(value)) deny();
  requireAllowedKeys(value, ["start_at", "end_at"]);
  if (value.start_at === undefined && value.end_at === undefined) deny();
  const output: MutableContractJsonObject = {};
  if (value.start_at !== undefined) {
    output.start_at = redactedString(`${label}:start_at`, rfc3339Value(value.start_at));
  }
  if (value.end_at !== undefined) {
    output.end_at = redactedString(`${label}:end_at`, rfc3339Value(value.end_at));
  }
  return output;
}

function normalizeOrdersSearch(input: ProviderReadOnlyPostRequestValidationInput): NormalizedRequest {
  requireNoQueryParameters(input.queryParameters);
  const body = input.body;
  assertNoForbiddenKeys(body);
  requireAllowedKeys(body, [
    "location_ids",
    "cursor",
    "query",
    "limit",
    "return_entries"
  ]);
  if (body.location_ids === undefined) deny();
  const locationIds = arrayOfStrings(body.location_ids, {
    minimum: 1,
    maximum: 10,
    item: "id"
  });
  const normalizedBody: MutableContractJsonObject = {
    location_ids: redactedStringSet("location_ids", locationIds)
  };
  const bindingBody: MutableContractJsonObject = {
    location_ids: normalizedBody.location_ids
  };
  const cursorPresent = optionalCursor(normalizedBody, bindingBody, body);
  if (body.limit !== undefined) {
    normalizedBody.limit = integerValue(body.limit, 1, 1000);
    bindingBody.limit = normalizedBody.limit;
  }
  if (body.return_entries !== undefined) {
    normalizedBody.return_entries = booleanValue(body.return_entries);
    bindingBody.return_entries = normalizedBody.return_entries;
  }
  if (body.query !== undefined) {
    const normalizedQuery = normalizeOrdersQuery(body.query);
    normalizedBody.query = normalizedQuery;
    bindingBody.query = normalizedQuery;
  }
  return {
    normalizedQueryParameters: {},
    normalizedBody,
    normalizedCursorBindingQueryParameters: {},
    normalizedCursorBindingBody: bindingBody,
    cursorPresent
  };
}

function normalizeOrdersQuery(value: ContractJsonValue) {
  if (!isRecord(value)) deny();
  requireAllowedKeys(value, ["filter", "sort"]);
  const output: MutableContractJsonObject = {};
  let dateTimeField: string | null = null;
  let states: readonly string[] = [];
  if (value.filter !== undefined) {
    const normalizedFilter = normalizeOrdersFilter(value.filter);
    output.filter = normalizedFilter.normalized;
    dateTimeField = normalizedFilter.dateTimeField;
    states = normalizedFilter.states;
  }
  if (value.sort !== undefined) {
    const normalizedSort = normalizeOrdersSort(value.sort);
    output.sort = normalizedSort;
    if (dateTimeField !== null && normalizedSort.sort_field !== dateTimeField) deny();
    if (
      normalizedSort.sort_field === "CLOSED_AT" &&
      !states.every((state) => state === "COMPLETED" || state === "CANCELED")
    ) {
      deny();
    }
  } else if (dateTimeField !== null) {
    deny();
  }
  return output;
}

function normalizeOrdersFilter(value: ContractJsonValue) {
  if (!isRecord(value)) deny();
  requireAllowedKeys(value, ["state_filter", "date_time_filter"]);
  const normalized: MutableContractJsonObject = {};
  let dateTimeField: string | null = null;
  let states: readonly string[] = [];
  if (value.state_filter !== undefined) {
    if (!isRecord(value.state_filter)) deny();
    requireAllowedKeys(value.state_filter, ["states"]);
    if (value.state_filter.states === undefined) deny();
    states = arrayOfStrings(value.state_filter.states, {
      minimum: 1,
      maximum: 4,
      item: "enum",
      enumValues: SQUARE_ALLOWED_ORDER_STATES
    });
    normalized.state_filter = { states: [...states].sort() };
  }
  if (value.date_time_filter !== undefined) {
    if (!isRecord(value.date_time_filter)) deny();
    requireAllowedKeys(value.date_time_filter, [
      "created_at",
      "updated_at",
      "closed_at"
    ]);
    const dateTimeKeys = objectKeys(value.date_time_filter);
    if (dateTimeKeys.length !== 1) deny();
    const field = dateTimeKeys[0];
    dateTimeField =
      field === "created_at"
        ? "CREATED_AT"
        : field === "updated_at"
          ? "UPDATED_AT"
          : "CLOSED_AT";
    normalized.date_time_filter = {
      [field]: normalizeTimeRange(value.date_time_filter[field], field)
    };
  }
  return { normalized, dateTimeField, states };
}

function normalizeOrdersSort(value: ContractJsonValue) {
  if (!isRecord(value)) deny();
  requireAllowedKeys(value, ["sort_field", "sort_order"]);
  if (value.sort_field === undefined) deny();
  const output: MutableContractJsonObject = {
    sort_field: enumValue(value.sort_field, SQUARE_ALLOWED_ORDER_SORT_FIELDS)
  };
  if (value.sort_order !== undefined) {
    output.sort_order = enumValue(value.sort_order, SQUARE_ALLOWED_SORT_ORDERS);
  }
  return output;
}

function normalizeOrdersBatchRetrieve(
  input: ProviderReadOnlyPostRequestValidationInput
): NormalizedRequest {
  requireNoQueryParameters(input.queryParameters);
  const body = input.body;
  assertNoForbiddenKeys(body);
  requireAllowedKeys(body, ["location_id", "order_ids"]);
  if (body.order_ids === undefined) deny();
  const orderIds = arrayOfStrings(body.order_ids, {
    minimum: 1,
    maximum: 100,
    item: "id"
  });
  const normalizedBody: MutableContractJsonObject = {
    order_ids: redactedStringSet("order_ids", orderIds)
  };
  if (body.location_id !== undefined) {
    normalizedBody.location_id = redactedString("location_id", idValue(body.location_id));
  }
  return {
    normalizedQueryParameters: {},
    normalizedBody,
    normalizedCursorBindingQueryParameters: {},
    normalizedCursorBindingBody: normalizedBody,
    cursorPresent: false
  };
}

function normalizeCatalogSearch(input: ProviderReadOnlyPostRequestValidationInput): NormalizedRequest {
  requireNoQueryParameters(input.queryParameters);
  const body = input.body;
  assertNoForbiddenKeys(body);
  requireAllowedKeys(body, [
    "cursor",
    "object_types",
    "include_deleted_objects",
    "include_related_objects",
    "begin_time",
    "query",
    "limit",
    "include_category_path_to_root",
    "include_options"
  ]);
  if (body.object_types === undefined) deny();
  const objectTypes = arrayOfStrings(body.object_types, {
    minimum: 1,
    maximum: SQUARE_ALLOWED_CATALOG_OBJECT_TYPES.length,
    item: "enum",
    enumValues: SQUARE_ALLOWED_CATALOG_OBJECT_TYPES
  });
  const normalizedBody: MutableContractJsonObject = {
    object_types: [...objectTypes].sort()
  };
  const bindingBody: MutableContractJsonObject = {
    object_types: normalizedBody.object_types
  };
  const cursorPresent = optionalCursor(normalizedBody, bindingBody, body);
  optionalBoolean(normalizedBody, "include_deleted_objects", body);
  optionalBoolean(normalizedBody, "include_related_objects", body);
  optionalBoolean(normalizedBody, "include_category_path_to_root", body);
  for (const key of [
    "include_deleted_objects",
    "include_related_objects",
    "include_category_path_to_root"
  ]) {
    if (normalizedBody[key] !== undefined) bindingBody[key] = normalizedBody[key];
  }
  if (
    normalizedBody.include_deleted_objects === true &&
    normalizedBody.include_category_path_to_root === true
  ) {
    deny();
  }
  if (body.begin_time !== undefined) {
    normalizedBody.begin_time = redactedString("begin_time", rfc3339Value(body.begin_time));
    bindingBody.begin_time = normalizedBody.begin_time;
  }
  if (body.limit !== undefined) {
    normalizedBody.limit = integerValue(body.limit, 1, 1000);
    bindingBody.limit = normalizedBody.limit;
  }
  if (body.query !== undefined) {
    const normalizedQuery = normalizeCatalogQuery(body.query);
    normalizedBody.query = normalizedQuery;
    bindingBody.query = normalizedQuery;
  }
  if (body.include_options !== undefined) {
    const normalizedIncludeOptions = normalizeIncludeOptions(body.include_options);
    normalizedBody.include_options = normalizedIncludeOptions;
    bindingBody.include_options = normalizedIncludeOptions;
  }
  return {
    normalizedQueryParameters: {},
    normalizedBody,
    normalizedCursorBindingQueryParameters: {},
    normalizedCursorBindingBody: bindingBody,
    cursorPresent
  };
}

function normalizeCatalogQuery(value: ContractJsonValue): ContractJsonObject {
  if (!isRecord(value)) deny();
  requireAllowedKeys(value, [
    "exact_query",
    "prefix_query",
    "items_for_modifier_list_query",
    "items_for_tax_query"
  ]);
  const queryKeys = objectKeys(value);
  if (queryKeys.length !== 1) deny();
  const key = queryKeys[0];
  if (key === "exact_query" || key === "prefix_query") {
    const nested = value[key];
    if (!isRecord(nested)) deny();
    const textKey = key === "exact_query" ? "attribute_value" : "attribute_prefix";
    requireAllowedKeys(nested, ["attribute_name", textKey]);
    if (nested.attribute_name !== "name" || nested[textKey] === undefined) deny();
    const output: MutableContractJsonObject = {};
    output[key] = {
      attribute_name: "name",
      [textKey]: redactedString(textKey, stringValue(nested[textKey], 255))
    };
    return output;
  }
  if (key === "items_for_modifier_list_query") {
    const nested = value[key];
    if (!isRecord(nested)) deny();
    requireAllowedKeys(nested, ["modifier_list_ids"]);
    if (nested.modifier_list_ids === undefined) deny();
    const ids = arrayOfStrings(nested.modifier_list_ids, {
      minimum: 1,
      maximum: 100,
      item: "id"
    });
    return {
      items_for_modifier_list_query: {
        modifier_list_ids: redactedStringSet("modifier_list_ids", ids)
      }
    };
  }
  if (key === "items_for_tax_query") {
    const nested = value[key];
    if (!isRecord(nested)) deny();
    requireAllowedKeys(nested, ["tax_ids"]);
    if (nested.tax_ids === undefined) deny();
    const ids = arrayOfStrings(nested.tax_ids, {
      minimum: 1,
      maximum: 100,
      item: "id"
    });
    return {
      items_for_tax_query: {
        tax_ids: redactedStringSet("tax_ids", ids)
      }
    };
  }
  deny();
}

function normalizeIncludeOptions(value: ContractJsonValue) {
  if (!isRecord(value)) deny();
  requireAllowedKeys(value, ["include"]);
  if (value.include === undefined) deny();
  const include = arrayOfStrings(value.include, {
    minimum: 1,
    maximum: 2,
    item: "enum",
    enumValues: [
      "INCLUDE_NESTED_MODIFIERS",
      "INCLUDE_ANCESTOR_MODIFIERS"
    ] as const
  });
  return {
    include: [...include].sort()
  } satisfies ContractJsonObject;
}

function normalizeCatalogBatchRetrieve(
  input: ProviderReadOnlyPostRequestValidationInput
): NormalizedRequest {
  requireNoQueryParameters(input.queryParameters);
  const body = input.body;
  assertNoForbiddenKeys(body);
  requireAllowedKeys(body, [
    "object_ids",
    "include_related_objects",
    "catalog_version",
    "include_deleted_objects",
    "include_category_path_to_root",
    "include_options"
  ]);
  if (body.object_ids === undefined) deny();
  const objectIds = arrayOfStrings(body.object_ids, {
    minimum: 1,
    maximum: 1000,
    item: "id"
  });
  const normalizedBody: MutableContractJsonObject = {
    object_ids: redactedStringSet("object_ids", objectIds)
  };
  optionalBoolean(normalizedBody, "include_related_objects", body);
  optionalBoolean(normalizedBody, "include_deleted_objects", body);
  optionalBoolean(normalizedBody, "include_category_path_to_root", body);
  if (body.catalog_version !== undefined) {
    if (typeof body.catalog_version !== "number" || !Number.isSafeInteger(body.catalog_version) || body.catalog_version < 0) {
      deny();
    }
    normalizedBody.catalog_version = redactedString(
      "catalog_version",
      String(body.catalog_version)
    );
  }
  if (
    normalizedBody.include_deleted_objects === true &&
    normalizedBody.include_category_path_to_root === true
  ) {
    deny();
  }
  if (body.include_options !== undefined) {
    normalizedBody.include_options = normalizeIncludeOptions(body.include_options);
  }
  return {
    normalizedQueryParameters: {},
    normalizedBody,
    normalizedCursorBindingQueryParameters: {},
    normalizedCursorBindingBody: normalizedBody,
    cursorPresent: false
  };
}

function normalizeInventoryCountsBatchRetrieve(
  input: ProviderReadOnlyPostRequestValidationInput
): NormalizedRequest {
  requireNoQueryParameters(input.queryParameters);
  const body = input.body;
  assertNoForbiddenKeys(body);
  requireAllowedKeys(body, [
    "catalog_object_ids",
    "location_ids",
    "updated_after",
    "cursor",
    "states",
    "limit"
  ]);
  const normalizedBody: MutableContractJsonObject = {};
  const bindingBody: MutableContractJsonObject = {};
  const cursorPresent = optionalCursor(normalizedBody, bindingBody, body);
  if (body.catalog_object_ids !== undefined) {
    const ids = arrayOfStrings(body.catalog_object_ids, {
      minimum: 1,
      maximum: 1000,
      item: "id"
    });
    normalizedBody.catalog_object_ids = redactedStringSet("catalog_object_ids", ids);
    bindingBody.catalog_object_ids = normalizedBody.catalog_object_ids;
  }
  if (body.location_ids !== undefined) {
    const ids = arrayOfStrings(body.location_ids, {
      minimum: 1,
      maximum: 100,
      item: "id"
    });
    normalizedBody.location_ids = redactedStringSet("location_ids", ids);
    bindingBody.location_ids = normalizedBody.location_ids;
  }
  if (body.updated_after !== undefined) {
    normalizedBody.updated_after = redactedString(
      "updated_after",
      rfc3339Value(body.updated_after)
    );
    bindingBody.updated_after = normalizedBody.updated_after;
  }
  if (body.states !== undefined) {
    const states = arrayOfStrings(body.states, {
      minimum: 1,
      maximum: SQUARE_ALLOWED_INVENTORY_STATES.length,
      item: "enum",
      enumValues: SQUARE_ALLOWED_INVENTORY_STATES
    });
    normalizedBody.states = [...states].sort();
    bindingBody.states = normalizedBody.states;
  }
  if (body.limit !== undefined) {
    normalizedBody.limit = integerValue(body.limit, 1, 1000);
    bindingBody.limit = normalizedBody.limit;
  }
  if (Object.keys(normalizedBody).length === 0) deny();
  return {
    normalizedQueryParameters: {},
    normalizedBody,
    normalizedCursorBindingQueryParameters: {},
    normalizedCursorBindingBody: bindingBody,
    cursorPresent
  };
}

function normalizeInventoryChangesBatchRetrieve(
  input: ProviderReadOnlyPostRequestValidationInput
): NormalizedRequest {
  requireNoQueryParameters(input.queryParameters);
  const body = input.body;
  assertNoForbiddenKeys(body);
  requireAllowedKeys(body, [
    "catalog_object_ids",
    "location_ids",
    "types",
    "states",
    "updated_after",
    "updated_before",
    "cursor",
    "limit",
    "sort"
  ]);
  const normalizedBody: MutableContractJsonObject = {};
  const bindingBody: MutableContractJsonObject = {};
  const cursorPresent = optionalCursor(normalizedBody, bindingBody, body);
  if (body.catalog_object_ids !== undefined) {
    const ids = arrayOfStrings(body.catalog_object_ids, {
      minimum: 1,
      maximum: 500,
      item: "id"
    });
    normalizedBody.catalog_object_ids = redactedStringSet("catalog_object_ids", ids);
    bindingBody.catalog_object_ids = normalizedBody.catalog_object_ids;
  }
  if (body.location_ids !== undefined) {
    const ids = arrayOfStrings(body.location_ids, {
      minimum: 1,
      maximum: 100,
      item: "id"
    });
    normalizedBody.location_ids = redactedStringSet("location_ids", ids);
    bindingBody.location_ids = normalizedBody.location_ids;
  }
  if (body.types !== undefined) {
    const types = arrayOfStrings(body.types, {
      minimum: 1,
      maximum: SQUARE_ALLOWED_INVENTORY_CHANGE_TYPES.length,
      item: "enum",
      enumValues: SQUARE_ALLOWED_INVENTORY_CHANGE_TYPES
    });
    normalizedBody.types = [...types].sort();
    bindingBody.types = normalizedBody.types;
  }
  if (body.states !== undefined) {
    const states = arrayOfStrings(body.states, {
      minimum: 1,
      maximum: SQUARE_ALLOWED_INVENTORY_STATES.length,
      item: "enum",
      enumValues: SQUARE_ALLOWED_INVENTORY_STATES
    });
    normalizedBody.states = [...states].sort();
    bindingBody.states = normalizedBody.states;
  }
  for (const key of ["updated_after", "updated_before"]) {
    if (body[key] !== undefined) {
      normalizedBody[key] = redactedString(key, rfc3339Value(body[key]));
      bindingBody[key] = normalizedBody[key];
    }
  }
  if (body.limit !== undefined) {
    normalizedBody.limit = integerValue(body.limit, 1, 1000);
    bindingBody.limit = normalizedBody.limit;
  }
  if (body.sort !== undefined) {
    normalizedBody.sort = normalizeInventoryChangesSort(body.sort);
    bindingBody.sort = normalizedBody.sort;
  }
  if (Object.keys(normalizedBody).length === 0) deny();
  return {
    normalizedQueryParameters: {},
    normalizedBody,
    normalizedCursorBindingQueryParameters: {},
    normalizedCursorBindingBody: bindingBody,
    cursorPresent
  };
}

function normalizeInventoryChangesSort(value: ContractJsonValue) {
  if (!isRecord(value)) deny();
  requireAllowedKeys(value, ["field", "order"]);
  const output: MutableContractJsonObject = {};
  if (value.field !== undefined) {
    if (value.field !== "OCCURRED_AT") deny();
    output.field = "OCCURRED_AT";
  }
  if (value.order !== undefined) {
    output.order = enumValue(value.order, SQUARE_ALLOWED_SORT_ORDERS);
  }
  if (Object.keys(output).length === 0) deny();
  return output;
}

function normalizePostRequest(input: ProviderReadOnlyPostRequestValidationInput) {
  switch (input.operation.requestValidatorKey) {
    case "square_orders_search_request_v1":
      return normalizeOrdersSearch(input);
    case "square_orders_batch_retrieve_request_v1":
      return normalizeOrdersBatchRetrieve(input);
    case "square_catalog_search_request_v1":
      return normalizeCatalogSearch(input);
    case "square_catalog_batch_retrieve_request_v1":
      return normalizeCatalogBatchRetrieve(input);
    case "square_inventory_counts_batch_retrieve_request_v1":
      return normalizeInventoryCountsBatchRetrieve(input);
    case "square_inventory_changes_batch_retrieve_request_v1":
      return normalizeInventoryChangesBatchRetrieve(input);
    default:
      deny();
  }
}

function providerReadOnlyPostValidator(
  input: ProviderReadOnlyPostRequestValidationInput
): ProviderReadOnlyPostRequestValidationResult {
  const normalized = normalizePostRequest(input);
  return {
    normalizedQueryParameters: normalized.normalizedQueryParameters,
    normalizedBody: normalized.normalizedBody
  };
}

function cursorBindingFingerprint(input: Readonly<{
  providerEnvironment: SquareProviderEnvironmentKey;
  operationKey: string;
  hostname: string;
  pathTemplate: string;
  method: "GET" | "POST";
  normalizedQueryParameters: ContractJsonObject;
  normalizedBody: ContractJsonObject;
}>) {
  return contractSha256({
    fingerprintPurpose: "square_cursor_binding",
    fingerprintVersion: "square_cursor_binding_fingerprint_v1",
    payload: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: input.providerEnvironment,
      operationKey: input.operationKey,
      hostname: input.hostname,
      pathTemplate: input.pathTemplate,
      method: input.method,
      normalizedQueryParameters: input.normalizedQueryParameters,
      normalizedBody: input.normalizedBody
    }
  });
}

function requestFingerprint(input: Readonly<{
  providerEnvironment: SquareProviderEnvironmentKey;
  operationKey: string;
  hostname: string;
  pathTemplate: string;
  method: "GET" | "POST";
  squareVersion: typeof SQUARE_API_VERSION;
  normalizedQueryParameters: ContractJsonObject;
  normalizedBody: ContractJsonObject;
}>) {
  return contractSha256({
    fingerprintPurpose: "square_read_operation_request",
    fingerprintVersion: "square_read_operation_request_fingerprint_v1",
    payload: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: input.providerEnvironment,
      operationKey: input.operationKey,
      hostname: input.hostname,
      pathTemplate: input.pathTemplate,
      method: input.method,
      squareVersion: input.squareVersion,
      normalizedQueryParameters: input.normalizedQueryParameters,
      normalizedBody: input.normalizedBody
    }
  });
}

function assertCursorBinding(
  cursorPresent: boolean,
  expected: string | null | undefined,
  actual: string
) {
  if (!cursorPresent) return;
  if (!expected) deny();
  try {
    Sha256FingerprintSchema.parse(expected);
  } catch {
    deny();
  }
  if (expected !== actual) deny();
}

function environmentFor(providerEnvironment: string): SquareProviderEnvironmentKey {
  if (providerEnvironment === "production" || providerEnvironment === "sandbox") {
    return providerEnvironment;
  }
  deny();
}

function assertDescriptorIsStaticSquareDescriptor(descriptor: ProviderDescriptor) {
  if (descriptor !== SQUARE_PROVIDER_DESCRIPTOR) deny();
}

function assertProviderAndHost(
  input: SquareReadOperationAuthorizationInput,
  parsedUrl: ParsedSquareUrl
) {
  if (input.providerKey !== SQUARE_PROVIDER_KEY) deny();
  const providerEnvironment = environmentFor(input.providerEnvironment);
  const expectedHost = SQUARE_ENVIRONMENTS[providerEnvironment].hostname;
  if (parsedUrl.hostname !== expectedHost) deny();
  return providerEnvironment;
}

function assertGetOperation(
  input: SquareReadOperationAuthorizationInput,
  parsedUrl: ParsedSquareUrl,
  providerEnvironment: SquareProviderEnvironmentKey
): SquareReadOperationDecision {
  if (input.method !== "GET") deny();
  const contentType = optionalHeaderValue(input.headers, "content-type");
  if (contentType !== null) normalizeContentType(contentType);
  if (input.body !== undefined && input.body !== null) {
    const bodyLength =
      typeof input.body === "string"
        ? Buffer.byteLength(input.body, "utf8")
        : input.body.byteLength;
    if (bodyLength > 0) deny();
  }
  const operation = SQUARE_GET_OPERATIONS.find((candidate) =>
    candidate.pathPattern.test(parsedUrl.rawPath)
  );
  if (!operation) deny();
  const normalized = normalizeGetQuery(
    operation.operationKey,
    parsedUrl.queryParameters
  );
  const cursorFingerprint = cursorBindingFingerprint({
    providerEnvironment,
    operationKey: operation.operationKey,
    hostname: parsedUrl.hostname,
    pathTemplate: operation.pathTemplate,
    method: "GET",
    normalizedQueryParameters: normalized.normalizedCursorBindingQueryParameters,
    normalizedBody: {}
  });
  assertCursorBinding(
    normalized.cursorPresent,
    input.expectedCursorBindingFingerprint,
    cursorFingerprint
  );
  return {
    policyVersion: SQUARE_READ_OPERATION_POLICY_VERSION,
    readOnly: true,
    providerKey: SQUARE_PROVIDER_KEY,
    providerEnvironment,
    operationKey: operation.operationKey,
    hostname: parsedUrl.hostname,
    pathTemplate: operation.pathTemplate,
    method: "GET",
    squareVersion: SQUARE_API_VERSION,
    contentType: contentType === null ? null : "application/json",
    maximumResponseBytes: operation.maximumResponseBytes,
    timeoutMs: operation.timeoutMs,
    retryClassification: operation.retryClassification,
    redirectPolicy: "manual",
    requestValidatorKey: null,
    requestFingerprint: requestFingerprint({
      providerEnvironment,
      operationKey: operation.operationKey,
      hostname: parsedUrl.hostname,
      pathTemplate: operation.pathTemplate,
      method: "GET",
      squareVersion: SQUARE_API_VERSION,
      normalizedQueryParameters: normalized.normalizedQueryParameters,
      normalizedBody: {}
    }),
    cursorBindingFingerprint: cursorFingerprint
  };
}

function assertPostOperation(
  input: SquareReadOperationAuthorizationInput,
  parsedUrl: ParsedSquareUrl,
  providerEnvironment: SquareProviderEnvironmentKey
): SquareReadOperationDecision {
  if (input.method !== "POST") deny();
  const contentType = normalizeContentType(headerValue(input.headers, "content-type"));
  if (input.body === undefined || input.body === null) deny();
  const operation = SQUARE_READ_ONLY_POST_OPERATIONS.find(
    (candidate) =>
      candidate.providerEnvironment === providerEnvironment &&
      candidate.hostname === parsedUrl.hostname &&
      candidate.path === parsedUrl.rawPath
  );
  if (!operation) deny();
  const body = parseJsonBody(input.body, operation.maximumRequestBodyBytes);
  const normalized = normalizePostRequest({
    operation,
    queryParameters: parsedUrl.queryParameters,
    body,
    rawBodyByteLength:
      typeof input.body === "string"
        ? Buffer.byteLength(input.body, "utf8")
        : input.body.byteLength
  });
  const postDecision = assertDeclaredReadOnlyPostOperation({
    descriptor: SQUARE_PROVIDER_DESCRIPTOR,
    providerKey: SQUARE_PROVIDER_KEY,
    providerEnvironment,
    method: input.method,
    url: input.url,
    contentType,
    body: input.body,
    validators: SQUARE_READ_ONLY_POST_REQUEST_VALIDATORS,
    retryAttempt: input.retryAttempt
  });
  const bindingFingerprint = cursorBindingFingerprint({
    providerEnvironment,
    operationKey: operation.operationKey,
    hostname: parsedUrl.hostname,
    pathTemplate: operation.path,
    method: "POST",
    normalizedQueryParameters: normalized.normalizedCursorBindingQueryParameters,
    normalizedBody: normalized.normalizedCursorBindingBody
  });
  assertCursorBinding(
    normalized.cursorPresent,
    input.expectedCursorBindingFingerprint,
    bindingFingerprint
  );
  return {
    policyVersion: SQUARE_READ_OPERATION_POLICY_VERSION,
    readOnly: true,
    providerKey: SQUARE_PROVIDER_KEY,
    providerEnvironment,
    operationKey: operation.operationKey,
    hostname: parsedUrl.hostname,
    pathTemplate: operation.path,
    method: "POST",
    squareVersion: SQUARE_API_VERSION,
    contentType,
    maximumResponseBytes: postDecision.maximumResponseBytes,
    timeoutMs: postDecision.timeoutMs,
    retryClassification: postDecision.retryClassification,
    redirectPolicy: "manual",
    requestValidatorKey: operation.requestValidatorKey,
    requestFingerprint: postDecision.requestFingerprint,
    cursorBindingFingerprint: bindingFingerprint,
    providerReadOnlyPostPolicyVersion: postDecision.policyVersion
  };
}

export function normalizeSquareOAuthScopes(scopes: readonly string[]) {
  if (!Array.isArray(scopes)) deny();
  if (scopes.length !== SQUARE_MINIMUM_READ_SCOPES.length) deny();
  const allowed = new Set<string>(SQUARE_MINIMUM_READ_SCOPES);
  const normalized = scopes.map((scope) => {
    if (typeof scope !== "string" || scope.length < 1 || scope.length > 128) deny();
    if (SQUARE_WRITE_OR_DEFERRED_SCOPE_PATTERNS.some((pattern) => pattern.test(scope))) {
      deny();
    }
    if (!allowed.has(scope)) deny();
    return scope as SquareMinimumReadScope;
  });
  if (new Set(normalized).size !== normalized.length) deny();
  return [...normalized].sort() as readonly SquareMinimumReadScope[];
}

export function assertSquareReadOperation(
  input: SquareReadOperationAuthorizationInput
): SquareReadOperationDecision {
  assertDescriptorIsStaticSquareDescriptor(SQUARE_PROVIDER_DESCRIPTOR);
  requireSquareVersion(input.headers);
  const parsedUrl = parseExactSquareUrl(input.url);
  const providerEnvironment = assertProviderAndHost(input, parsedUrl);
  if (input.method === "GET") {
    return assertGetOperation(input, parsedUrl, providerEnvironment);
  }
  if (input.method === "POST") {
    return assertPostOperation(input, parsedUrl, providerEnvironment);
  }
  deny();
}

export const SQUARE_READ_ONLY_POST_REQUEST_VALIDATORS =
  SQUARE_READ_ONLY_POST_OPERATIONS.reduce<
    Record<string, ProviderReadOnlyPostRequestValidator>
  >((registry, operation) => {
    registry[providerReadOnlyPostValidatorRegistryKey(operation)] =
      providerReadOnlyPostValidator;
    return registry;
  }, {}) satisfies ProviderReadOnlyPostRequestValidatorRegistry;
