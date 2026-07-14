import { renderSourcesPage } from "@/app/app/sources/page";

type SourceDetailPageProps = {
  params: Promise<{ fileId: string }>;
  searchParams?: Promise<{
    error?: string;
    message?: string;
    section?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function SourceDetailPage({ params, searchParams }: SourceDetailPageProps) {
  const [{ fileId }, query] = await Promise.all([params, searchParams]);

  return renderSourcesPage(
    {
      ...(query || {}),
      file: fileId
    },
    { sourceDetail: true }
  );
}
