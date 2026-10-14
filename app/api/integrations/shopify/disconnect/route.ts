import { z } from "zod";
import {
  assertOrigin,
  failure,
  form,
  lifecycle,
  manager,
  redirectResult,
} from "@/lib/integrations/shopify/server";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    z.object({ confirm: z.literal("yes") })
      .strict()
      .parse(await form(request));
    await lifecycle("disconnect", await manager(false));
    return redirectResult("disconnected");
  } catch (error) {
    return failure(error);
  }
}
