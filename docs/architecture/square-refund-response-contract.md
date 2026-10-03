# Dormant Square PaymentRefund response contract

## Scope and sources

Separately versioned `square_refund_response_v1`, `square_refund_minimizer_v1`, and `square_refund_request_authority_v1` projections. `parseSquareRefundResponse` handles both existing `list_payment_refunds` and `retrieve_payment_refund` operations. The entity is **PaymentRefund**, not legacy Refund or OrderReturn. No tracked Square roadmap phase identifier exists. This slice adds no execution or provider registration.

Pinned Square API **2026-08-19**, Node SDK **45.1.0**, revision **e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76**. Sources checked before implementation:

- [PaymentRefund](https://developer.squareup.com/reference/square/objects/PaymentRefund), [ListPaymentRefunds](https://developer.squareup.com/reference/square/refunds-api/list-payment-refunds), [GetPaymentRefund](https://developer.squareup.com/reference/square/refunds-api/get-payment-refund), [ProcessingFee](https://developer.squareup.com/reference/square/objects/ProcessingFee), [Money](https://developer.squareup.com/reference/square/objects/Money).
- [Pinned PaymentRefund type](https://github.com/square/square-nodejs-sdk/blob/e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76/src/api/types/PaymentRefund.ts) and [serializer](https://github.com/square/square-nodejs-sdk/blob/e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76/src/serialization/types/PaymentRefund.ts); their Git blobs match the local audited archive: `4815977b422ac3025ea8597330aef0ff59ce4d30`, `b0d077102502262933dfda673d82f415383e429d`.
- Pinned `src/{api,serialization}/types/{ListPaymentRefundsResponse,GetPaymentRefundResponse,ProcessingFee,Money}.ts`. List type/serializer blobs: `cfbfa99644753728d35ac3b898d39a912cee0cd1`, `24aa7baa8a445924540a0e0d837a6accb7457207`; Get: `21a600c62dba8f0415fcc0d22c69cf692d522932`, `132afd0245b0ca02e3ef63b95f273a2cbadaf744`.

## Field audit: API, SDK representation, acceptance policy

The SDK's optional serializers accept raw null and may normalize it to undefined; optionalNullable preserves it. This parser consumes raw JSON, not decoded SDK objects. Except for `unlinked`, optional absent/null scalar fields normalize to null; no business meaning is inferred. A present optional object must have the expected shape. Unknown keys are bounded and discarded, not recursively projected.

| Raw field | API / pinned SDK | Vaeroex policy and retained output |
| --- | --- | --- |
| `id` | Required string, 1–255 characters; serializer required/non-null | Required safe identifier, 1–255; refund authority ID. Existing Get request path limit remains 191, distinct from returned IDs. List supports 255. |
| `status` | Optional nullable string, max 50; documented PENDING, COMPLETED, REJECTED, FAILED | Retain those values or null; unknown syntactic enum token is unsupported, malformed token rejected. No success inference. |
| `location_id` | Optional nullable string, max 50 | Safe identifier or explicit absent location state; present ID must be authorized and match any requested location. Missing/null does not inherit a query location. |
| `unlinked` | Optional boolean; raw serializer also permits null, decoded type omits it | `unlinkedState` absent/null/provided plus `unlinked` null/null/boolean preserves absent/null/false/true distinctly. No relationship inferred from other optional fields. |
| `destination_type` | Optional nullable string, max 50; CARD, BANK_ACCOUNT, WALLET, BUY_NOW_PAY_LATER, CASH, EXTERNAL, SQUARE_ACCOUNT | Retain documented values or null; unknown token unsupported. It is not the list request's original-payment `source_type`. |
| `amount_money` | Required Money object; SDK required/non-null | Required object, including `{}` because Money members are optional. Independent exact amount/currency; no sums, netting, positivity or lifecycle assumptions. |
| `payment_id`, `order_id` | Optional nullable strings, max 192 each | Safe identifiers become unverified references, each containing only provider/environment/entity/ID/reference-kind. No tenant, connection, merchant or location authority over the referenced resource. Neither is required. |
| `created_at`, `updated_at` | Optional RFC3339 strings, max 32; raw optional serializer admits null | Strict existing calendar/timestamp validation, max 32, nullable output; no timestamp ordering inference. |
| `processing_fee` | Optional nullable ProcessingFee array; no documented API/SDK cardinality | Normalize missing/null to empty, max 1,000 from existing raw safety policy. Retain all entries, including identical adjustments; deterministic fingerprint ordering without deduplication. |
| fee `effective_at`, `type`, `amount_money` | Optional nullable timestamp/type; optional Money admits raw null. INITIAL/ADJUSTMENT; no published string maxima | Existing 4,096-character raw bound; timestamp validation; known fee enums or null, unknown token unsupported. Money independent and signed; missing/null Money differs from present empty Money. |
| Money `amount`, `currency` | Optional nullable int64 / optional Currency; SDK amount bigint, raw bigint or number | Existing raw JSON safe-integer range ±9,007,199,254,740,991 represented as canonical integer text, no rounding. Reject fractional, unsafe, nonfinite, negative-zero, bigint and numeric strings. Preserve zero and sign. Currency uses the existing three-uppercase-letter plus runtime `Intl.supportedValuesOf("currency")` acceptance policy, not the SDK enum in its entirety (for example XXX is not accepted on Node 24); missing/null members remain null. No currency conversion or cross-field currency equality. |
| `app_fee_money` | Optional Money: developer contribution to the refunded amount | Excluded. No developer-contribution reconciliation requirement exists in this milestone. This is not a fee-adjustment substitute. |
| `app_fee_allocations` | Optional unknown array, raw null accepted; no published cardinality | Excluded recipient/contributor details; only existing raw bounds apply. |
| `destination_details` | Optional DestinationDetails, raw null accepted | Entire instrument/destination subtree excluded; no instrument fields are trusted. |
| `reason` | Optional nullable string, max 192 | Excluded free text; raw safety only, not a trusted field constraint. |
| `team_member_id` | Optional string, max 192, raw null accepted | Excluded identity; raw safety only. |
| `terminal_refund_id` | Optional string, raw null accepted; no published max | Excluded operational reference; raw safety only. |
| All other metadata / nested unknown Money or fee members | Not in the retained allowlist | Bounded, discarded and fingerprint-neutral. Canaries never reach output, diagnostics, exceptions or logs. |

Identifiers use the established safe token alphabet `[A-Za-z0-9._:-]`, not arbitrary provider strings. Money acceptance is a bounded response representation, not an assertion that Square permits negative refund-creation requests. No write contract is introduced. Out-of-range int64 values remain outside the established JSON-number acceptance policy; shared limits are unchanged.

Partial refunds, several distinct refund IDs referencing one Payment, unsuccessful/pending states, and unlinked refunds without payment/order IDs are supported. Refund amounts and fee adjustments are not reconciled with one another or with `Payment.refunded_money`. There is no settlement/revenue/net-sales/accounting inference, complete-history claim, or inventory/Order-return relationship.

## Envelopes, trusted authority and pagination

List fields are optional in the SDK and serializer. Missing/null refunds normalize to an empty page. The SDK documents mutually exclusive errors/refunds: non-null arrays for both are not accepted (nonempty errors always yield unsupported first). Empty/null/missing errors do not indicate failure by themselves. Error entries must be bounded objects, at most 100. Nonempty errors never expose provider detail. Get requires a non-null refund for an accepted result. SDK documentation permits a FAILED refund alongside errors; that combination yields unsupported, whereas FAILED without errors is accepted. Get rejects List keys/cursor and List rejects the singular Get key.

API List maximum is 100, default 100; fewer results can occur and updates are eventually consistent. Existing request policy accepts explicit limits 1–100 (the API itself clamps larger limits). The response cannot exceed the requested limit. Duplicate refund IDs reject rather than collapse. Returned items sort by ID then projection fingerprint. The response explicitly states `response_page_not_complete_refund_history`; final pagination is not complete-history or settlement authority.

Trusted context supplies workspace UUID, connection UUID, merchant identifier and a unique 1–1,000 authorized-location set. Provider metadata cannot replace it. Get's required trusted refund ID must match exactly. List with `location_id` requires the same trusted `locationId`; without that query parameter, `locationId` must be absent/null and the request spans seller locations. Every present returned location still must be authorized. Missing locations remain absent, including in an all-location response; the result has no authority for an unknown location.

The existing dormant request validator authorizes all query keys: begin/end time, sort order, cursor, location, status, original-payment source type, limit, updated-time bounds, sort field. Literal query assembly rejects separators before validation. No response destination/source equality is imposed. Existing request/cursor fingerprints are reused unchanged. A separate versioned request-authority hash includes the full cursor-free query fingerprint, provider/environment, operation, connection/merchant/workspace, requested ID/location and sorted authorized locations. Continuations require both the existing cursor binding and a hash of the prior raw cursor bound to that full authority. Changing filters, scope or cursor rejects. Missing/null/empty returned cursor means terminal; only its hash is retained. No raw cursor or complete history is persisted.

## Upfront exact projection bound

Derived before writing the parser, independently of Payment/Order caps. Count **expanded container occurrences**, not unique object identities. The raw preflight likewise counts every value occurrence, including repeated aliases, with a 20,000-value limit. Existing constraints also include depth 12, arrays 1,000, object properties 64, keys 128 and strings 4,096. Trusted invocation fields are separately bounded and collapse to fixed-width authority/provenance objects and hash strings; authorized-location arrays and query objects do not enter the result.

For a non-null List array let `P` be refunds, `A` present processing-fee arrays, `F` fee entries, `M` present fee Money objects, `Q` non-null Payment/Order references, and `S` all remaining raw scalar/null/excluded values. Missing/null List arrays have no items and only seven result containers, so cannot determine the maximum. Every refund requires its object, ID scalar and Money object, so:

```
R = 2 + 3P + A + F + M + Q + S <= 20,000
C = 7 + 5P + F + M + Q
0 <= P <= 100; 0 <= A <= P; F <= 1,000A; M <= F; Q <= 2P; S >= 0
C <= min(20,005 + 2P - A, 7 + 7P + 2,000A)
```

The seven fixed containers are accepted root, diagnostics array, response, response provenance, connection authority, pagination and items array. Each refund contributes five: projection, authority, provenance, required Money, and the always-present fee array. Each fee, fee Money and unverified reference contributes one. Versions, statuses, timestamps, unlinked presence/value, counters, semantic labels and fingerprints are primitives, not hidden containers. Optional absent/null/populated fields are exhausted by this decomposition: scalar population only consumes `S`; optional fee Money and references are already counted. Excluded structures only increase `S`. Present empty fee arrays consume `A` without a corresponding increase in output, making them non-optimal.

Enumerating all **5,151** feasible `(P,A)` pairs gives **20,195**, at `(100,10)`. Also algebraically: `A <= 9` gives `C <= 18,707`; `A >= 10` gives `C <= 20,195`. It is attained, not merely an optimistic bound: 100 unique-ID refunds, 100 empty required Money objects, both references on every refund, and **9,744** fees each with empty Money across ten arrays (nine of 1,000 and one of 744). Raw count is `2+300+10+9,744+9,744+200=20,000`; output is `7+500+9,744+9,744+200=20,195`. Thus no mixed supported branch can exceed the fixed cap.

Get has one refund, at most 1,000 fees, 1,000 optional fee Money objects and two references: **2,014** containers (`7+5+1,000+1,000+2`). A valid witness requires 2,007 raw values; bounded discarded padding attains exactly 20,000 without changing its projection. Each remaining retained scalar can also be populated without increasing containers. Both fixtures use schema-permitted empty Money, not an invented mandatory amount/currency pair.

The local accepted-result cap is therefore exactly **20,195**, independently versioned and without empirical headroom. Tests enumerate the bound, count valid witnesses, cover aliases, and inject graphs with 20,195/20,196 expanded containers: the first reaches schema/hash validation and the second rejects before either. The same wrapper-inclusive guard runs before accepted-factory hashing/freezing. All legitimate raw inputs are already bounded before minimization/schema/hashes. Depth, branch widths, string length and raw value count bound CPU/memory; fees are sorted at most 1,000 per refund and total productive occurrences are budget-bounded. This is a finite linear traversal plus bounded sorting, not an unbounded amplification path. No live transport or external caller is added.

## Accepted-result integrity and compatibility

The established server-only pattern is local to Refunds: Proxy-first raw inspection before reflection, canonical sanitizer and recheck, no accessors/cycles/sparse arrays, iterative expanded-container verification, exact result identity and current-invocation value/hash authentication. Replays, clones, mutations, forged results, proxies/revoked proxies, unexpected prototypes, sanitizer/factory faults and double faults fail closed. Legitimate results preserve identity and deep freezing. Failure details are restricted to static whitelisted codes and `$input`/`$response` roots; static fallback does not depend on the failing sanitizer. Public fingerprint helpers preflight before schema/hash traversal.

Order, Payment, shared raw limits, request/cursor policies, provider descriptors, registry and QBO are untouched. Focused regressions are registered beside Payments in package scripts and CI. Existing Square/provider/architecture golden regressions remain required. Square stays dormant/unregistered; no routes, writes, transport, OAuth, credentials, persistence, database, model calls or deployment configuration are introduced.

## Fingerprint audit

These synthetic fixture goldens are pinned in the focused suite; `sha256:` prefixes are part of every value. The request and cursor rows exercise the existing GetRefund operation policy, not a change to it.

| Refund fingerprint | Value |
| --- | --- |
| Entity | `sha256:5c75a5898232c705cbefb757dd0e7090813dfb84d8e7afd91500563c17d7f38f` |
| Response | `sha256:671637a013f9d252e6bf6228dfc87998ca7e0307860845d1aa35dc34bb585c1e` |
| Get request | `sha256:d4f323f695eda8e811597c66e6cb0de6229139688c8ec81c716b0d76730815b5` |
| Get cursor binding | `sha256:97afee68ba17452562c90452eab2fd2acb0d66253cc51b15fd9a1439d52a254b` |

Preserved existing regression goldens:

| Existing fingerprint | Unchanged value |
| --- | --- |
| Square descriptor | `sha256:fe6cc473b1fb529bc07a7c5471baf5eae047ea9500cec7c12840876dfe666771` |
| QBO descriptor | `sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f` |
| Registry | `sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad` |
| Orders Search request | `sha256:79b16a44b07c214a0e0f3cf06f36a05bf67000ad27119e1955713d0a64fddd05` |
| Orders cursor binding | `sha256:8a219cd66c389b04e8a84a9b1602b863a75b7bd04ac80d5b5a119eccc09b8b6d` |
| Order core entity | `sha256:417e585883fad9634504dcae2290a568f62ac3b3ac6cea09f1b0bb94c1fd1a34` |
| Order core response | `sha256:f958b476d1bb34889c98a0af9293056edbb086d39c52cac54b9187f8888e3938` |
| Line-item detail | `sha256:667d21354e744d7b75687c36932b72b563f2093d25104b063eafca61ef5d284d` |
| Line-item response | `sha256:8c0b7b9ceda5b8cf1e18c06071a0de40221d3c2e228f7de45f67fc5741ce23dc` |
| Adjustment detail | `sha256:2b69a233bd2409059458a79bbcccc9018c4a7d6267a0fb1a9ba70e7b613d8335` |
| Adjustment response | `sha256:d2b5295118c3b8bccbc71d749620cc4cda4a089ff2d9f8954b8c49291f766cea` |
| Tender detail | `sha256:d2ee980b11131a78e4ea1351f1677720b5b55ae53781a16c2230a02dd469f57c` |
| Tender response | `sha256:dae08df69fe87134902a04b18726604b8d8c84dcceec82a928ebc9d01312a86e` |
| Payment entity | `sha256:5fd44df5ae0a440845c0a2aa9e6a4fc67adb27b6ff88f070f811b9c179200ba0` |
| Payment response | `sha256:1282fff4b53dd89fb7409ccc14fa5c849ea76157c86ffc563b5364a4a9b07b10` |
| Payment Get request | `sha256:4d582b7f0856c4aefc5ca7e1e605d3b5469e785ac222a2a1228d2775490c5180` |
| Payment Get cursor binding | `sha256:623b8c79ed75af5471e7b9cd4c24e0380115cfefd0eed76e62d6567694476619` |
