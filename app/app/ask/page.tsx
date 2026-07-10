import { redirect } from "next/navigation";
import AgentsPage from "../agents/page";

type LegacyAskPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyAskPage({ searchParams }: LegacyAskPageProps) {
  const params = (await searchParams) || {};

  if (params.run || params.error || params.saved || params.debug) {
    return <AgentsPage searchParams={Promise.resolve(params)} />;
  }

  redirect("/app?search=1");
}
