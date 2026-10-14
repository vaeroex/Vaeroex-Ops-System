import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ConnectionSchema,
  TokenSchema,
} from "@/lib/integrations/shopify/contracts";
import { readReport, requestToken } from "@/lib/integrations/shopify/provider";
import {
  assertOrigin,
  configuration,
  failure,
  form,
  lifecycle,
  manager,
  redirectResult,
  shopifyEnabled,
  tokenCipher,
} from "@/lib/integrations/shopify/server";
export const maxDuration = 300;
export async function POST(request: Request) {
  let claimed:
    | {
        access: Awaited<ReturnType<typeof manager>>;
        generation: number;
        leaseId: string;
      }
    | undefined;
  let refreshing = false;
  try {
    if (!shopifyEnabled()) throw new Error("shopify_disabled");
    assertOrigin(request);
    z.object({ confirm: z.literal("yes") })
      .strict()
      .parse(await form(request));
    const access = await manager(),
      leaseId = randomUUID();
    const c = ConnectionSchema.extend({
      privacy_cutoff: z.string().nullable(),
    }).parse(await lifecycle("claim_sync", access, { leaseId }));
    claimed = { access, generation: c.generation, leaseId };
    let tokens = TokenSchema.parse(
      tokenCipher(
        access.workspaceId,
        c.shop,
        c.generation,
        c.credential_version,
        c.ciphertext,
        true,
      ),
    );
    if (Date.parse(tokens.expiresAt) < Date.now() + 240000) {
      refreshing = true;
      if (Date.parse(tokens.refreshExpiresAt) < Date.now() + 60000)
        throw new Error("shopify_reauthorize");
      const config = configuration();
      tokens = await requestToken(
        c.shop,
        config.clientId,
        config.clientSecret,
        { refresh_token: tokens.refreshToken },
      );
      const version = c.credential_version + 1,
        ciphertext = tokenCipher(
          access.workspaceId,
          c.shop,
          c.generation,
          version,
          tokens,
        );
      await lifecycle("refresh", access, {
        leaseId,
        generation: c.generation,
        credentialVersion: version,
        ciphertext,
      });
      refreshing = false;
    }
    const report = await readReport(
      c.shop,
      tokens.accessToken,
      new Date(),
      c.privacy_cutoff,
    );
    await lifecycle("report", access, {
      leaseId,
      generation: c.generation,
      report,
    });
    return redirectResult("synced");
  } catch (error) {
    if (claimed)
      await lifecycle("fail", claimed.access, {
        leaseId: claimed.leaseId,
        generation: claimed.generation,
        reauthorize:
          refreshing ||
          (error instanceof Error && error.message === "shopify_reauthorize"),
      }).catch(() => undefined);
    return failure(error);
  }
}
