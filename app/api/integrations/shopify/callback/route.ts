import { randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  ConnectionSchema,
  verifyCallback,
} from "@/lib/integrations/shopify/contracts";
import { requestToken } from "@/lib/integrations/shopify/provider";
import {
  assertOrigin,
  configuration,
  failure,
  lifecycle,
  manager,
  redirectResult,
  shopifyEnabled,
  stateHash,
  tokenCipher,
} from "@/lib/integrations/shopify/server";
export async function GET(request: Request) {
  let claimed:
    | {
        access: Awaited<ReturnType<typeof manager>>;
        generation: number;
        leaseId: string;
      }
    | undefined;
  try {
    if (!shopifyEnabled()) throw new Error("shopify_disabled");
    assertOrigin(request, true);
    const config = configuration(),
      input = verifyCallback(
        new URL(request.url).searchParams,
        config.clientSecret,
      );
    const cookie = (await cookies()).get("__Host-vaeroex-shopify-state")?.value;
    if (
      !cookie ||
      cookie.length !== input.state.length ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(input.state))
    )
      throw new Error("shopify_state_invalid");
    const access = await manager(),
      leaseId = randomUUID();
    const c = ConnectionSchema.parse(
      await lifecycle("consume", access, {
        shop: input.shop,
        stateHash: stateHash(input.state),
        leaseId,
      }),
    );
    claimed = { access, generation: c.generation, leaseId };
    const token = await requestToken(
      c.shop,
      config.clientId,
      config.clientSecret,
      { code: input.code },
    );
    const ciphertext = tokenCipher(
      access.workspaceId,
      c.shop,
      c.generation,
      1,
      token,
    );
    await lifecycle("complete", access, {
      leaseId,
      generation: c.generation,
      credentialVersion: 1,
      ciphertext,
    });
    const response = redirectResult("connected");
    response.cookies.set("__Host-vaeroex-shopify-state", "", {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (claimed)
      await lifecycle("fail", claimed.access, {
        generation: claimed.generation,
        leaseId: claimed.leaseId,
        reauthorize: true,
      }).catch(() => undefined);
    return failure(error);
  }
}
