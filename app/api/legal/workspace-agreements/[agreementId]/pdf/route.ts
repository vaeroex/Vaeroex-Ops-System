import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function safeFilename(organization: string) {
  const base = organization.trim().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "workspace";
  return `${base}-vaeroex-workspace-agreement.pdf`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agreementId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { agreementId } = await params;
  const { data: agreement, error } = await supabase
    .from("workspace_agreements")
    .select("id,organization_name,storage_bucket,storage_path,pdf_sha256")
    .eq("id", agreementId)
    .maybeSingle();
  if (error || !agreement) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const download = await supabase.storage.from(agreement.storage_bucket).download(agreement.storage_path);
  if (download.error || !download.data) return NextResponse.json({ error: "Agreement PDF is unavailable." }, { status: 503 });

  const bytes = Buffer.from(await download.data.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== agreement.pdf_sha256) {
    return NextResponse.json({ error: "Agreement integrity verification failed." }, { status: 503 });
  }

  const disposition = new URL(request.url).searchParams.get("disposition") === "attachment" ? "attachment" : "inline";
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${safeFilename(agreement.organization_name)}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
