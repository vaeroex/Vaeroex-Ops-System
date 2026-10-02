import { z } from "zod";

export const erasureArtifactSchema = z.object({
  table: z.string().min(1).max(127).regex(/^[a-z_][a-z0-9_.]*$/),
  id: z.string().uuid()
}).strict();

export const erasureScopeSchema = z.object({
  requestId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  connectionId: z.string().uuid(),
  state: z.enum(["prepared", "approved", "completed", "withdrawn"]),
  scopeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  counts: z.record(z.number().int().nonnegative().safe()),
  artifacts: z.array(erasureArtifactSchema.extend({ action: z.enum(["delete", "keep_unrelated"]) }))
}).strict().refine((scope) => new Set(scope.artifacts.map(({ table, id }) => `${table}:${id}`)).size === scope.artifacts.length);

export type ErasureScope = z.infer<typeof erasureScopeSchema>;

// Local RPC contract while the database types are maintained separately.
export type ErasureRpcClient = {
  rpc(name: "read_google_sheets_erasure_request_v1", args: { p_request_id: string }): PromiseLike<{ data: unknown; error: unknown }>;
  rpc(name: "confirm_google_sheets_erasure_request_v1", args: {
    p_request_id: string;
    p_scope_hash: string;
    p_delete_artifacts: Array<{ table: string; id: string }>;
  }): PromiseLike<{ data: unknown; error: unknown }>;
};
