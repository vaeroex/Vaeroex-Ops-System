import type { PlanSlug } from "@/lib/billing/types";

const fallbackProductMap: Record<string, PlanSlug> = {
  "vaeroex ops system - starter": "starter",
  "vaeroex ops system starter": "starter",
  "starter operations system": "starter",
  "starter": "starter",
  "vaeroex ops system - growth": "growth",
  "vaeroex ops system growth": "growth",
  "growth operations system": "growth",
  "growth": "growth",
  "vaeroex ops system - pro": "pro",
  "vaeroex ops system pro": "pro",
  "pro operations system": "pro",
  "pro": "pro"
};

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function envProductMap(): Record<string, PlanSlug> {
  return {
    [normalize(process.env.SQUARESPACE_STARTER_PRODUCT_ID)]: "starter",
    [normalize(process.env.SQUARESPACE_STARTER_SKU)]: "starter",
    [normalize(process.env.SQUARESPACE_GROWTH_PRODUCT_ID)]: "growth",
    [normalize(process.env.SQUARESPACE_GROWTH_SKU)]: "growth",
    [normalize(process.env.SQUARESPACE_PRO_PRODUCT_ID)]: "pro",
    [normalize(process.env.SQUARESPACE_PRO_SKU)]: "pro"
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

export const squarespaceCheckoutUrls = {
  starter: process.env.NEXT_PUBLIC_SQUARESPACE_STARTER_CHECKOUT_URL || "https://www.vaeroex.com/pricing",
  growth: process.env.NEXT_PUBLIC_SQUARESPACE_GROWTH_CHECKOUT_URL || "https://www.vaeroex.com/pricing",
  pro: process.env.NEXT_PUBLIC_SQUARESPACE_PRO_CHECKOUT_URL || "https://www.vaeroex.com/pricing"
} satisfies Record<PlanSlug, string>;
