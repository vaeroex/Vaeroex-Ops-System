# External Integrations Phase 7 QBO Provider Contract Register

Checked date: 2026-08-21

Phase 7 freezes pure QuickBooks Online provider adapter contracts only. It does
not implement OAuth, credentials, live provider calls, webhook ingress, queues,
customer UI, AI mapping, or KPI promotion.

## Confirmed Provider Behavior

| Claim | Source |
| --- | --- |
| QBO V1 targets QuickBooks Online Accounting API behavior, not QuickBooks Desktop or Web Connector. | https://developer.intuit.com/app/developer/qbo/docs/get-started |
| The accounting scope identifier used as metadata is `com.intuit.quickbooks.accounting`. | https://developer.intuit.com/app/developer/qbpayments/docs/learn/scopes |
| QBO query pagination uses `STARTPOSITION` and `MAXRESULTS` style behavior. | https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries |
| CDC returns changed entities since a timestamp and documents a lookback up to 30 days. | https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture |
| Current webhook fixtures target CloudEvents 1.0 payload arrays with entity, operation, account, object ID, and event time metadata. | https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/data-objects |
| QBO reports are parsed through the Reports API shape and treated by Vaeroex as non-additive control observations. | https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/net/reports |
| QBO errors distinguish validation, service, authentication, and authorization families. | https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/net/exception-handling |

## Vaeroex Policy

| Policy | Rationale |
| --- | --- |
| QBO source data remains `untrusted_external_input`. | Provider parsing cannot bypass Phase 1 validation, Phase 2 reconciliation, or deterministic contribution boundaries. |
| Report rows are never additive financial transaction facts. | Reports can reconcile or control-check transaction streams, but must not double count revenue, spend, cash, or balances. |
| Adapter read behavior is enforced even if a later credential layer receives a broad Intuit accounting scope. | Phase 7 is read-only and must not expose write/batch/void/create/update/delete accounting operations. |
| Webhook signature verification is deferred to later runtime authority. | Signature verification requires verifier-secret custody and belongs with the broker/credential boundary, not pure parsing. |
| Rate-limit code parses `Retry-After` and records observations only. | Phase 7 does not sleep, queue, schedule, or encode stale provider maximums as tenant authority. |
