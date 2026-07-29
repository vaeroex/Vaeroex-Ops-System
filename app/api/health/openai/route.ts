import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { getVaeroexAIRuntimeStatus } from "@/lib/ai/vaeroex-client";
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
