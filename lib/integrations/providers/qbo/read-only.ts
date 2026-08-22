export type QboHttpOperation = Readonly<{
  method: string;
  path: string;
  queryText?: string | null;
}>;

const allowedReadPaths = [
  /^\/v3\/company\/[A-Za-z0-9._:-]+\/query$/,
  /^\/v3\/company\/[A-Za-z0-9._:-]+\/reports\/[A-Za-z0-9]+$/,
  /^\/v3\/company\/[A-Za-z0-9._:-]+\/cdc$/
];

const forbiddenQueryTerms = /\b(?:insert|update|delete|drop|create|batch|send|void|sparse|operation)\b/i;

export function assertQboReadOnlyOperation(operation: QboHttpOperation) {
  if (operation.method.toUpperCase() !== "GET") {
    throw new Error("qbo_read_only_violation:method");
  }
  if (!allowedReadPaths.some((pattern) => pattern.test(operation.path))) {
    throw new Error("qbo_read_only_violation:path");
  }
  if (operation.queryText && forbiddenQueryTerms.test(operation.queryText)) {
    throw new Error("qbo_read_only_violation:query");
  }
  return {
    readOnly: true as const,
    enforcedBy: "qbo_phase_7_adapter_policy_v1" as const
  };
}
