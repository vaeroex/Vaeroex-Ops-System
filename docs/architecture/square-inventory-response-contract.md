# Dormant Square Inventory response contract

## Scope and source pin

Fixture-tested, server-only response validation is not live Inventory ingestion or production activation. The pure parseSquareInventoryResponse parser covers the five already-allowlisted operations. No registration, endpoint/scope broadening, transport, persistence, QBO change or stock calculation occurs. API: **2026-08-19**. SDK: **45.1.0**, revision **e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76**.

Types and raw serializers were read at this revision and their GitHub blob SHAs compared with the local archive: all 52 rows below match. The SDK optional serializer accepts absent/raw null; optionalNullable also represents null. This parser accepts snake-case raw JSON, not decoded SDK camel-case objects.

## Operations and envelopes

| Existing operation | Pinned SDK envelope | Accepted payload | Limit/pagination |
| --- | --- | --- | --- |
| retrieve_inventory_count | GetInventoryCountResponse | counts array | Paginated, unsorted; local raw array policy max1,000. Every catalog ID must match the requested ID. |
| retrieve_inventory_adjustment | GetInventoryAdjustmentResponse | adjustment object | One non-null adjustment required by local policy; exact requested ID; no cursor. |
| retrieve_inventory_physical_count | GetInventoryPhysicalCountResponse | count object | One non-null physical count required by local policy; exact requested ID; no cursor. |
| inventory_counts_batch_retrieve | BatchGetInventoryCountsResponse | counts array | Requested limit1–1,000; omitted/null collection is an empty page, never zero stock. |
| inventory_changes_batch_retrieve | BatchGetInventoryChangesResponse | changes array | Requested limit1–1,000; PHYSICAL_COUNT or ADJUSTMENT with its matching non-null payload. |

