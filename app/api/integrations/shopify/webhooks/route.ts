import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ShopSchema,
  verifyWebhook,
} from "@/lib/integrations/shopify/contracts";
import { lifecycle, readBody } from "@/lib/integrations/shopify/server";
export async function POST(request: Request) {
  try {
    const secret = z
      .string()
      .min(16)
      .max(512)
      .parse(process.env.SHOPIFY_CLIENT_SECRET);
    const body = await readBody(request, 1_000_000);
    if (
      !verifyWebhook(body, request.headers.get("x-shopify-hmac-sha256"), secret)
    )
      return new NextResponse(null, { status: 401 });
    const topic = z
      .enum([
        "app/uninstalled",
        "customers/data_request",
        "customers/redact",
        "shop/redact",
      ])
      .parse(request.headers.get("x-shopify-topic"));
    const raw = JSON.parse(body.toString("utf8"));
    // Topic headers are not part of the HMAC. Validate the corresponding signed
    // payload shape so a customer request cannot be relabelled as shop erasure.
    if (topic === "shop/redact") {
      z.object({
        shop_id: z.number().int().positive(),
        shop_domain: ShopSchema,
      })
        .strict()
        .parse(raw);
    } else if (topic === "customers/redact") {
      z.object({
        shop_id: z.number().int().positive(),
        shop_domain: ShopSchema,
        customer: z.object({ id: z.number().int().positive() }),
        orders_to_redact: z.array(z.number().int().positive()),
        data_request: z.never().optional(),
        orders_requested: z.never().optional(),
      }).parse(raw);
    } else if (topic === "customers/data_request") {
      z.object({
        shop_id: z.number().int().positive(),
        shop_domain: ShopSchema,
        customer: z.object({ id: z.number().int().positive() }),
        data_request: z.object({ id: z.number().int().positive() }),
        orders_requested: z.array(z.number().int().positive()),
        orders_to_redact: z.never().optional(),
      }).parse(raw);
    }
    const payload = z
      .object({
        shop_domain: ShopSchema.optional(),
        myshopify_domain: ShopSchema.optional(),
      })
      .parse(raw);
    // Derive the shop from the signed payload. Never trust an unsigned shop header alone.
    const shop = ShopSchema.parse(
      topic === "app/uninstalled"
        ? payload.myshopify_domain
        : payload.shop_domain,
    );
    if (request.headers.get("x-shopify-shop-domain") !== shop)
      return new NextResponse(null, { status: 400 });
    await lifecycle("webhook", null, { topic, shop });
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return new NextResponse(null, { status: 400 });
    return new NextResponse(null, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
