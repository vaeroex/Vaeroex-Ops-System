import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function OverviewRedirect({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  redirect(`/app/intelligence${query.size ? `?${query}` : ""}` as Route);
}
