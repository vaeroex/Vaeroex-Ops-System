import {
  SQUARE_API_VERSION,
  SQUARE_PROVIDER_KEY,
  type SquareProviderEnvironmentKey
} from "@/lib/integrations/providers/square/contracts";

export const SQUARE_PHASE_2B1A_SYNTHETIC_CURSOR =
  "sq2b1aCursorPageToken001==" as const;

export const SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES = {
  merchantOwnerEmail: "sq2b1a-merchant-owner@example.test",
  merchantContactPhone: "+15550101010",
  merchantStreetAddress: "1 Synthetic Merchant Way",
  merchantCustomerNote: "sq2b1a-customer-note-canary",
  locationBusinessEmail: "sq2b1a-location@example.test",
  locationPhone: "+15550202020",
  locationStreetAddress: "2 Synthetic Location Ave",
  locationCoordinates: "sq2b1a-location-coordinate-canary",
  locationSocial: "sq2b1a-social-canary"
} as const;

export type SquarePhase2B1AInputOverrides = Readonly<{
  providerKey?: unknown;
  providerEnvironment?: unknown;
  apiVersion?: unknown;
}>;

export function squarePhase2B1AParserInput(
  response: unknown,
  overrides: SquarePhase2B1AInputOverrides = {}
) {
  return {
    providerKey: overrides.providerKey ?? SQUARE_PROVIDER_KEY,
    providerEnvironment: overrides.providerEnvironment ?? "sandbox",
    apiVersion: overrides.apiVersion ?? SQUARE_API_VERSION,
    response
  };
}

export function squarePhase2B1AMerchant(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    id: "SQ2B1AMERCHANT001",
    business_name: "Café São Paulo 東京 Ops",
    country: "US",
    language_code: "en-US",
    currency: "USD",
    status: "ACTIVE",
    main_location_id: "SQ2B1ALOCATION001",
    created_at: "2026-08-19T12:00:00.000Z",
    version: 1,
    ...overrides
  };
}

export function squarePhase2B1ALocation(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    id: "SQ2B1ALOCATION001",
    merchant_id: "SQ2B1AMERCHANT001",
    name: "Grant Park Café 東京",
    timezone: "America/Los_Angeles",
    status: "ACTIVE",
    country: "US",
    currency: "USD",
    type: "PHYSICAL",
    created_at: "2026-08-19T12:30:00.000Z",
    updated_at: "2026-08-19T13:30:00.000Z",
    version: 1,
    ...overrides
  };
}

function withoutKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[]
) {
  const copy = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

export function squarePhase2B1AMerchantEnvelope(
  merchantOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    merchant: [squarePhase2B1AMerchant(merchantOverrides)],
    ...envelopeOverrides
  };
}

export function squarePhase2B1ALocationEnvelope(
  locationOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    locations: [squarePhase2B1ALocation(locationOverrides)],
    ...envelopeOverrides
  };
}

