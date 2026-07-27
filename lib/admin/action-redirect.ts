import "server-only";
import type { Route } from "next";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const COMPANY_DETAIL_PATTERN = new RegExp(
  `^/app/admin/customers/${UUID_PATTERN}(?:\\?tab=(?:overview|workspace|subscription|agreement))?$`,
  "i"
);

const allowedIndexPaths = new Set([
  "/app/admin/workspaces",
  "/app/admin/subscriptions"
]);

export function getAdminActionReturnPath(formData: FormData, fallback: Route): Route {
  const requested = String(formData.get("return_to") || "").trim();

  if (COMPANY_DETAIL_PATTERN.test(requested) || allowedIndexPaths.has(requested)) {
    return requested as Route;
  }

  return fallback;
}

export function withAdminActionNotice(path: string, key: "message" | "error", message: string) {
  const url = new URL(path, "https://vaeroex.local");
  url.searchParams.set(key, message);
  return `${url.pathname}?${url.searchParams.toString()}` as Route;
}
