import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export default async function AskVaeroexPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspacePage();
  const params = (await searchParams) || {};
  // Legacy saved analyses still belong to Intelligence; freeform questions use VSI.
  if (params.run || params.error || params.saved || params.debug) redirect("/app/intelligence");
  const prompt = typeof params.prompt === "string" ? params.prompt.slice(0, 8000) : "";
  redirect((prompt ? `/app/si?prompt=${encodeURIComponent(prompt)}` : "/app/si") as Route);
}
