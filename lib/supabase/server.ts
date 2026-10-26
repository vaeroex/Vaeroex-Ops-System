import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";
import type { SharedCitationReadTrace } from "@/lib/supabase/citation-read-trace";

export async function createSupabaseServerClient(citationTrace?: SharedCitationReadTrace) {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  const cookieStore = await cookies();

  const client = createServerClient<Database>(config.url, config.anonKey, {
    ...(citationTrace ? { global: { fetch: citationTrace.wrapFetch(fetch.bind(globalThis), new URL(config.url).origin) } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Workspace GET/HEAD middleware persists refreshes before rendering.
          // Server Actions and Route Handlers have a writable cookie store.
        }
      }
    }
  });
  if (citationTrace) client.auth.getSession = citationTrace.wrapSession(client.auth.getSession.bind(client.auth));
  return client;
}
