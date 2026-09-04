import { z } from "zod";

import { IsoTimestampSchema } from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_ALLOWED_LOCATION_STATUSES,
  SQUARE_ALLOWED_LOCATION_TYPES,
  SQUARE_MERCHANT_LOCATION_ENTITY_VERSION,
  SQUARE_LOCATION_RESPONSE_CONTRACT_VERSION,
  SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION,
  SQUARE_PROVIDER_KEY
} from "@/lib/integrations/providers/square/contracts";
import {
  SquareCountryCodeSchema,
  SquareCurrencyCodeSchema,
  SquareDisplayTextSchema,
  SquareIdentifierSchema,
  SquareIntegerVersionSchema,
  SquareProviderEnvironmentSchema,
  SquareResponseProvenanceSchema,
  SquareTimeZoneSchema,
  type SquareResponseParserResult,
  type SquareResponseProvenance,
  squareAcceptedResult,
  squareFailureResult,
  squareMinimizedProjectionFingerprint,
  squareOptionalNullableDisplayText,
  squareOptionalNullableIdentifier,
  squareOptionalNullableTimeZone,
  squareOptionalNullableTimestamp,
  squareOptionalNullableEnum,
  squareProviderErrorState,
  squareRejectResponse,
  squareRequiredCountryCode,
  squareRequiredCurrencyCode,
  squareRequiredEnum,
  squareRequiredIdentifier,
  squareResponseParserInput,
  squareResponseProvenance,
  squareSafeJsonObject,
  squareUnsupportedResult,
  type SquareSafeJsonObject
} from "@/lib/integrations/providers/square/response-validation";

const SquareLocationAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("location"),
    providerId: SquareIdentifierSchema.max(32)
  })
  .strict();

export const SquareMinimizedLocationSchema = z
  .object({
    contractVersion: z.literal(SQUARE_LOCATION_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION),
    entityType: z.literal("location"),
    entityVersion: SquareIntegerVersionSchema,
    authority: SquareLocationAuthoritySchema,
    provider: SquareResponseProvenanceSchema,
    id: SquareIdentifierSchema.max(32),
    merchantId: SquareIdentifierSchema.max(32).nullable(),
    status: z.enum(SQUARE_ALLOWED_LOCATION_STATUSES),
    displayName: SquareDisplayTextSchema.nullable(),
    timeZone: SquareTimeZoneSchema,
    currency: SquareCurrencyCodeSchema,
    country: SquareCountryCodeSchema,
    locationType: z.enum(SQUARE_ALLOWED_LOCATION_TYPES).nullable(),
    createdAt: IsoTimestampSchema.nullable()
  })
  .strict();

export const SquareLocationResponseSchema = z
  .object({
    contractVersion: z.literal(SQUARE_LOCATION_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION),
    entityType: z.literal("location"),
    provider: SquareResponseProvenanceSchema,
    items: z.array(SquareMinimizedLocationSchema).max(500),
    itemCount: z.number().int().nonnegative().max(500).safe()
  })
  .strict();

export type SquareMinimizedLocation = Readonly<
  z.infer<typeof SquareMinimizedLocationSchema>
>;
export type SquareLocationResponse = Readonly<
  z.infer<typeof SquareLocationResponseSchema>
>;
export type SquareLocationStatus =
  (typeof SQUARE_ALLOWED_LOCATION_STATUSES)[number];
export type SquareLocationType = (typeof SQUARE_ALLOWED_LOCATION_TYPES)[number];