Sources: [Retrieve count](https://developer.squareup.com/reference/square/inventory-api/RetrieveInventoryCount), [Retrieve adjustment](https://developer.squareup.com/reference/square/inventory-api/retrieve-inventory-adjustment), [Retrieve physical count](https://developer.squareup.com/reference/square/inventory-api/retrieve-inventory-physical-count), [Batch counts](https://developer.squareup.com/reference/square/inventory-api/batch-retrieve-inventory-counts), [Batch changes](https://developer.squareup.com/reference/square/inventory/BatchRetrieveInventoryChanges). The Retrieve count web cache displayed an older API version; its current pinned SDK request/type/serializer establishes the unchanged envelope and pagination contract. The other endpoint/object pages displayed2026-08-19.

Old adjustment examples use location_id and an invalid timestamp. Current pinned from_location_id/to_location_id fields and valid RFC3339 take precedence. Nonempty provider errors are unsupported, with no provider error text retained. Malformed errors reject; empty errors with data are accepted because these Inventory serializers do not declare that combination mutually exclusive. Wrong-operation envelopes, missing single records and cursor on nonpaginated Get reject. Unknown raw fields are structurally checked before discard.

## Provider contract versus acceptance policy

- [InventoryCount](https://developer.squareup.com/reference/square/objects/InventoryCount) fields are SDK-optional. Local policy requires catalog ID, location ID and known state for a stable composite snapshot identity, never a manufactured provider ID. Quantity, catalog type, calculated timestamp and is_estimated remain nullable; omitted is_estimated does not become false.
- [InventoryAdjustment](https://developer.squareup.com/reference/square/objects/InventoryAdjustment) and [InventoryPhysicalCount](https://developer.squareup.com/reference/square/objects/InventoryPhysicalCount) require the otherwise SDK-optional provider ID by local policy. Other retained fields remain nullable. Current adjustment location endpoints are separate values; no single location is synthesized.
- Inventory/catalog/location/group IDs use safe-token syntax and max100; legacy Transaction/Refund references allow255. Unspecified-length auxiliary Inventory reference IDs use the same local100 policy. Request validators are not widened. Catalog type supports ITEM_VARIATION and documented read-only ITEM; absent type remains absent.
- All17 pinned InventoryState values, including UNTRACKED, are retained; the existing request allowlist is unchanged. Return/composition/transit states remain provider source facts, not derived return or transfer records. [InventoryChange](https://developer.squareup.com/reference/square/objects/InventoryChange) has only PHYSICAL_COUNT and ADJUSTMENT in the pinned enum. TRANSFER/future tags are unsupported. Multiple non-null payload variants reject.
- Quantities preserve exact signed decimal text, max26 characters and five fractional digits, including leading/trailing zeros. Numbers, exponents, plus signs, whitespace and malformed decimals reject. No rounding or quantity arithmetic occurs.
- Calculated/occurred/created timestamps are nullable RFC3339, max34 characters, preserving offsets. Historical reads do not receive invented timestamp ordering or write-time24-hour rules.
- Money retains nullable canonical safe-integer minor-unit text and nullable validated currency; empty Money is accepted. Both retained amounts are nonnegative: total_price_money states this explicitly, while cost_money inherits the pinned [Money contract's unsigned default](https://developer.squareup.com/reference/square/objects/Money), with no signed exception. Missing/null members and zero remain supported. No currency merging, lifecycle inference, accounting or valuation is performed.

## Units, relationships and privacy

[CatalogMeasurementUnit](https://developer.squareup.com/reference/square/objects/CatalogMeasurementUnit) is optional on change wrappers: nullable precision0–5 and optional measurement unit. Omitted precision is not defaulted to3. [MeasurementUnit](https://developer.squareup.com/reference/square/objects/MeasurementUnit) supports one selected custom/area/length/volume/weight/generic/time branch, using the existing unchanged Order measurement schema. All pinned standard enum values are tested. Custom name/abbreviation are required display-only business labels. Declared type must match its unit; the pinned type enum has no TIME value, so time permits absent/null type. Precision checks significant fractional digits without changing exact quantity text.

Catalog object, measurement unit, legacy Transaction, legacy Refund, purchase order, goods receipt, physical count and adjustment links are **unverified references**: provider/environment/type/ID, no tenant/connection authority or fetched entity. Legacy Refund is not PaymentRefund; legacy Transaction is not Payment. These fields preserve source relationships for a future separately authorized reconciliation step.

Adjustment group retains optional group ID/root-adjustment reference/from/to states so composition events are not conflated. Reason retains the pinned enum and optional custom-reason reference: CUSTOM does not invent a required reference; a supplied custom reference on a non-CUSTOM reason rejects. No reason/group labels or lookup endpoints are added. Both reported Money fields preserve provider quantity/value context, not calculated valuation.

Excluded: application reference_id, source application, employee/team-member/vendor IDs, arbitrary notes, contact/customer information, metadata and unknown fields. Legacy adjustment location_id is not promoted into current-schema authority. Discarded nested data is still subject to the complete raw budget. Canary tests verify output, diagnostics and fingerprints stay free of those excluded values.

## Trusted invocation and deterministic queries

Invocation binds workspace UUID, connection UUID, merchant ID, provider/environment/version, operation and a nonempty unique authorized-location set(max1,000). Existing assertSquareReadOperation validates the actual GET query or POST body, including environment-prefixed POST operation keys. GET query/body cardinalities remain those of the existing request policy: Retrieve counts location_ids<=100; Batch count catalog IDs<=1,000; Batch change catalog IDs<=500; both Batch location sets<=100; response page<=requested limit<=1,000. No existing request contracts change.

Requested single identity and supplied catalog filters must match records. Every supplied location endpoint must be authorized; when a location filter is present, at least one supplied endpoint must match. Missing optional provider locations remain null rather than borrowing requested authority.

The complete cursor-free normalized request fingerprint, operation, provider/environment, connection authority, requested identity and sorted authorized locations produce the separately versioned Inventory request-authority fingerprint. Continuations require both established cursor binding and the prior response-cursor fingerprint under that authority. Opaque cursor text is discarded; only presence/scoped hash survive. Cursor-free batch bodies must be valid requests, so continuations repeat original filters/limit instead of silently replacing them.

State filters are not authority. Batch counts documents ignored NONE/SOLD/UNLINKED_RETURN states. Batch changes states filter applies only to ADJUSTMENT without a safe documented from-versus-to selector. Filters are fully bound, but no to-state-only response condition, physical-count state condition or occurred-at comparison to calculated/created-time filters is invented. Requested types, catalog IDs, locations, limits and operation envelopes are checked.

Snapshots deduplicate by catalog/location/state within trusted provenance/connection. Changes deduplicate by record kind/provider ID, without conflating physical counts with adjustments. Items sort canonically by identity, not a promise of chronological provider order. Output explicitly describes one page, not complete history or stock. Orders/Refunds are not converted into movements; no reconciliation, valuation, persistence or accounting facts are computed.

## Upfront expanded-container bound

The local cap was selected from this finite schema table before guard implementation, not from a chosen fixture. Containers mean objects/arrays in expanded traversal. Repeated shared references count every time, including shared provenance. An active-ancestor set rejects cycles without discounting aliases. Primitive values, quantity/Money text and fingerprint strings add zero containers.

| Generated component | Maximum containers |
| --- | ---: |
| Result, diagnostics, response, response provenance, connection, pagination, item array | 7 |
| Any record, its provenance, its flat authority | 3 |
| Catalog reference | 1 |
| Adjustment's five causal references | 5 |
| Adjustment's two Money objects | 2 |
| Group and root-adjustment reference | 2 |
| Reason and custom-reason reference | 2 |
| Measurement wrapper, unit and custom-unit data | 3 |
| Measurement-unit reference | 1 |
| Physical count's adjustment reference | 1 |

Per record: snapshot<=4, physical count<=9, adjustment<=19. No record is simultaneously physical count and adjustment. Nullable/missing fields and standard/custom unit choices can only reduce those maxima. No repeated child lists occur within a record. With S snapshots, P physical counts and A adjustments, S+P+A<=1,000:

**C_result <=7+4S+9P+19A <=19,007.**

Actual envelopes narrow this further: count pages<=4,007; Get adjustment(no wrapper measurement)<=22; Get physical count<=12; mixed changes<=19,007. This is conservative, not a claim that1,000 fully populated adjustments fit the raw budget.

Independently, the entire raw response must fit **20,000 expanded values**, depth12, array length1,000, object properties64, key length128 and string length4,096. Every raw primitive/container, populated option and shared occurrence counts. Discarded fields consume budget without increasing projection size. Intersection with the finite projection cap covers every schema/envelope combination: raw limits never justify enlarged arrays or alias discounts. Shared repository limits remain unchanged.

Regressions enumerate4,096 productive optional adjustment shapes, exercise every unit branch and verify full single-record container counts19/9/4. Generated pages start with1,000 records, spend budget on productive references/Money/group/reason/unit cells, then pad only unused raw capacity:

| Witness | Expanded raw values | Result containers |
| --- | ---: | ---: |
| 1,000 adjustments with productive unit expansion until raw budget exhausted | 20,000 | 17,506 |
| 500 physical counts+500 adjustments, all custom units, remaining raw padding | 20,000 | 14,007 |
| 1,000 snapshots, Retrieve and Batch tested separately | 20,000 | 4,007 |
| Schema-maximal Get adjustment plus discarded raw padding | 20,000 | 22 |
| Schema-maximal Get physical count plus discarded raw padding | 20,000 | 12 |

17,506 is not asserted to be the exact global maximum; safety follows from19,007 for every supported combination, including unselected witnesses. At exactly19,007 an injected repeated-container graph reaches schema/fingerprint validation;19,008 rejects before either. Productive shared raw graphs accept at20,000 and reject at20,001. Result depth32/array1,000/properties64/string4,096 plus raw depth12/value20,000 keep CPU/memory bounded without unbounded recursion, alias bypass or empirical headroom.

## Result boundary and regression evidence

Local guards follow the reviewed Refund pattern without editing shared code: Proxy-first descriptor inspection, including revoked Proxies and operation inputs; no accessors, symbols, cycles, sparse/custom arrays or non-data prototypes; iterative expanded traversal; deep freeze/schema/fingerprint validation. A current-invocation closure authenticates the exact accepted factory result/value identity and pre-factory fingerprint. Replays, forgeries, factory mutation, shallow freeze and hostile nested output fail closed.

Diagnostics use whitelisted codes and root-only $input/$response. Sanitizer/factory failures and double faults use static frozen rejection. Oversized output rejects before post-factory schema/fingerprint work; public fingerprint helpers also preflight. Legitimate accepted results retain identity and deep immutability. No logs or network calls occur.

Focused command: node scripts/external-integrations-square-inventory-response-validation-regression-tests.js. Coverage includes all five operations, optionality,17 states,16 reasons, all unit enums, identity/location/query/cursor mismatches, legacy ID length100/101/255/256, exact values, privacy, deterministic ordering, structural boundaries, Proxy/revoked/accessor/cycle/sparse defenses, forgery/replay/current-invocation authentication, sanitizer/factory/double faults and deep-freeze identity. Combined gates and exact-head CI are coordinator-owned.

## Versioned fingerprints

| Fixture | Fingerprint |
| --- | --- |
| Inventory adjustment entity | sha256:137735a1396a5e0764f7ed5ba3850f009407a72ed72ffbf395de23de3228f3bc |
| Inventory Get response | sha256:33d4d4c1fe57abb03165405c654a822731f259daed0a8b2240271242ef87c863 |
| Existing adjustment GET request | sha256:893235a0a42993ebe9d290605731701abfcece343e758aa67304591550af6809 |
| Existing adjustment GET cursor binding | sha256:6db698d298c7d0836e79f2fe539e70bdd713be0937f28b5dcbca4f785c4aa947 |

New namespaces: square_inventory_response_v1, square_inventory_minimizer_v1, square_inventory_request_authority_v1, square_inventory_response_cursor_v1. This module changes no Order/Payment/Refund/descriptor/registry/request/QBO contract.

## Pinned source blob evidence

All rows matched GitHub at [the pinned SDK revision](https://github.com/square/square-nodejs-sdk/tree/e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76).

| Path | Git blob SHA |
| --- | --- |
| src/api/types/InventoryCount.ts | e313a93b568080cc1be52d5a31b829c6902404cd |
| src/serialization/types/InventoryCount.ts | 44f8582c7892ab878503783eeba82f20c5a47fd6 |
| src/api/types/InventoryAdjustment.ts | 7f3f0ce6b1b7462e831cf8792777df0e469e117b |
| src/serialization/types/InventoryAdjustment.ts | c1a26824830a710759a5116ba49e982281c92b48 |
| src/api/types/InventoryPhysicalCount.ts | bcb7fb1f863afc423ee48764fcc5c63c0192f5fe |
| src/serialization/types/InventoryPhysicalCount.ts | 1ddb1b8edfeaab8813c580eb1f17f8b8f963b94f |
| src/api/types/InventoryChange.ts | 77f57d9c5398577a03251a822daa4e9ed84f2367 |
| src/serialization/types/InventoryChange.ts | 3c18063f363135ffcef799d88a266dbca535912a |
| src/api/types/InventoryState.ts | 9806864887b39466c16913bb086924c7c4b06532 |
| src/serialization/types/InventoryState.ts | 3dab1a753189ff89fc08cbd1dab8003a2b07297b |
| src/api/types/InventoryChangeType.ts | 03a818446b6a74eea9fe2a3d927ddfdd07dd5615 |
| src/serialization/types/InventoryChangeType.ts | 54f301c741194bd01b8b78a6a402d692afae9842 |
| src/api/types/GetInventoryCountResponse.ts | 2296855737d2a74249bf7e822e052d20eb55368b |
| src/serialization/types/GetInventoryCountResponse.ts | e2eaa127f571e1db7bab3dc471ba5d7eccc845b3 |
| src/api/types/GetInventoryAdjustmentResponse.ts | 6ee38b654d3841d3b94a27c83aaae909de8d59d1 |
| src/serialization/types/GetInventoryAdjustmentResponse.ts | 8d797b6554989e5ca2a7a7ecc7c169969bb628e1 |
| src/api/types/GetInventoryPhysicalCountResponse.ts | 969e82f378fa49a4998e04c303c1b2a4b6fc8f00 |
| src/serialization/types/GetInventoryPhysicalCountResponse.ts | 59fec0f1a340d93e5c373828ef99ae999df53c6a |
| src/api/types/BatchGetInventoryCountsResponse.ts | 858db849e492005bea13cb4f62761126e5f8e939 |
| src/serialization/types/BatchGetInventoryCountsResponse.ts | c17b38359ba883d6fe799803d71d6b203bfb8920 |
| src/api/types/BatchGetInventoryChangesResponse.ts | 2dec1c7e9b607e7725ab5af7f85953433e850d1c |
| src/serialization/types/BatchGetInventoryChangesResponse.ts | f4d476d595e262b4ced73e8f2f8863fc019809cb |
| src/api/types/CatalogMeasurementUnit.ts | 9eeca096e1f84de6c01cd62cd3d43dba6e7d84a3 |
| src/serialization/types/CatalogMeasurementUnit.ts | 794c0d76b2707cac44d063fb7459151ad9efb65d |
| src/api/types/MeasurementUnit.ts | 73ed5da3e21f4a56cb4df61d91cf27f40f00ee59 |
| src/serialization/types/MeasurementUnit.ts | 20128864a6365b86fcc369e568f807935af47f86 |
| src/api/types/MeasurementUnitCustom.ts | 4ef6e67116459f1f3775bd99a3d87a8134882918 |
| src/serialization/types/MeasurementUnitCustom.ts | b395b04a525a172df83c51291f346042a8835133 |
| src/api/types/InventoryAdjustmentGroup.ts | 78ef87bd3e9aa66a453d9ae95ed6c2828b0b56da |
| src/serialization/types/InventoryAdjustmentGroup.ts | 5adc519cd08ed6f56a82484bd2deff6bd160cacf |
| src/api/types/InventoryAdjustmentReasonId.ts | 98568f44ecd7adff5fdadf3679bbba6bfd570619 |
| src/serialization/types/InventoryAdjustmentReasonId.ts | 9d603b096f6558e47eef066c6ef13e1993b4fe56 |
| src/api/types/InventoryAdjustmentReasonIdType.ts | d64f4456ae2b97a12a785fb97f00e191d2d449bd |
| src/serialization/types/InventoryAdjustmentReasonIdType.ts | d074c9d4b11f7a92c8f0fb2dbc4dca6bd6dcc46e |
| src/api/types/MeasurementUnitArea.ts | 147030d5446f20771324ceae1c3163274b091b88 |
| src/serialization/types/MeasurementUnitArea.ts | c3c77fb5f583c2a245d13c8d6e3f90b5b40721a6 |
| src/api/types/MeasurementUnitLength.ts | 2c0ae42aba3ee0f7bf6e7b90a4be3b046f91f26e |
| src/serialization/types/MeasurementUnitLength.ts | 2d98c3ba898a5b27b1432b02275031525e6fbb1f |
| src/api/types/MeasurementUnitVolume.ts | 938b067a71bf6e3eb8bddefb29c81dd5f27b4202 |
| src/serialization/types/MeasurementUnitVolume.ts | fd081d550b0fdc3e0b56e82af490646850e9be44 |
| src/api/types/MeasurementUnitWeight.ts | e54cbbdf10b553a3b7da64d648a36ee16759b6d7 |
| src/serialization/types/MeasurementUnitWeight.ts | fcfb45aa82d22989fc947ce8c9a4fa3cb34535de |
| src/api/types/MeasurementUnitGeneric.ts | 41d9a65261a56271efd93245c35a621d93c7f3cd |
| src/serialization/types/MeasurementUnitGeneric.ts | 0d2ca85b9466e6fc27acec9e71f7a564826b2996 |
| src/api/types/MeasurementUnitTime.ts | b0e9383661b5f2bb124d20017da527f4a96240e3 |
| src/serialization/types/MeasurementUnitTime.ts | 9d599c7a5cd3d49a7e89c665efbcb8fef84ea73c |
| src/api/types/MeasurementUnitUnitType.ts | d5d7009134d98123bb3b1c0ae12cabc6819db613 |
| src/serialization/types/MeasurementUnitUnitType.ts | 423f83d529c752e23c6ed555e2c06d2331bd05e0 |
| src/api/types/BatchRetrieveInventoryChangesRequest.ts | edede15a6687aa883d57a07c1dc66e6bb0eff08c |
| src/serialization/types/BatchRetrieveInventoryChangesRequest.ts | 50c6976be0aed123722bfd5b060b15ddde047939 |
| src/api/types/BatchGetInventoryCountsRequest.ts | a08eae5f2cf4b8bebd277a2d2f4b091236b87fa4 |
| src/serialization/types/BatchGetInventoryCountsRequest.ts | e8ee5a47f35391fef113146248c1ba7ba6c3d74a |
