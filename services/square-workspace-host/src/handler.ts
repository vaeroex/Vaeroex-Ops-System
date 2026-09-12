import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/supabase/types";
import { squareWorkspaceEvidenceCandidate, readSquareWorkspaceCard } from "@/lib/integrations/control-plane/square-workspace-evidence";
import { publicKey } from "./config";

const origin = "https://square-sandbox.vaeroex.com";
// Qualification labels only, not discovered memberships or authority grants.
const workspaceLabels = ["Vaeroex Square Sandbox", "Vaeroex Square Evidence Denial Test"] as const;
const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const document = (body: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Vaeroex Square Sandbox evidence</title><style>body{font:16px system-ui;max-width:800px;margin:3rem auto;padding:1rem}label,input,button,select{display:block;margin:.7rem 0}table{border-collapse:collapse}td,th{padding:.5rem;text-align:left;border:1px solid #bbb}</style><body><h1>Vaeroex Square Sandbox</h1><p>Read-only evidence qualification. Production and QBO are not connected here.</p>${body}</body></html>`;

export async function handle(req: NextRequest) {
  // Redundant gate: the raw HTTP/TLS guard executes before Next normalization.
  if (!squareWorkspaceEvidenceCandidate(req.headers) || process.env.VAEROEX_ADMIN_EMAILS || !publicKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) return new NextResponse("Unavailable", {status:404});
  const path = req.nextUrl.pathname;
  if (!((req.method === "GET" && ["/signin", "/evidence"].includes(path)) || (req.method === "POST" && ["/session", "/signout", "/workspace"].includes(path)))) return new NextResponse("Unavailable", {status:404});
  if (req.method === "POST" && (req.headers.get("origin") !== origin || req.headers.get("content-type") !== "application/x-www-form-urlencoded")) return new NextResponse("Unavailable", {status:404});
  const response = new NextResponse(null);
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(10000)]);
  const finish = (body: string, status = 200) => {
    const result = new NextResponse(document(body), {status, headers:{"content-type":"text/html; charset=utf-8", "cache-control":"no-store"}});
    response.cookies.getAll().forEach(cookie => result.cookies.set(cookie));
    return result;
  };
  const redirect = (location: string) => { const result = finish("",303); result.headers.set("location",location); return result; };
  try {
    if (path === "/signin") return finish('<h2>Private portal sign-in</h2><form method="post" action="/session"><label>Email<input name="email" type="email" maxlength="254" autocomplete="username" required></label><label>Password<input name="password" type="password" maxlength="1024" autocomplete="current-password" required></label><button>Sign in</button></form>');
    const client = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { fetch: (input, init) => { signal.throwIfAborted(); return fetch(input, {...init, cache:"no-store", signal:AbortSignal.any([signal, AbortSignal.timeout(8000)])}); } },
      cookies: { getAll: () => req.cookies.getAll(), setAll: entries => entries.forEach(({name,value,options}) => response.cookies.set(name,value,{...options,secure:true,httpOnly:true,sameSite:"strict",path:"/"})) },
    });
    if (path === "/session") {
      const text = await req.text();
      if (Buffer.byteLength(text) > 4096) return finish("Unavailable",400);
      const form = new URLSearchParams(text);
      if ([...form.keys()].sort().join(",") !== "email,password") return finish("Unavailable",400);
      const email = form.get("email") || "", password = form.get("password") || "";
      if (email.length > 254 || !email || !password || password.length > 1024) return finish("Sign-in unsuccessful",400);
      const {error} = await client.auth.signInWithPassword({email,password});
      return error ? finish('Sign-in unsuccessful. <a href="/signin">Try again</a>',401) : redirect("/evidence");
    }
    signal.throwIfAborted();
    if (path === "/signout") {
      try { await client.auth.signOut({scope:"local"}); } finally {
        // Local session removal does not depend on an acknowledgement from Auth.
        req.cookies.getAll().filter(c => c.name.startsWith('sb-')).forEach(c => response.cookies.set(c.name,"",{secure:true,httpOnly:true,sameSite:"strict",path:"/",maxAge:0}));
      }
      return redirect("/signin");
    }
    const {data:{user},error} = await client.auth.getUser();
    if (error || !user || user.is_anonymous) return redirect("/signin");
    signal.throwIfAborted();
    if (path === "/workspace") {
      const text = await req.text();
      const form = new URLSearchParams(text);
      if (Buffer.byteLength(text)>4096 || [...form.keys()].join(',') !== 'workspace' || !workspaceLabels.some(name=>name===form.get('workspace'))) return finish("Unavailable",403);
      response.cookies.set('square-evidence-workspace',form.get('workspace')!,{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:3600});
      return redirect('/evidence');
    }
    let body = '<form method="post" action="/signout"><button>Sign out</button></form>';
    body += '<form method="post" action="/workspace"><label>Workspace<select name="workspace">'+workspaceLabels.map(name=>`<option>${escape(name)}</option>`).join('')+'</select></label><button>View workspace</button></form>';
    const selected = req.cookies.get('square-evidence-workspace')?.value;
    const workspace = selected ? workspaceLabels.find(name=>name===selected) : workspaceLabels[0];
    if (workspace) {
      body += `<section><h2>${escape(workspace)}</h2>`;
      signal.throwIfAborted();
      // Membership, subscription and complete evidence authority are one RPC.
      const evidence = await readSquareWorkspaceCard(client,workspace,req.headers);
      if (!evidence) return finish(body+'<p>No Square evidence available.</p></section>');
      body += '<h3>Square Sandbox evidence</h3><p>Verified, non-economic provider observations · Read-only</p><ul>';
      for (const [kind,label] of Object.entries({payment:"Payment",refund:"Refund",order:"Orders",catalog:"Catalog variations",inventory:"Inventory observations"})) body += `<li>${label}: ${evidence.counts[kind as keyof typeof evidence.counts]}</li>`;
      body += `</ul><p>Interpretation checkpoint ${evidence.checkpointRevision} · ${escape(evidence.interpretedAt)}</p><p>Last verified observation: ${escape(evidence.lastObservedAt)}. Current sync health: unknown.</p><p>${evidence.relationships.unresolvedLocation} unresolved location relationships; ${evidence.relationships.conflict} reference conflict. Historical completeness: unknown.</p><p>Catalog is seller-scoped with location applicability. Payments, Refunds, Orders and Inventory remain distinct observations.</p><p>No revenue, profit, netting, inventory valuation, stock calculation, or complete-history claim. Economic contributions remain blocked.</p><p>Immutable source provenance · ${escape(evidence.policy)}</p><table><tr><th>Resource</th><th>Version</th><th>Observed</th></tr>`;
      for (const item of evidence.provenance) body += `<tr><td>${escape(item.kind)}</td><td>${item.sourceVersion}</td><td>${escape(item.observedAt)}</td></tr>`;
      body += '</table></section>';
    }
    return finish(body);
  } catch { return finish("Evidence unavailable",503); }
}