export function parseSquareLocationResponse(
  input: unknown
): SquareResponseParserResult<SquareLocationResponse> {
  try {
    const parserInput = squareResponseParserInput(input);
    const provenance = squareResponseProvenance(parserInput);
    const response = squareSafeJsonObject(parserInput.response);

    if (squareProviderErrorState(response) === "present") {
      return squareUnsupportedResult(
        "square_location_provider_errors_present",
        "$response.errors"
      );
    }

    const rawItems = locationResponseItems(response);
    for (const item of rawItems) {
      if (
        !Object.prototype.hasOwnProperty.call(item, "timezone") ||
        item.timezone === null
      ) {
        return squareUnsupportedResult(
          "square_location_timezone_missing",
          "$response.locations[].timezone"
        );
      }
    }
    const items = rawItems.map((item) =>
      minimizeSquareLocation(item, provenance)
    );
    assertUniqueLocationAuthorities(items);
    return squareAcceptedResult(
      SquareLocationResponseSchema.parse({
        contractVersion: SQUARE_LOCATION_RESPONSE_CONTRACT_VERSION,
        minimizationVersion: SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION,
        entityType: "location",
        provider: provenance,
        items,
        itemCount: items.length
      })
    );
  } catch (error) {
    return squareFailureResult(error);
  }
}

export function minimizeSquareLocation(
  input: unknown,
  provenance: SquareResponseProvenance
): SquareMinimizedLocation {
  const location = squareSafeJsonObject(input, "$response.locations[]");
  const id = squareRequiredIdentifier(
    location,
    "id",
    "$response.locations[].id",
    32
  );
  const providerEnvironment = provenance.providerEnvironment;

  return SquareMinimizedLocationSchema.parse({
    contractVersion: SQUARE_LOCATION_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION,
    entityType: "location",
    entityVersion: SQUARE_MERCHANT_LOCATION_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment,
      entityType: "location",
      providerId: id
    },
    provider: provenance,
    id,
    merchantId: squareOptionalNullableIdentifier(
      location,
      "merchant_id",
      "$response.locations[].merchant_id",
      32
    ),
    status: squareRequiredEnum(
      location,
      "status",
      "$response.locations[].status",
      SQUARE_ALLOWED_LOCATION_STATUSES
    ),
    displayName: squareOptionalNullableDisplayText(
      location,
      "name",
      "$response.locations[].name",
      255
    ),
    timeZone: squareOptionalNullableTimeZone(
      location,
      "timezone",
      "$response.locations[].timezone"
    ),
    currency: squareRequiredCurrencyCode(
      location,
      "currency",
      "$response.locations[].currency"
    ),
    country: squareRequiredCountryCode(
      location,
      "country",
      "$response.locations[].country"
    ),
    locationType: squareOptionalNullableEnum(
      location,
      "type",
      "$response.locations[].type",
      SQUARE_ALLOWED_LOCATION_TYPES
    ),
    createdAt: squareOptionalNullableTimestamp(
      location,
      "created_at",
      "$response.locations[].created_at"
    )
  });
}

export function squareLocationFingerprint(input: SquareMinimizedLocation) {
  return squareMinimizedProjectionFingerprint(
    SquareMinimizedLocationSchema.parse(input)
  );
}

function locationResponseItems(
  response: SquareSafeJsonObject
): readonly SquareSafeJsonObject[] {
  if (Object.prototype.hasOwnProperty.call(response, "locations")) {
    const raw = response.locations;
    if (!Array.isArray(raw) || raw.length > 500) {
      throw new Error("square_location_response_invalid");
    }
    return raw.map((item) =>
      squareSafeJsonObject(item, "$response.locations[]")
    );
  }
  if (Object.prototype.hasOwnProperty.call(response, "location")) {
    return [squareSafeJsonObject(response.location, "$response.location")];
  }
  throw new Error("square_location_response_missing");
}

function assertUniqueLocationAuthorities(
  items: readonly SquareMinimizedLocation[]
) {
  const seen = new Set<string>();
  for (const item of items) {
    const identity = `${item.authority.providerEnvironment}:${item.authority.entityType}:${item.authority.providerId}`;
    if (seen.has(identity)) {
      squareRejectResponse(
        "square_duplicate_authority_identity",
        "$response.locations[].id"
      );
    }
    seen.add(identity);
  }
}
