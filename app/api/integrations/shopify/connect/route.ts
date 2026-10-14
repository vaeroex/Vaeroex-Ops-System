import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { normalizeShop } from "@/lib/integrations/shopify/contracts";
import {
  assertOrigin,
  authorizationUrl,
  failure,
  form,
  lifecycle,
  manager,
  shopifyEnabled,
  stateHash,
} from "@/lib/integrations/shopify/server";
export async function POST(request: Request) {
  try {
    if (!shopifyEnabled()) throw new Error("shopify_disabled");
    assertOrigin(request);
    const input = z
      .object({ shop: z.string(), confirm: z.literal("yes") })
      .strict()
      .parse(await form(request));
    const access = await manager(),
      shop = normalizeShop(input.shop),
      state = randomBytes(32).toString("base64url");
    await lifecycle("begin", access, { shop, stateHash: stateHash(state) });
    const response = NextResponse.redirect(authorizationUrl(shop, state), {
      status: 303,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
    response.cookies.set("__Host-vaeroex-shopify-state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