export const SQUARE_PHASE_2B1A_MERCHANT_FIXTURES = {
  active: squarePhase2B1AMerchantEnvelope(),
  inactive: squarePhase2B1AMerchantEnvelope({
    id: "SQ2B1AMERCHANT002",
    business_name: "Northwind Atelier Montréal",
    country: "CA",
    language_code: "fr-CA",
    currency: "CAD",
    status: "INACTIVE",
    main_location_id: "SQ2B1ALOCATION002",
    created_at: "2026-08-18T10:00:00.000Z",
    version: 2
  }),
  multiple: {
    merchant: [
      squarePhase2B1AMerchant(),
      squarePhase2B1AMerchant({
        id: "SQ2B1AMERCHANT003",
        business_name: "Kyoto Books",
        country: "JP",
        language_code: "ja-JP",
        currency: "JPY",
        status: "ACTIVE",
        main_location_id: "SQ2B1ALOCATION003",
        created_at: "2026-08-17T08:00:00.000Z",
        version: 3
      })
    ]
  },
  empty: { merchant: [] },
  paginated: {
    merchant: [],
    cursor: SQUARE_PHASE_2B1A_SYNTHETIC_CURSOR
  },
  optionalNulls: squarePhase2B1AMerchantEnvelope({
    id: "SQ2B1AMERCHANT004",
    business_name: null,
    country: "GB",
    language_code: null,
    currency: null,
    status: "ACTIVE",
    main_location_id: null,
    created_at: null,
    version: 4
  }),
  contactAndOwnerCanaries: squarePhase2B1AMerchantEnvelope({
    owner_email: SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.merchantOwnerEmail,
    phone_number: SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.merchantContactPhone,
    address: {
      address_line_1:
        SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.merchantStreetAddress,
      locality: "Synthetic City",
      postal_code: "00000"
    },
    customer: {
      note: SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.merchantCustomerNote
    },
    account: { plan: "synthetic-plan" }
  }),
  unexpectedNestedFields: squarePhase2B1AMerchantEnvelope({
    nested_extra: {
      arbitrary: {
        field: "safe-extra-field"
      }
    }
  }),
  missingRequired: {
    merchant: [withoutKeys(squarePhase2B1AMerchant(), ["id"])]
  },
  unknownStatus: squarePhase2B1AMerchantEnvelope({ status: "PAUSED" }),
  malformedTimestamp: squarePhase2B1AMerchantEnvelope({
    created_at: "2026-99-99T99:99:99Z"
  }),
  malformedCurrency: squarePhase2B1AMerchantEnvelope({ currency: "US" }),
  fractionalVersion: squarePhase2B1AMerchantEnvelope({ version: 1.5 }),
  unsafeVersion: squarePhase2B1AMerchantEnvelope({
    version: Number.MAX_SAFE_INTEGER + 1
  }),
  oversizedDisplayName: squarePhase2B1AMerchantEnvelope({
    business_name: "A".repeat(256)
  }),
  htmlDisplayName: squarePhase2B1AMerchantEnvelope({
    business_name: "<script>alert('synthetic')</script>"
  }),
  bidirectionalDisplayName: squarePhase2B1AMerchantEnvelope({
    business_name: "Cafe\u202Eeman"
  }),
  controlDisplayName: squarePhase2B1AMerchantEnvelope({
    business_name: "Cafe\u0008Name"
  }),
  prototypePollution: JSON.parse(
    `{"merchant":[{"id":"SQ2B1AMERCHANT005","business_name":"Pollution Test","country":"US","language_code":"en-US","currency":"USD","status":"ACTIVE","main_location_id":"SQ2B1ALOCATION005","created_at":"2026-08-19T12:00:00.000Z","__proto__":{"polluted":true}}]}`
  )
} as const;

