import "server-only";

import { randomUUID } from "crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { securityResponseMessage } from "@/lib/security/security-response";
import type { Database, Json, WorkspaceRole } from "@/lib/supabase/types";

export type ToolOperationType =
  | "READ"
  | "CREATE_DRAFT"
  | "CREATE_RECORD"
  | "UPDATE_RECORD"
  | "DELETE_RECORD"
  | "EXPORT"
  | "BILLING"
  | "ADMIN"
  | "SYSTEM";

export type ToolInitiator = "user" | "ai_suggestion" | "system";

type ToolSpec = {
  name: string;
  operationType: ToolOperationType;
  targetTable?: string;
  schema: z.ZodTypeAny;
  requiresConfirmation: boolean;
  destructive: boolean;
  allowedRoles: WorkspaceRole[];
};

export type ToolExecutionContext = {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userId: string;
  userRole: WorkspaceRole;
};

export type ToolExecutionRequest = {
  toolName: string;
  args: unknown;
  initiatedBy: ToolInitiator;
  confirmationReceived?: boolean;
  targetRecordId?: string | null;
  requestId?: string;
  model?: string | null;
  metadata?: Json;
};

export type ToolExecutionDecision<TArgs = unknown> = {
  allowed: boolean;
  requestId: string;
  tool?: ToolSpec;
  args?: TArgs;
  reasonBlocked?: string;
};

const uuidSchema = z.string().uuid();
const importTypeSchema = z.enum(["kpi", "metrics"]);
const managedActionSchema = z.enum(["archive", "delete", "restore", "move", "duplicate", "edit"]);
const unsafeInstructionPattern = /(;\s*(drop|delete|truncate|alter|update|insert)\b|--|\/\*|\bexecute\s+sql\b)/i;
const safeTextSchema = (maxLength = 240) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !unsafeInstructionPattern.test(value), {
      message: "Unsafe instruction-like content is not allowed in tool arguments."
    });
const saveTargetSchema = z.object({ runId: uuidSchema }).strict();
const recordIdSchema = z.object({ recordId: uuidSchema }).strict();
const recordMutationSchema = z
  .object({
    recordId: uuidSchema,
    collection: safeTextSchema(80).optional(),
    action: managedActionSchema.optional()
  })
  .strict();
const bulkRecordMutationSchema = z
  .object({
    recordIds: z.array(uuidSchema).min(1).max(100),
    collection: safeTextSchema(80).optional(),
    action: managedActionSchema,
    typedConfirmation: z.literal("DELETE").optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "delete" && value.recordIds.length > 1 && value.typedConfirmation !== "DELETE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bulk record deletion requires typed DELETE confirmation.",
        path: ["typedConfirmation"]
      });
    }
  });
const fileImportExtractionSchema = z
  .object({
    fileId: uuidSchema,
    importType: importTypeSchema,
    rowsDetected: z.number().int().min(1).max(10_000).optional()
  })
  .strict();
const fileImportApprovalSchema = z
  .object({
    fileId: uuidSchema,
    importId: uuidSchema,
    importType: importTypeSchema,
    rowsApproved: z.number().int().min(0).max(1_000)
  })
  .strict();
const fileReportSchema = z
  .object({
    fileId: uuidSchema,
    title: safeTextSchema(),
    reportType: safeTextSchema()
  })
  .strict();
const fileToReportSchema = z
  .object({
    fileId: uuidSchema,
    reportId: uuidSchema
  })
  .strict();
const fileMemorySaveSchema = z
  .object({
    fileId: uuidSchema,
    runId: uuidSchema.optional(),
    summary: z.string().trim().min(1).max(4_000)
  })
  .strict();
const kpiMutationSchema = z
  .object({
    kpiId: uuidSchema,
    fieldSet: z.array(safeTextSchema(80)).max(12).optional()
  })
  .strict();
const generatedBriefingSchema = z
  .object({
    title: safeTextSchema(),
    outputType: safeTextSchema(),
    bodyMarkdown: z.string().trim().min(1).max(60_000),
    sourceData: z.unknown().optional()
  })
  .strict();
const completedAnalysisSaveSchema = z
  .object({
    sourceArtifactId: uuidSchema,
    analysisType: z.enum(["executive_brief", "business_health", "finding_explanation"]),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/i)
  })
  .strict();
const deleteGeneratedInsightsSchema = z
  .object({
    runIds: z.array(uuidSchema).min(1).max(25),
    typedConfirmation: z.literal("DELETE").optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.runIds.length > 1 && value.typedConfirmation !== "DELETE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bulk generated insight deletion requires typed DELETE confirmation.",
        path: ["typedConfirmation"]
      });
    }
  });

const OPERATOR_ROLES = ["owner", "admin", "manager"] as WorkspaceRole[];
const ADMIN_ROLES = ["owner", "admin"] as WorkspaceRole[];
const DEFAULT_BLOCK_RATE_LIMIT = 12;
const BLOCK_RATE_LIMIT_WINDOW_MINUTES = 10;

