import { utilityRobots } from "@/lib/seo/public-seo";
export const metadata = { robots: utilityRobots };
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/security/require-auth";
export const dynamic = "force-dynamic";
export default async function AccessPage() {
  await requireAuth();
  // Compatibility entry point: choosing a system always requires an explicit action.
  redirect("/systems" as Route);
}
