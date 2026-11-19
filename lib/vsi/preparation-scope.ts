import "server-only";
import { z } from "zod";
import { qualificationHash, VsiQualificationError } from "./qualification";
const scopeSchema = z.object({ actorUserId: z.string().uuid(), workspaceId: z.string().uuid(),
  questionHash: z.string().regex(/^[a-f0-9]{64}$/), startsAt: z.string().datetime(), expiresAt: z.string().datetime() }).strict();
/** Preview-only, read-only campaign capability. It cannot authorize generation. */
export function assertVsiPreparationScope(input: { actorUserId: string; workspaceId: string; question: string }) {
  try {
    const raw = process.env.VAEROEX_VSI_PREPARATION;
    if (process.env.VERCEL_ENV !== "preview" || !raw || raw.length > 1000) throw new Error();
    const scope = scopeSchema.parse(JSON.parse(raw)), now = Date.now();
    const start = Date.parse(scope.startsAt), end = Date.parse(scope.expiresAt);
    if (end <= start || end - start > 7_200_000 || now < start || now >= end
      || scope.actorUserId !== input.actorUserId || scope.workspaceId !== input.workspaceId
      || scope.questionHash !== qualificationHash(input.question)) throw new Error();
    return scope;
  } catch { throw new VsiQualificationError("scope"); }
}
