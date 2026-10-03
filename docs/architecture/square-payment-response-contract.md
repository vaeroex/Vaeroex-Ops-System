# Dormant Square Payment response contract

This milestone implements `parseSquarePaymentResponse` for the existing `list_payments` and `retrieve_payment` operation keys. It does not activate Square. API version remains `2026-08-19`; Square Node SDK is `45.1.0`, revision `e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76`.

## Source audit and normalization policy

The pinned SDK [Payment type](https://github.com/square/square-nodejs-sdk/blob/e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76/src/api/types/Payment.ts) and [serializer](https://github.com/square/square-nodejs-sdk/blob/e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76/src/serialization/types/Payment.ts) make every retained Payment field optional. SDK `optional()` accepts raw missing/null and maps both to undefined. ProcessingFee `effective_at`/`type` use `optionalNullable()`, which distinguishes missing and null. Vaeroex deliberately normalizes both to null, following the existing minimized contracts. Explicit undefined is not JSON and rejects.

| Retained provider field | Purpose | Authoritative shape and limits | Vaeroex projection |
|---|---|---|---|
| `id` | Identify this provider record | Optional string, API maximum 192 | Nullable ID, explicit absent/provider-ID state; existing safe identifier alphabet |
| `location_id` | Fence a returned location to trusted authorization | Optional string, API maximum 50 | Nullable location and explicit absence; never inferred from request |
| `order_id` | Future comparison with an independently validated Order | Optional string, API maximum 192 | Unverified reference with provider/environment/type/ID only |
| `created_at`, `updated_at` | Provider change timing | Optional RFC3339 strings, API maximum 32 | Existing strict timestamp validation; no lifecycle ordering |
| `status` | Provider payment state | Optional string, API maximum 50; documented APPROVED/PENDING/COMPLETED/CANCELED/FAILED | Known values or null; unknown token unsupported, malformed value rejected |
| `source_type` | Provider payment classification | Optional string, API maximum 50; documented CARD/BANK_ACCOUNT/WALLET/BUY_NOW_PAY_LATER/SQUARE_ACCOUNT/CASH/EXTERNAL | Separate response vocabulary; existing request vocabulary unchanged |
| `amount_money` | Provider amount excluding tip | Optional Money | Exact independent Money projection |
| `tip_money` | Provider tip amount | Optional Money | Exact independent Money projection |
| `total_money` | Provider total including amount and tip | Optional Money | Retain; never recompute or verify arithmetic |
| `refunded_money` | Provider aggregate refunded to date | Optional Money | Marked provider aggregate, not verified Refund records |
| `processing_fee` | Provider fees and adjustments | Optional array of ProcessingFee | Missing/null/empty become empty array; maximum 1,000 from existing raw array policy |
| fee `effective_at` | When the fee/adjustment takes effect | Optional-nullable RFC3339 string; no API field maximum | Existing timestamp validation under 4,096 raw string limit |
| fee `type` | Distinguish initial fee from adjustment | Optional-nullable string, documented INITIAL/ADJUSTMENT; no API field maximum | Known values/null; unknown token unsupported |
| fee `amount_money` | Independently reported signed fee | Optional Money; negative values explicitly permitted | Exact independent Money projection |

The SDK does not define closed enums for these string fields. The known-value policy prevents unknown free text from entering trusted output. Excluded instrument details do not add discriminated schema requirements: CARD, CASH, BANK_ACCOUNT, WALLET, BUY_NOW_PAY_LATER, SQUARE_ACCOUNT and EXTERNAL use the same minimal projection. Electronic-money details and all other unknown fields remain excluded; a new source string is unsupported, not silently promoted to a known category.

Money uses the established `{amountMinor: string|null, currency: string|null}` representation. Missing/null whole Money becomes null; `{}` remains a present Money with null members; zero remains `"0"`. Missing/null members normalize to null. The existing safe JSON number range (signed integers through ±9,007,199,254,740,991) is retained exactly. Fractional/unsafe numbers, bigint and strings used as amounts reject. The SDK itself deserializes int64 amounts as bigint; this dormant parser accepts bounded wire JSON, not SDK-deserialized bigint objects. No positivity, cross-field currency, lifecycle or arithmetic invariant is added. Fees remain a multiset: identical adjustments are preserved, and ordering uses their minimized fingerprints.

## Invocation, envelopes, authority and pagination

The strict invocation contains `providerKey`, `providerEnvironment`, `apiVersion`, `operation`, `connectionAuthority`, `requestContext`, and `response`. Trusted `connectionAuthority` supplies workspaceId, connectionId, providerEntityType=`merchant`, and providerEntityId. No provider payload can set them.

Both operations require trusted, unique `authorizedLocationIds` (1–1,000). List additionally takes `locationId` (trusted resolved request location, including the seller's default location when the query omits location_id) and a string-valued `query` object. An explicit query location must equal that trusted location. Present response locations must match the List location and authorized set. Missing locations remain absent, with no location authority. List identity is optional; non-null duplicate IDs reject, including duplicates at different locations. ID-less entries remain separate, deterministically sorted projections. Get takes `paymentId`; it must match a present response ID, with missing ID explicitly unsupported. The existing request policy restricts requested IDs to its existing 191-character path bound; response/Order-reference IDs support the documented 192-character field bound.

List normalizes missing/null/empty `payments` to an empty list, bounded by the requested limit (default/max 100). Get requires a non-null `payment` object; missing payload without provider errors rejects. Opposite-operation envelope fields reject. Both accept missing/null/empty `errors`; nonempty object error arrays (maximum 100) yield unsupported with no provider details. Invalid error shapes reject. Raw unknown fields are bounded and discarded.

List cursor missing/null/empty means final page. A nonempty cursor is validated under the existing cursor alphabet and raw 4,096-character cap, then retained only as a hash. Get rejects any cursor field. Existing `assertSquareReadOperation` validates all request query branches and its original request/cursor fingerprints remain exact. Because its older cursor binding omits some supported filters (`total`, offline filters, `sort_field`), the new request-authority fingerprint also includes the complete cursor-free request fingerprint, trusted tenant/connection/merchant, locations and requested Payment ID. Continuation requires both the existing `expectedCursorBindingFingerprint` and `expectedResponseCursorFingerprint` from the previous response. The latter binds the exact returned cursor to the complete query and authority. All fields used to form these hashes are either trusted invocation data or minimized provider data.

## Projection bound derived before implementation

The raw response limit is 20,000 values counted per recursive occurrence, including scalars and containers. Other unchanged limits: depth 12, arrays 1,000, object keys 64, keys 128 characters, strings 4,096 characters. The shared Order boundary remains 60,000 and is untouched. Payment has its own 20,295-container boundary, including the accepted result and diagnostics array, and the established result depth 32/array 1,000/object 64/string 4,096 limits.

The entire supported shape inventory is:

| Component | Minimum marginal raw values | Result containers |
|---|---:|---:|
| List envelope | 2 (root + payments array) | 7 fixed global containers |
| Get envelope | 1 (root) | 7 fixed global containers |
| Payment shell, all optional fields absent | 1 | 4: Payment, authority, provenance, fee array |
| Each of four Payment Money objects | 1 | 1 |
| Non-null Order ID | 1 | 1 reference |
| Populated processing_fee array | 1 | 0 additional (already counted) |
| Fee shell | 1 | 1 |
| Fee Money object | 1 | 1 |
| Money members, IDs, timestamps, enums, cursor, unknown fields | At least 1 | 0 |

Global seven = accepted result, diagnostics array, response value, response provenance, connection authority, pagination, items array. Authority/identity/location states, request/cursor fingerprints, counts and semantic markers are primitives. Missing/null Money and references contribute zero; fee array always exists. There are no nested Payment, Order, instrument, refund, accounting or other projection branches.

Let P be Payments, A be nonempty fee arrays, F fees, M Money objects and Q Order references; S counts all other raw values. For List:

`R = 2 + P + A + F + M + Q + S <= 20,000`

`C = 7 + 4P + F + M + Q`

with `P <= 100`, `A <= P`, `F <= 1,000A`, `M <= F + 4P`, `Q <= P`, `S >= 0`. Thus for any allocation, `C <= min(20,005 + 3P - A, 7 + 9P + 2,000A)`. Enumerating all 5,151 pairs `0 <= A <= P <= 100` gives exactly **20,295**, at P=100/A=10. A witness uses 100 ID-less Payments, four empty Money objects and an Order reference on each, 9,694 fees each with empty Money packed into ten arrays: `R=2+100+10+500+19,388=20,000`, `C=7+400+500+19,388=20,295`. No other retained branch has a better ratio; populated scalar fields only reduce capacity. Smaller requested limits and empty envelopes can only reduce this bound.

Get has one Payment and at most 1,000 fees. All optional containers populated give `7+4+4+1+2,000 = 2,016` containers. A matching requested ID costs one raw scalar. Minimum raw witness cost is `1+1+1+1+4+1+2,000 = 2,009`; the remaining raw budget can be filled with discarded bounded values without altering the projection. The regression exercises exactly 20,000 raw values for this maximum as well.

Shared objects do not evade either model: raw checks/sanitization count every occurrence, clone each occurrence, and only use an active-ancestor cycle set. Result traversal also counts each occurrence and rejects active cycles. Exact 20,295 and 20,296 result probes use shared references to verify inclusive/reject behavior before schema/fingerprint revalidation. Raw 20,000/20,001 probes verify the independent raw budget. All loops, hashes and schema traversals are bounded by these limits; the dormant parser has no external execution route.

## Privacy and compatibility

Only the listed fields are retained. Customer/employee/team-member IDs, contact data, addresses, notes/free text, reference_id, receipts/URLs, refund IDs, app/approved fees, app allocations, card/bank/wallet/gift-card/electronic-money and other instrument details, risk/device/application/offline metadata, capabilities, version tokens and unknown fields are discarded after raw safety checks. Synthetic canaries and fingerprint-neutrality regressions cover these paths, including fields nested within Money and fees.

The accepted-result boundary follows the existing Order implementation locally, without extracting or modifying it: Proxy-safe reflection, static fallback, allowed diagnostic codes with root-only fields, current-invocation result/value identity and fingerprint authentication, and deep freezing. Provider errors and faults never escape as provider strings or logs. QBO, existing Order schemas/fingerprints/limits, request validators, descriptors and active registries remain unchanged.

Primary API references: [Payment](https://developer.squareup.com/reference/square/objects/Payment), [ProcessingFee](https://developer.squareup.com/reference/square/objects/ProcessingFee), [Money](https://developer.squareup.com/reference/square/objects/Money), [ListPayments](https://developer.squareup.com/reference/square/payments-api/list-payments), [GetPayment](https://developer.squareup.com/reference/square/payments-api/get-payment). The source module records the pinned SDK type and serializer URLs for all five relevant types.
