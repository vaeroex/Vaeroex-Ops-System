import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { runAIProviderSmokeTest } from "@/lib/ai/provider-smoke-test";
import { getVaeroexAIRuntimeStatus } from "@/lib/ai/vaeroex-client";
import { isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { response: NextResponse.json(
      {
        ok: false,
        error: "Supabase is not configured."
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    ) };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: NextResponse.json(
      {
        ok: false,
        error: "Sign in before checking AI provider configuration."
      },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" }
      }
    ) };
  }

  if (!isVaeroexAdminUser(user)) {
    return { response: NextResponse.json(
      {
        ok: false,
        error: "Vaeroex admin access is required."
      },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" }
      }
    ) };
  }

  return { user, supabase };
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const authorization = await requireAdmin();
  if (authorization.response) return authorization.response;

  const openai = getVaeroexAIRuntimeStatus();
  console.log(
    JSON.stringify({
      level: "info",
      component: "vaeroex-ai-provider",
      event: "health_check",
      activeProvider: openai.activeProvider,
      openaiApiKeyConfigured: openai.openaiApiKeyConfigured,
      nvidiaConfigured: openai.nvidiaConfigured,
      keySource: openai.keySource,
      keyFingerprint: openai.keyFingerprint,
      legacyEnvPresence: openai.legacyEnvPresence,
      openaiModel: openai.openaiModel,
      openaiEmbeddingModel: openai.openaiEmbeddingModel,
      maxEvidenceChunks: openai.maxEvidenceChunks,
      openaiApiMode: openai.openaiApiMode,
      openaiEndpoint: openai.openaiEndpoint,
      responseFormat: openai.responseFormat,
      checkedAt
    })
  );

  const configuredProviderReady = openai.activeProvider === "nvidia" ? openai.nvidiaConfigured : openai.openaiConfigured;
  const fallbackReady = openai.openaiConfigured;

  return NextResponse.json(
    {
      ok: configuredProviderReady && fallbackReady,
      checks: {
        activeProvider: openai.activeProvider,
        configurationValid: openai.configurationValid,
        openaiApiKeyConfigured: openai.openaiApiKeyConfigured,
        nvidiaConfigured: openai.nvidiaConfigured,
        nvidiaModel: openai.nvidiaModel,
        embeddingProvider: openai.embeddingProvider,
        keySource: openai.keySource,
        keyFingerprint: openai.keyFingerprint,
        legacyEnvPresence: openai.legacyEnvPresence,
        openaiModel: openai.openaiModel,
        openaiEmbeddingModel: openai.openaiEmbeddingModel,
        maxEvidenceChunks: openai.maxEvidenceChunks,
        openaiApiMode: openai.openaiApiMode,
        openaiEndpoint: openai.openaiEndpoint,
        responseFormat: openai.responseFormat,
        serverOnly: openai.serverOnly
      },
      checkedAt
    },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}

export async function POST(request: Request) {
  const checkedAt = new Date().toISOString();
  const authorization = await requireAdmin();
  if (authorization.response) return authorization.response;

  try {
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: unknown };
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
      return NextResponse.json({ ok: false, error: "A valid demo workspace ID is required.", checkedAt }, { status: 400 });
    }
    const { data: workspace, error } = await authorization.supabase
      .from("workspaces")
      .select("id,name,subscription_status")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error || !workspace || !isDemoWorkspaceRecord(workspace)) {
      return NextResponse.json({ ok: false, error: "The smoke test is limited to an authorized demo workspace.", checkedAt }, { status: 403 });
    }
    const result = await runAIProviderSmokeTest({
      supabase: authorization.supabase,
      workspaceId,
      userId: authorization.user.id
    });
    return NextResponse.json({ ...result, checkedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI provider smoke test failed.", checkedAt },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
