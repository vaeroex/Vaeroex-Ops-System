# Dormant Catalog response validation

## Scope and sources

The existing Catalog minimizer already covers CATEGORY, ITEM, ITEM_VARIATION, MODIFIER_LIST, MODIFIER, DISCOUNT and TAX for ListCatalog, SearchCatalogObjects, RetrieveCatalogObject and BatchRetrieveCatalogObjects. This milestone adds a request-bound server-only facade; it does not replace completed minimization or register a provider. The legacy parser is a low-level projection API, not a connection-authorized ingestion boundary. New integrations must use `parseSquareCatalogValidatedResponse`.

Sources: Square API **2026-08-19**, Node SDK **45.1.0**, revision `e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76`. The pinned API types and serializers for CatalogObject/Base, the seven object wrappers and data types, Money, ListCatalogResponse, SearchCatalogObjectsResponse, GetCatalogObjectResponse and BatchGetCatalogObjectsResponse were checked against remote blob hashes and the local archive. Official endpoint contracts: [List](https://developer.squareup.com/reference/square/catalog-api/list-catalog), [Search](https://developer.squareup.com/reference/square/catalog-api/search-catalog-objects), [Retrieve](https://developer.squareup.com/reference/square/catalog-api/retrieve-catalog-object), [Batch](https://developer.squareup.com/reference/square/catalog-api/batch-retrieve-catalog-objects).

The SDK object union requires a discriminator and the general object base requires ID (the generated dual-purpose CatalogObjectCategory type marks its ID optional). Version, updated time, deletion marker, data branches and many data fields are optional; serializers also admit raw null for optional fields. The existing Vaeroex projection deliberately requires ID, positive safe-integer version, updated time and explicit deletion boolean for every supported record. A live record requires matching type data; a tombstone omits business data. It requires item variations (1–250), variation parent/pricing and fixed-price Money; modifier parent/Money; discount type and its coherent amount/percentage fields; tax phase/inclusion/percentage. These are **Vaeroex acceptance policies**, not claims that every field is provider-required. Existing policies/goldens remain unchanged. Optional envelope nulls are treated as absent by the new facade, as in the pinned serializers.

List supports at most 100 primary records, explicit requested types and no deleted primary records. Search supports a requested limit up to 1,000 and includes deleted primary records only on request. Retrieve checks the requested primary ID; Batch permits a subset of up to 1,000 requested primary IDs, not an assertion all requested IDs exist. Related and explicitly included resources remain separate; their IDs are not required to be primary requested IDs. Historical object versions must not exceed the requested catalog version (Retrieve documents an as-of snapshot); equality is not imposed on every object in a catalog snapshot. Arbitrary search query content is bound cryptographically, not reevaluated as a query engine. Cursor continuation requires both the established request-validator binding and the full connection/query authority binding.

Search's requested limit is advisory: a response with more than that many objects is accepted within the existing 1,000-object schema and raw-resource bounds. There is no invented 100-object Search default. The advisory limit remains cryptographically bound to pagination. The generated SDK `SearchCatalogObjectsRequest` and official Search docs explicitly confirm this distinction from List's current 100-object page size.

## Minimized facts and explicit gaps

Authority is the trusted workspace/connection/merchant tuple plus provider/environment; Catalog applicability is seller-wide data, not proof a location is authorized. Global/category, all-locations-except, specific-locations and inherited-modifier applicability stay provider facts. Display names/SKUs do not establish identity. Parent/category IDs and the legacy modifier-parent authority-shaped key are unresolved references: the wrapper explicitly declares relationship non-authority. No relation lookup, location authorization, stock conversion, accounting or reconciliation is performed.

Prices remain exact nonnegative safe-integer minor-unit strings with currency; percentages remain exact canonical decimals. No floating-point money arithmetic or cross-currency inference. Tombstone IDs/version/time survive; names, prices and children are removed. Related duplicate representations are allowed only when the existing minimized identities agree; duplicate occurrences in the same relationship bucket and conflicts reject. Nested item children must be ITEM_VARIATION and modifier-list children MODIFIER.

Existing unsupported policy remains: non-MVP types, text/quantity-enabled modifier lists, unsupported positive selection constraints, modifier location overrides/child lists and product-set taxes are unsupported for the whole response. Custom attributes, descriptions/HTML, contacts, URLs/images, user metadata, employee/vendor data and unmodeled e-commerce/booking fields are discarded. Item tax/modifier-list associations, measurement-unit/stock-conversion and variation location overrides are not promoted into inventory or transactional facts. Existing output is a minimized Catalog summary, not the complete catalog or inventory configuration.

## Upfront projection bound

Let R be expanded raw values (all containers and primitive occurrences, including repeated shared references), N the number of expanded Catalog object occurrences, and E the raw containers used by projected category references or Money. Every supported Catalog occurrence, **including a tombstone**, consumes at least six raw values: object container, type, ID, version, updated time, deletion boolean. Live records additionally require a data container and branch-specific fields. Reference and Money input containers are disjoint from those six values and from other occurrences in expanded traversal.

| Object | Own fixed containers, live maximum | Tombstone maximum | Extra containers charged to E |
| --- | ---: | ---: | --- |
| CATEGORY | 4 | 4 | Optional parent-category reference: 1 |
| ITEM | 7 | 7 | Up to 250 category references; children counted as separate N |
| ITEM_VARIATION | 5 | 5 | Optional/fixed Money: 1 |
| MODIFIER_LIST | 6 | 6 | Up to 250 modifiers counted as separate N |
| MODIFIER | 5 | 4 | Price Money: 1 |
| DISCOUNT | 5 | 5 | Amount or maximum Money: at most 1 in accepted branches |
| TAX | 5 | 5 | None |

Own fixed containers include object, authority, provenance, availability and its generated location-ID array where applicable, generated item category/variation arrays, modifier arrays and modifier parent-reference key. Populating scalar optionals changes no containers. Missing generated arrays still count. An optional extra container has a corresponding raw container even when empty. Related/included/nested repetitions are each counted, including shared provenance repeated in the result.

Fixed result overhead is **9**: accepted root and diagnostics array; projection root, provider, connection authority and pagination; primary, related and included arrays. Fingerprints/version/scope/count fields are scalars. Consequently `R >= 1 + 6N + E` and `C <= 9 + 7N + E`, so `C <= 8 + R + floor((R-1)/6) <= 23,341` for `R <= 20,000`.

This is a proven conservative cap, not a claimed tight maximum. The derivation intentionally relaxes the stricter actual cardinalities: 100 List primary, one Retrieve primary, 1,000 Search/Batch primary, 1,000 related and combined included records, 250 nested children/category references and 1,000 location IDs. All envelopes and mixtures therefore fit it. An included-resources wrapper consumes additional raw budget and produces no extra output wrapper. Get's one-object envelope also fits the same inequality. No current supported branch can amplify beyond this cap; optional discarded fields consume budget without increasing C.

Both raw and accepted-result walks count repeated occurrences, reject cycles/Proxies/accessors/sparse arrays before schema/fingerprint work, and use bounded depth/array/property/string sizes. Local raw bounds remain 20,000 values, depth 12, arrays 1,000, properties 64, strings 4,096. The accepted local cap is 23,341 containers, depth 32. Shared limits and Order/Payment/Refund contracts are unchanged. These bounds keep input inspection, cloning, freezing and hashing finite; tests include structural maximum raw cases, aliases and exact-cap/cap-plus-one early rejection.

## Verification

The dedicated regression suite records new versioned request-authority/response fingerprints and compares legacy entity/response fingerprints. It covers authority/request mismatches, all four envelopes, types/deletion/version, references, pagination, privacy, raw and accepted boundaries, factory replay/forgery/faults and deep immutability. Existing two Catalog suites remain required compatibility evidence. This is fixture-tested dormant code, not sandbox end-to-end validation or production activation.

Baseline fixture: Retrieve CATEGORY `SQ2B1B1CAT001`, synthetic sandbox merchant/connection. New and preserved golden fingerprints:

| Contract | SHA-256 (prefix `sha256:`) |
| --- | --- |
| New validated response | `e0e64ecba46bc02c0b763c6b5a7e0c96b6a499ab551eaa27bc29e31c9efce1f0` |
| New request authority | `8821d687adc2db492abc59516060ecff846282a7f42c324cff657cd3d66a6bcd` |
| Preserved request | `390c21eedbcf4c9cf633da9ab6f805760948605b0696194d320260c718544634` |
| Preserved cursor binding | `f858235b1de3542ba703d1e7e1e8b6e65df6cedd700eadceb44c0476e877a5ce` |
| Preserved legacy entity | `a3c1e278ad2651889bb10dbfc2e2d87116176cbe12f7c58c534eb3023123c61c` |
| Preserved legacy response | `45b9eae3c566ed321a56e52c807c8b8f8825e5f4da359397cb0fe4ae238b503a` |

The structural maximum test uses exactly 20,000 expanded raw values across 1,000 primary ITEM tombstones, 1,000 related ITEM tombstones and 1,000 included MODIFIER_LIST tombstones; its result contains 20,009 containers, below the **proven conservative** cap. Tests separately enumerate the relaxed allocation bound, check every branch's fixed-container charge, use productive/nonproductive shared references, consume the exact raw budget in each envelope, and verify 23,341 versus 23,342 accepted-result containers reach/bypass neither schema nor fingerprint validation incorrectly. The conservative cap is not claimed to be attainable by a valid response.
