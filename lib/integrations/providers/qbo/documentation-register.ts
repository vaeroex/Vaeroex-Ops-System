import {
  QBO_CDC_POLICY_VERSION,
  QBO_ERROR_POLICY_VERSION,
  QBO_PAGINATION_POLICY_VERSION,
  QBO_PROVIDER_ADAPTER_VERSION,
  QBO_REPORT_CONTRACT_VERSION,
  QBO_SOURCE_RECORD_CONTRACT_VERSION,
  QBO_WEBHOOK_CONTRACT_VERSION
} from "@/lib/integrations/providers/qbo/contracts";

export const QBO_DOCUMENTATION_CHECKED_DATE = "2026-08-21" as const;

export type QboDocumentationStatus =
  | "confirmed_provider_behavior"
  | "vaeroex_implementation_policy"
  | "deferred_runtime_authority";

export type QboDocumentationRegisterEntry = Readonly<{
  claimKey: string;
  status: QboDocumentationStatus;
  claim: string;
  sourceUrl: string;
  checkedDate: typeof QBO_DOCUMENTATION_CHECKED_DATE;
  relevantContractVersion: string;
}>;

export const QBO_OFFICIAL_DOCUMENTATION_LINKS = [
  "https://developer.intuit.com/app/developer/qbo/docs/get-started",
  "https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries",
  "https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture",
  "https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/data-objects",
  "https://github.com/IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents",
  "https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/net/reports",
  "https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/net/exception-handling",
  "https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting",
  "https://developer.intuit.com/app/developer/qbpayments/docs/learn/scopes",
  "https://blogs.a.intuit.com/2018/09/10/quickbooks-online-api-best-practices/"
] as const;

export const QBO_DOCUMENTATION_REGISTER: readonly QboDocumentationRegisterEntry[] = [
  {
    claimKey: "qbo_online_only_rest_accounting_api",
    status: "confirmed_provider_behavior",
    claim: "QBO V1 targets QuickBooks Online Accounting API behavior only; QuickBooks Desktop and customer-hosted Web Connector are out of scope.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbo/docs/get-started",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_PROVIDER_ADAPTER_VERSION
  },
  {
    claimKey: "qbo_accounting_scope_metadata_only",
    status: "confirmed_provider_behavior",
    claim: "The accounting scope identifier is com.intuit.quickbooks.accounting; Phase 7 records this as static provider metadata and performs no OAuth exchange or token storage.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbpayments/docs/learn/scopes",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_PROVIDER_ADAPTER_VERSION
  },
  {
    claimKey: "qbo_query_startposition_maxresults",
    status: "confirmed_provider_behavior",
    claim: "QBO query pagination uses STARTPOSITION and MAXRESULTS semantics; Vaeroex plans bounded pages and does not rely on sortable QBO IDs.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_PAGINATION_POLICY_VERSION
  },
  {
    claimKey: "qbo_cdc_lookback",
    status: "confirmed_provider_behavior",
    claim: "QBO CDC returns changed objects since a timestamp, with documented lookback up to 30 days; Vaeroex plans overlapping windows and bisection for dense windows.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_CDC_POLICY_VERSION
  },
  {
    claimKey: "qbo_webhooks_cloudevents_v1",
    status: "confirmed_provider_behavior",
    claim: "Current QBO webhook fixtures target CloudEvents 1.0 style arrays with type, intuitentityid, intuitaccountid, time, and optional data.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/data-objects",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_WEBHOOK_CONTRACT_VERSION
  },
  {
    claimKey: "qbo_webhook_signature_later_authority",
    status: "deferred_runtime_authority",
    claim: "Webhook signature cryptography requires verifier secret authority and remains deferred to runtime/broker integration.",
    sourceUrl: "https://github.com/IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_WEBHOOK_CONTRACT_VERSION
  },
  {
    claimKey: "qbo_reports_modernized_control_observation",
    status: "confirmed_provider_behavior",
    claim: "QBO report parsing targets the modernized Reports API response direction and treats reports as non-additive control observations.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/net/reports",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_REPORT_CONTRACT_VERSION
  },
  {
    claimKey: "qbo_error_fault_categories",
    status: "confirmed_provider_behavior",
    claim: "QBO SDK/API error material distinguishes validation, service, authentication, and authorization failures; Vaeroex maps raw provider bodies to safe typed categories.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/net/exception-handling",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_ERROR_POLICY_VERSION
  },
  {
    claimKey: "qbo_retry_and_rate_observation",
    status: "vaeroex_implementation_policy",
    claim: "Phase 7 parses Retry-After and records conservative internal limiter metadata without sleeping, queueing, or encoding stale provider maxima as authority.",
    sourceUrl: "https://blogs.a.intuit.com/2018/09/10/quickbooks-online-api-best-practices/",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_ERROR_POLICY_VERSION
  },
  {
    claimKey: "qbo_minimization_untrusted_source",
    status: "vaeroex_implementation_policy",
    claim: "QBO minimized objects remain untrusted_external_input and cannot bypass validation, canonical normalization, authority, reconciliation, contributions, or deterministic intelligence.",
    sourceUrl: "https://developer.intuit.com/app/developer/qbo/docs/get-started",
    checkedDate: QBO_DOCUMENTATION_CHECKED_DATE,
    relevantContractVersion: QBO_SOURCE_RECORD_CONTRACT_VERSION
  }
] as const;
