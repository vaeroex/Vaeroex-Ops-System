import type { PlanSlug } from "@/lib/billing/types";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";

const fallbackProductMap: Record<string, PlanSlug> = {
  "vaeroex": VAEROEX_PLAN_SLUG,
  "vaeroex ops system": VAEROEX_PLAN_SLUG,
  "vaeroex operations system": VAEROEX_PLAN_SLUG,
  "vaeroex ops system - starter": VAEROEX_PLAN_SLUG,
  "vaeroex ops system starter": VAEROEX_PLAN_SLUG,
  "starter operations system": VAEROEX_PLAN_SLUG,
  "starter": VAEROEX_PLAN_SLUG,
  "vaeroex ops system - growth": VAEROEX_PLAN_SLUG,
  "vaeroex ops system growth": VAEROEX_PLAN_SLUG,
  "growth operations system": VAEROEX_PLAN_SLUG,
  "growth": VAEROEX_PLAN_SLUG,
  "vaeroex ops system - pro": VAEROEX_PLAN_SLUG,
  "vaeroex ops system pro": VAEROEX_PLAN_SLUG,
  "pro operations system": VAEROEX_PLAN_SLUG,
  "pro": VAEROEX_PLAN_SLUG
};

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function envProductMap(): Record<string, PlanSlug> {
  return {
    [normalize(process.env.SQUARESPACE_VAEROEX_PRODUCT_ID)]: VAEROEX_PLAN_SLUG,
    [normalize(process.env.SQUARESPACE_VAEROEX_SKU)]: VAEROEX_PLAN_SLUG,
    [normalize(process.env.SQUARESPACE_STARTER_PRODUCT_ID)]: VAEROEX_PLAN_SLUG,
    [normalize(process.env.SQUARESPACE_STARTER_SKU)]: VAEROEX_PLAN_SLUG,
    [normalize(process.env.SQUARESPACE_GROWTH_PRODUCT_ID)]: VAEROEX_PLAN_SLUG,
    [normalize(process.env.SQUARESPACE_GROWTH_SKU)]: VAEROEX_PLAN_SLUG,
    [normalize(process.env.SQUARESPACE_PRO_PRODUCT_ID)]: VAEROEX_PLAN_SLUG,
    [normalize(process.env.SQUARESPACE_PRO_SKU)]: VAEROEX_PLAN_SLUG
  };
}

export function mapSquarespaceProductToPlan(...values: Array<string | null | undefined>): PlanSlug | null {
  const map = {
    ...fallbackProductMap,
    ...envProductMap()
  };

  for (const value of values) {
    const key = normalize(value);

    if (key && map[key]) {
      return map[key];
    }
  }

  return null;
}

export const squarespaceCheckoutUrl =
  process.env.NEXT_PUBLIC_SQUARESPACE_VAEROEX_CHECKOUT_URL ||
  process.env.NEXT_PUBLIC_SQUARESPACE_CHECKOUT_URL ||
  process.env.NEXT_PUBLIC_SQUARESPACE_PRO_CHECKOUT_URL ||
  process.env.NEXT_PUBLIC_SQUARESPACE_GROWTH_CHECKOUT_URL ||
  process.env.NEXT_PUBLIC_SQUARESPACE_STARTER_CHECKOUT_URL ||
  "https://vaeroex.com/pricing";

export const squarespaceCheckoutUrls = {
  [VAEROEX_PLAN_SLUG]: squarespaceCheckoutUrl
} satisfies Record<PlanSlug, string>;