export const SQUARE_PHASE_2B1A_LOCATION_FIXTURES = {
  active: squarePhase2B1ALocationEnvelope(),
  inactive: squarePhase2B1ALocationEnvelope({
    id: "SQ2B1ALOCATION002",
    merchant_id: "SQ2B1AMERCHANT002",
    name: "Montréal Counter",
    timezone: "America/Toronto",
    status: "INACTIVE",
    country: "CA",
    currency: "CAD",
    type: "PHYSICAL",
    created_at: "2026-08-18T10:30:00.000Z",
    updated_at: null,
    version: 2
  }),
  multiple: {
    locations: [
      squarePhase2B1ALocation(),
      squarePhase2B1ALocation({
        id: "SQ2B1ALOCATION003",
        merchant_id: "SQ2B1AMERCHANT003",
        name: "Tokyo Mobile",
        timezone: "Asia/Tokyo",
        status: "ACTIVE",
        country: "JP",
        currency: "JPY",
        type: "MOBILE",
        created_at: "2026-08-17T09:00:00.000Z",
        updated_at: "2026-08-17T09:30:00.000Z",
        version: 3
      }),
      squarePhase2B1ALocation({
        id: "SQ2B1ALOCATION004",
        merchant_id: "SQ2B1AMERCHANT004",
        name: "London Office",
        timezone: "Europe/London",
        status: "ACTIVE",
        country: "GB",
        currency: "GBP",
        type: "PHYSICAL",
        created_at: "2026-08-16T09:00:00.000Z",
        updated_at: "2026-08-16T09:30:00.000Z",
        version: 4
      })
    ]
  },
  empty: { locations: [] },
  paginated: {
    locations: [],
    cursor: SQUARE_PHASE_2B1A_SYNTHETIC_CURSOR
  },
  optionalNulls: squarePhase2B1ALocationEnvelope({
    id: "SQ2B1ALOCATION005",
    merchant_id: null,
    name: null,
    timezone: "Europe/London",
    status: "ACTIVE",
    country: "GB",
    currency: "GBP",
    type: null,
    created_at: null,
    updated_at: null,
    version: 5
  }),
  contactAddressAndSocialCanaries: squarePhase2B1ALocationEnvelope({
    phone_number: SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.locationPhone,
    business_email: SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.locationBusinessEmail,
    address: {
      address_line_1:
        SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.locationStreetAddress,
      locality: "Synthetic City",
      postal_code: "00000"
    },
    coordinates: {
      latitude: 37.7749,
      longitude: -122.4194,
      canary: SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.locationCoordinates
    },
    business_hours: {
      periods: [
        {
          day_of_week: "MON",
          start_local_time: "09:00:00",
          end_local_time: "17:00:00"
        }
      ]
    },
    twitter_username: SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES.locationSocial,
    instagram_username: "sq2b1a_social"
  }),
  unexpectedNestedFields: squarePhase2B1ALocationEnvelope({
    nested_extra: {
      arbitrary: {
        field: "safe-extra-field"
      }
    }
  }),
  missingTimezone: {
    locations: [withoutKeys(squarePhase2B1ALocation(), ["timezone"])]
  },
  invalidTimezone: squarePhase2B1ALocationEnvelope({ timezone: "Mars/Olympus" }),
  unsupportedTimezoneAlias: squarePhase2B1ALocationEnvelope({
    timezone: "US/Pacific"
  }),
  missingRequired: {
    locations: [withoutKeys(squarePhase2B1ALocation(), ["id"])]
  },
  unknownStatus: squarePhase2B1ALocationEnvelope({ status: "OPEN" }),
  unknownType: squarePhase2B1ALocationEnvelope({ type: "KIOSK" }),
  malformedTimestamp: squarePhase2B1ALocationEnvelope({
    created_at: "2026-99-99T99:99:99Z"
  }),
  malformedCurrency: squarePhase2B1ALocationEnvelope({ currency: "US" }),
  fractionalVersion: squarePhase2B1ALocationEnvelope({ version: 1.5 }),
  unsafeVersion: squarePhase2B1ALocationEnvelope({
    version: Number.MAX_SAFE_INTEGER + 1
  }),
  oversizedDisplayName: squarePhase2B1ALocationEnvelope({
    name: "L".repeat(256)
  }),
  htmlDisplayName: squarePhase2B1ALocationEnvelope({
    name: "<img src=x onerror=alert('synthetic')>"
  }),
  bidirectionalDisplayName: squarePhase2B1ALocationEnvelope({
    name: "Location\u202Eeman"
  }),
  controlDisplayName: squarePhase2B1ALocationEnvelope({
    name: "Location\u0008Name"
  }),
  prototypePollution: JSON.parse(
    `{"locations":[{"id":"SQ2B1ALOCATION006","merchant_id":"SQ2B1AMERCHANT006","name":"Pollution Test","timezone":"America/Los_Angeles","status":"ACTIVE","country":"US","currency":"USD","type":"PHYSICAL","created_at":"2026-08-19T12:00:00.000Z","__proto__":{"polluted":true}}]}`
  )
} as const;

export function squarePhase2B1AOversizedMerchantArray() {
  return {
    merchant: Array.from({ length: 251 }, (_, index) =>
      squarePhase2B1AMerchant({
        id: `SQ2B1AM${String(index).padStart(8, "0")}`,
        main_location_id: `SQ2B1AL${String(index).padStart(8, "0")}`
      })
    )
  };
}

export function squarePhase2B1AOversizedLocationArray() {
  return {
    locations: Array.from({ length: 501 }, (_, index) =>
      squarePhase2B1ALocation({
        id: `SQ2B1AL${String(index).padStart(8, "0")}`,
        merchant_id: `SQ2B1AM${String(index).padStart(8, "0")}`
      })
    )
  };
}

export function squarePhase2B1AOversizedCursorEnvelope(
  entity: "merchant" | "location"
) {
  return entity === "merchant"
    ? squarePhase2B1AMerchantEnvelope({}, { cursor: "C".repeat(4_097) })
    : squarePhase2B1ALocationEnvelope({}, { cursor: "C".repeat(4_097) });
}

export function squarePhase2B1AOversizedObjectEnvelope(
  entity: "merchant" | "location"
) {
  const oversized = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`extra_${index}`, index])
  );
  return entity === "merchant"
    ? squarePhase2B1AMerchantEnvelope(oversized)
    : squarePhase2B1ALocationEnvelope(oversized);
}

export function squarePhase2B1AEnvironmentInput(
  response: unknown,
  providerEnvironment: SquareProviderEnvironmentKey
) {
  return squarePhase2B1AParserInput(response, { providerEnvironment });
}
