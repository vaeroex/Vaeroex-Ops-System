import "server-only";

import { randomUUID } from "crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
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

type ToolExecutionContext = {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userId: string;
  userRole: WorkspaceRole;
};

type ToolExecutionRequest = {
  toolName: string;
  args: unknown;
  initiatedBy: ToolInitiator;
  confirmationReceived?: boolean;
  targetRecordId?: string | null;
  requestId?: string;
  model?: string | null;
  metadata?: Json;
};

type ToolExecutionDecision<TArgs = unknown> = {
  allowed: boolean;
  requestId: string;
  tool?: ToolSpec;
  args?: TArgs;
  reasonBlocked?: string;
};

const uuidSchema = z.string().uuid();
const safeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !/(;\s*(drop|delete|truncate|alter|update|insert)\b|--|\/\*|\bexecute\s+sql\b)/i.test(value), {
    message: "Unsafe instruction-like content is not allowed in tool arguments."
  });
const saveTargetSchema = z.object({ runId: uuidSchema }).strict();
const generatedBriefingSchema = z
  .object({
    title: safeTextSchema,
    outputType: safeTextSchema,
    bodyMarkdown: z.string().trim().min(1).max(60_000),
    sourceData: z.unknown().optional()
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

export const TOOL_EXECUTION_REGISTRY = {
  save_vaeroex_output_tasks: {
    name: "save_vaeroex_output_tasks",
    operationType: "CREATE_RECORD",
    targetTable: "tasks",
    schema: saveTargetSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: ["owner", "admin"] as WorkspaceRole[]
  },
  save_vaeroex_output_form: {
    name: "save_vaeroex_output_form",
    operationType: "CREATE_RECORD",
    targetTable: "forms",
    schema: saveTargetSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: ["owner", "admin"] as WorkspaceRole[]
  },
  save_vaeroex_output_checklist: {
    name: "save_vaeroex_output_checklist",
    operationType: "CREATE_RECORD",
    targetTable: "checklists",
    schema: saveTargetSchema,
    requiresConfirmation: true,
    destructive: false,
    allowedRoles: ["owner", "admin"] as WorkspaceRole[]
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
  delete_generated_insights: {
    name: "delete_generated_insights",
    operationType: "DELETE_RECORD",
    targetTable: "ai_agent_runs",
    schema: deleteGeneratedInsightsSchema,
    requiresConfirmation: true,
    destructive: true,
    allowedRoles: ["owner", "admin"] as WorkspaceRole[]
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
    throw new Error(decision.reasonBlocked || "Tool execution was blocked by Vaeroex security policy.");
  }

  return decision.args as TArgs;
}