export const TOOL_EXECUTION_REGISTRY = {
  save_completed_analysis: {
    name: "save_completed_analysis",
    operationType: "CREATE_RECORD",
    targetTable: "reports",
    schema: completedAnalysisSaveSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  save_vaeroex_output_sop: {
    name: "save_vaeroex_output_sop",
    operationType: "CREATE_RECORD",
    targetTable: "sops",
    schema: saveTargetSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: ["owner", "admin"] as WorkspaceRole[]
  },
  save_vaeroex_output_report: {
    name: "save_vaeroex_output_report",
    operationType: "CREATE_RECORD",
    targetTable: "reports",
    schema: saveTargetSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: ["owner", "admin"] as WorkspaceRole[]
  },
  save_generated_output_briefing: {
    name: "save_generated_output_briefing",
    operationType: "CREATE_RECORD",
    targetTable: "reports",
    schema: generatedBriefingSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: ["owner", "admin"] as WorkspaceRole[]
  },
  stage_file_import: {
    name: "stage_file_import",
    operationType: "CREATE_RECORD",
    targetTable: "file_imports",
    schema: fileImportExtractionSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  approve_kpi_import: {
    name: "approve_kpi_import",
    operationType: "CREATE_RECORD",
    targetTable: "kpis",
    schema: fileImportApprovalSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  approve_operational_metrics_import: {
    name: "approve_operational_metrics_import",
    operationType: "CREATE_RECORD",
    targetTable: "operational_metrics",
    schema: fileImportApprovalSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  approve_workbook_import: {
    name: "approve_workbook_import",
    operationType: "CREATE_RECORD",
    targetTable: "business_memory_chunks",
    schema: fileImportApprovalSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  create_report_from_file: {
    name: "create_report_from_file",
    operationType: "CREATE_RECORD",
    targetTable: "reports",
    schema: fileReportSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  attach_file_to_report: {
    name: "attach_file_to_report",
    operationType: "UPDATE_RECORD",
    targetTable: "reports",
    schema: fileToReportSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  save_file_analysis_business_memory: {
    name: "save_file_analysis_business_memory",
    operationType: "UPDATE_RECORD",
    targetTable: "file_uploads",
    schema: fileMemorySaveSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  update_kpi_record: {
    name: "update_kpi_record",
    operationType: "UPDATE_RECORD",
    targetTable: "kpis",
    schema: kpiMutationSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  update_kpi_settings: {
    name: "update_kpi_settings",
    operationType: "UPDATE_RECORD",
    targetTable: "kpi_settings",
    schema: z.object({ kpiName: safeTextSchema() }).strict(),
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: ADMIN_ROLES
  },
  delete_kpi_record: {
    name: "delete_kpi_record",
    operationType: "DELETE_RECORD",
    targetTable: "kpis",
    schema: recordIdSchema,
    requiresConfirmation: true,
    destructive: true,
    allowedRoles: ADMIN_ROLES
  },
  manage_record: {
    name: "manage_record",
    operationType: "UPDATE_RECORD",
    schema: recordMutationSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: OPERATOR_ROLES
  },
  archive_record: {
    name: "archive_record",
    operationType: "UPDATE_RECORD",
    schema: recordMutationSchema,
    requiresConfirmation: true,
    destructive: true,
    allowedRoles: ADMIN_ROLES
  },
  delete_record: {
    name: "delete_record",
    operationType: "DELETE_RECORD",
    schema: recordMutationSchema,
    requiresConfirmation: true,
    destructive: true,
    allowedRoles: ADMIN_ROLES
  },
  bulk_manage_records: {
    name: "bulk_manage_records",
    operationType: "UPDATE_RECORD",
    schema: bulkRecordMutationSchema,
    requiresConfirmation: true,
    destructive: true,
    allowedRoles: ADMIN_ROLES
  },
  delete_generated_insights: {
    name: "delete_generated_insights",
    operationType: "DELETE_RECORD",
    targetTable: "ai_agent_runs",
    schema: deleteGeneratedInsightsSchema,
    requiresConfirmation: true,
    destructive: true,
    allowedRoles: ADMIN_ROLES
  }
} satisfies Record<string, ToolSpec>;

export type RegisteredToolName = keyof typeof TOOL_EXECUTION_REGISTRY;

function isRegisteredToolName(value: string): value is RegisteredToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_EXECUTION_REGISTRY, value);
}

function securityMetadata(value: Json | undefined): Json {
  return value && typeof value === "object" ? value : {};
}

async function logSecurityEvent(
  context: ToolExecutionContext,
  request: ToolExecutionRequest,
  spec: ToolSpec | undefined,
  allowed: boolean,
  reasonBlocked?: string
) {
  const operationType = spec?.operationType || "SYSTEM";
  const { error } = await context.supabase.from("security_audit_events").insert({
    workspace_id: context.workspaceId,
    user_id: context.userId,
    action_name: request.toolName || "unknown_tool",
    operation_type: operationType,
    target_table: spec?.targetTable || null,
    target_record_id: request.targetRecordId || null,
    initiated_by: request.initiatedBy,
    required_confirmation: Boolean(spec?.requiresConfirmation),
    confirmation_received: Boolean(request.confirmationReceived),
    allowed,
    reason_blocked: reasonBlocked || null,
    request_id: request.requestId || null,
    model: request.model || null,
    metadata_json: securityMetadata(request.metadata)
  });

  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    console.warn("Could not log security audit event", error.message);
  }
}

export async function logSecurityAuditEvent({
  supabase,
  workspaceId,
  userId = null,
  actionName,
  operationType,
  targetTable = null,
  targetRecordId = null,
  initiatedBy,
  requiredConfirmation = false,
  confirmationReceived = false,
  allowed,
  reasonBlocked = null,
  requestId = null,
  model = null,
  metadata
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string | null;
  userId?: string | null;
  actionName: string;
  operationType: ToolOperationType;
  targetTable?: string | null;
  targetRecordId?: string | null;
  initiatedBy: ToolInitiator;
  requiredConfirmation?: boolean;
  confirmationReceived?: boolean;
  allowed: boolean;
  reasonBlocked?: string | null;
  requestId?: string | null;
  model?: string | null;
  metadata?: Json;
}) {
  const { error } = await supabase.from("security_audit_events").insert({
    workspace_id: workspaceId,
    user_id: userId,
    action_name: actionName,
    operation_type: operationType,
    target_table: targetTable,
    target_record_id: targetRecordId,
    initiated_by: initiatedBy,
    required_confirmation: requiredConfirmation,
    confirmation_received: confirmationReceived,
    allowed,
    reason_blocked: reasonBlocked,
    request_id: requestId,
    model,
    metadata_json: securityMetadata(metadata)
  });

  if (error && error.code !== "42P01" && error.code !== "PGRST205" && error.code !== "23502") {
    console.warn("Could not log security audit event", error.message);
  }
}

async function recentBlockedActionCount(context: ToolExecutionContext) {
  const threshold = Number.parseInt(process.env.VAEROEX_BLOCKED_ACTION_RATE_LIMIT || "", 10) || DEFAULT_BLOCK_RATE_LIMIT;
  const since = new Date(Date.now() - BLOCK_RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();

  const { count, error } = await context.supabase
    .from("security_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", context.userId)
    .eq("allowed", false)
    .gte("created_at", since);

  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    console.warn("Could not evaluate blocked action rate limit", error.message);
  }

  return {
    count: count || 0,
    threshold
  };
}

function blocked<TArgs>(
  context: ToolExecutionContext,
  request: ToolExecutionRequest,
  spec: ToolSpec | undefined,
  requestId: string,
  reasonBlocked: string
): Promise<ToolExecutionDecision<TArgs>> {
  return logSecurityEvent(context, { ...request, requestId }, spec, false, reasonBlocked).then(() => ({
    allowed: false,
    requestId,
    tool: spec,
    reasonBlocked
  }));
}

export async function evaluateToolExecution<TArgs = unknown>(
  context: ToolExecutionContext,
  request: ToolExecutionRequest
): Promise<ToolExecutionDecision<TArgs>> {
  const requestId = request.requestId || randomUUID();
  const rateLimit = await recentBlockedActionCount(context);

  if (rateLimit.count >= rateLimit.threshold) {
    return blocked(
      context,
      request,
      undefined,
      requestId,
      `Too many blocked or suspicious actions in the last ${BLOCK_RATE_LIMIT_WINDOW_MINUTES} minutes. Try again later or contact Vaeroex support.`
    );
  }

  if (!isRegisteredToolName(request.toolName)) {
    return blocked(context, request, undefined, requestId, "Unknown tool name is not registered in the allowlist.");
  }

  const spec = TOOL_EXECUTION_REGISTRY[request.toolName];
  const parsed = spec.schema.safeParse(request.args);

  if (!parsed.success) {
    return blocked(context, request, spec, requestId, "Tool arguments failed strict schema validation.");
  }

  if (!spec.allowedRoles.includes(context.userRole)) {
    return blocked(context, request, spec, requestId, "User role is not allowed to execute this AI-mediated action.");
  }

  if (spec.requiresConfirmation && !request.confirmationReceived) {
    return blocked(context, request, spec, requestId, "Explicit user confirmation is required before this action can execute.");
  }

  if (spec.destructive && request.initiatedBy !== "user") {
    return blocked(context, request, spec, requestId, "Destructive actions cannot be initiated autonomously by Vaeroex.");
  }

  if (["BILLING", "ADMIN", "SYSTEM"].includes(spec.operationType) && request.initiatedBy !== "user") {
    return blocked(context, request, spec, requestId, "Privileged actions cannot be initiated by model output.");
  }

  await logSecurityEvent(context, { ...request, requestId }, spec, true);

  return {
    allowed: true,
    requestId,
    tool: spec,
    args: parsed.data as TArgs
  };
}

export async function requireToolExecution<TArgs = unknown>(
  context: ToolExecutionContext,
  request: ToolExecutionRequest
): Promise<TArgs> {
  const decision = await evaluateToolExecution<TArgs>(context, request);

  if (!decision.allowed) {
    throw new Error(securityResponseMessage());
  }

  return decision.args as TArgs;
}
