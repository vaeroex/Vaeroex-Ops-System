import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

type OutputsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function paramsFromSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      if (value[0]) params.set(key, value[0]);
    } else if (value) {
      params.set(key, value);
    }
  }

  return params;
}

export default async function NewGeneratedOutputPage({ searchParams }: OutputsPageProps) {
  const params = paramsFromSearchParams((await searchParams) || {});
  permanentRedirect(`/app/reports/new${params.size ? `?${params.toString()}` : ""}`);
}
