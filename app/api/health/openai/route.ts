import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { getVaeroexOpenAIRuntimeStatus } from "@/lib/ai/vaeroex-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase is not configured.",
        checkedAt
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: "Sign in before checking OpenAI runtime configuration.",
        checkedAt
      },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  if (!isVaeroexAdminUser(user)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Vaeroex admin access is required.",
        checkedAt
      },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  const openai = getVaeroexOpenAIRuntimeStatus();
  console.log(
    JSON.stringify({
      level: "info",
      component: "vaeroex-openai",
      event: "health_check",
      openaiApiKeyConfigured: openai.openaiApiKeyConfigured,
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

  return NextResponse.json(
    {
      ok: openai.openaiApiKeyConfigured,
      checks: {
        openaiApiKeyConfigured: openai.openaiApiKeyConfigured,
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
