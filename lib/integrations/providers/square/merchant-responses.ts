import { z } from "zod";

import { IsoTimestampSchema } from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_ALLOWED_MERCHANT_STATUSES,
  SQUARE_MERCHANT_LOCATION_ENTITY_VERSION,
  SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION,
  SQUARE_MERCHANT_RESPONSE_CONTRACT_VERSION,
  SQUARE_PROVIDER_KEY
} from "@/lib/integrations/providers/square/contracts";
import {
  SquareCountryCodeSchema,
  SquareCurrencyCodeSchema,
  SquareDisplayTextSchema,
  SquareIdentifierSchema,
  SquareIntegerVersionSchema,
  SquareLanguageCodeSchema,
  SquareProviderEnvironmentSchema,
  SquareResponseProvenanceSchema,
  type SquareResponseParserResult,
  type SquareResponseProvenance,
  squareAcceptedResult,
  squareFailureResult,
  squareMinimizedProjectionFingerprint,
  squareOptionalNullableCurrencyCode,
  squareOptionalNullableDisplayText,
  squareOptionalNullableIdentifier,
  squareOptionalNullableLanguageCode,
  squareOptionalNullableTimestamp,
  squareProviderErrorState,
  squareRejectResponse,
  squareRequiredCountryCode,
  squareRequiredEnum,
  squareRequiredIdentifier,
  squareResponseParserInput,
  squareResponseProvenance,
  squareSafeJsonObject,
  squareUnsupportedResult,
  type SquareSafeJsonObject
} from "@/lib/integrations/providers/square/response-validation";

const SquareMerchantAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("merchant"),
    providerId: SquareIdentifierSchema
  })
  .strict();

export const SquareMinimizedMerchantSchema = z
  .object({
    contractVersion: z.literal(SQUARE_MERCHANT_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION),
    entityType: z.literal("merchant"),
    entityVersion: SquareIntegerVersionSchema,
    authority: SquareMerchantAuthoritySchema,
    provider: SquareResponseProvenanceSchema,
    id: SquareIdentifierSchema,
    status: z.enum(SQUARE_ALLOWED_MERCHANT_STATUSES),
    displayName: SquareDisplayTextSchema.nullable(),
    country: SquareCountryCodeSchema,
    languageCode: SquareLanguageCodeSchema.nullable(),
    currency: SquareCurrencyCodeSchema.nullable(),
    mainLocationId: SquareIdentifierSchema.max(32).nullable(),
    createdAt: IsoTimestampSchema.nullable()
  })
  .strict();

export const SquareMerchantResponseSchema = z
  .object({
    contractVersion: z.literal(SQUARE_MERCHANT_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION),
    entityType: z.literal("merchant"),
    provider: SquareResponseProvenanceSchema,
    items: z.array(SquareMinimizedMerchantSchema).max(250),
    itemCount: z.number().int().nonnegative().max(250).safe()
  })
  .strict();

export type SquareMinimizedMerchant = Readonly<
  z.infer<typeof SquareMinimizedMerchantSchema>
>;
export type SquareMerchantResponse = Readonly<
  z.infer<typeof SquareMerchantResponseSchema>
>;
export type SquareMerchantStatus =
  (typeof SQUARE_ALLOWED_MERCHANT_STATUSES)[number];

export function parseSquareMerchantResponse(
  input: unknown
): SquareResponseParserResult<SquareMerchantResponse> {
  try {
    const parserInput = squareResponseParserInput(input);
    const provenance = squareResponseProvenance(parserInput);
    const response = squareSafeJsonObject(parserInput.response);

    if (squareProviderErrorState(response) === "present") {
      return squareUnsupportedResult(
        "square_merchant_provider_errors_present",
        "$response.errors"
      );
    }

    const rawItems = merchantResponseItems(response);
    const items = rawItems.map((item) =>
      minimizeSquareMerchant(item, provenance)
    );
    assertUniqueMerchantAuthorities(items);
    return squareAcceptedResult(
      SquareMerchantResponseSchema.parse({
        contractVersion: SQUARE_MERCHANT_RESPONSE_CONTRACT_VERSION,
        minimizationVersion: SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION,
        entityType: "merchant",
        provider: provenance,
        items,
        itemCount: items.length
      })
    );
  } catch (error) {
    return squareFailureResult(error);
  }
}

export function minimizeSquareMerchant(
  input: unknown,
  provenance: SquareResponseProvenance
): SquareMinimizedMerchant {
  const merchant = squareSafeJsonObject(input, "$response.merchant[]");
  const id = squareRequiredIdentifier(merchant, "id", "$response.merchant[].id");
  const providerEnvironment = provenance.providerEnvironment;

  return SquareMinimizedMerchantSchema.parse({
    contractVersion: SQUARE_MERCHANT_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION,
    entityType: "merchant",
    entityVersion: SQUARE_MERCHANT_LOCATION_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment,
      entityType: "merchant",
      providerId: id
    },
    provider: provenance,
    id,
    status: squareRequiredEnum(
      merchant,
      "status",
      "$response.merchant[].status",
      SQUARE_ALLOWED_MERCHANT_STATUSES
    ),
    displayName: squareOptionalNullableDisplayText(
      merchant,
      "business_name",
      "$response.merchant[].business_name",
      255
    ),
    country: squareRequiredCountryCode(
      merchant,
      "country",
      "$response.merchant[].country"
    ),
    languageCode: squareOptionalNullableLanguageCode(
      merchant,
      "language_code",
      "$response.merchant[].language_code"
    ),
    currency: squareOptionalNullableCurrencyCode(
      merchant,
      "currency",
      "$response.merchant[].currency"
    ),
    mainLocationId: squareOptionalNullableIdentifier(
      merchant,
      "main_location_id",
      "$response.merchant[].main_location_id",
      32
    ),
    createdAt: squareOptionalNullableTimestamp(
      merchant,
      "created_at",
      "$response.merchant[].created_at"
    )
  });
}

export function squareMerchantFingerprint(input: SquareMinimizedMerchant) {
  return squareMinimizedProjectionFingerprint(
    SquareMinimizedMerchantSchema.parse(input)
  );
}

function merchantResponseItems(
  response: SquareSafeJsonObject
): readonly SquareSafeJsonObject[] {
  if (!Object.prototype.hasOwnProperty.call(response, "merchant")) {
    throw new Error("square_merchant_response_missing");
  }
  const raw = response.merchant;
  if (Array.isArray(raw)) {
    if (raw.length > 250) {
      throw new Error("square_merchant_response_too_large");
    }
    return raw.map((item) =>
      squareSafeJsonObject(item, "$response.merchant[]")
    );
  }
  return [squareSafeJsonObject(raw, "$response.merchant")];
}

function assertUniqueMerchantAuthorities(
  items: readonly SquareMinimizedMerchant[]
) {
  const seen = new Set<string>();
  for (const item of items) {
    const identity = `${item.authority.providerEnvironment}:${item.authority.entityType}:${item.authority.providerId}`;
    if (seen.has(identity)) {
      squareRejectResponse(
        "square_duplicate_authority_identity",
        "$response.merchant[].id"
      );
    }
    seen.add(identity);
  }
}
