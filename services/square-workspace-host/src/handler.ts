import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/supabase/types";
import { squareWorkspaceEvidenceCandidate, readSquareWorkspaceCard, readSquareWorkspaceOperational } from "@/lib/integrations/control-plane/square-workspace-evidence";
import { publicKey } from "./config";
import { card, controls, document, escape, operational } from "./presentation";

const origin = "https://square-sandbox.vaeroex.com";
// Qualification labels only, not discovered memberships or authority grants.
const workspaceLabels = ["Vaeroex Square Sandbox", "Vaeroex Square Evidence Denial Test"] as const;

export async function handle(req: NextRequest) {
  // Redundant gate: the raw HTTP/TLS guard executes before Next normalization.
  if (!squareWorkspaceEvidenceCandidate(req.headers) || process.env.VAEROEX_ADMIN_EMAILS || !publicKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) return new NextResponse("Unavailable", {status:404});
  const path = req.nextUrl.pathname;
  if (!((req.method === "GET" && ["/signin", "/evidence", "/activity"].includes(path)) || (req.method === "POST" && ["/session", "/signout", "/workspace", "/activity-filter"].includes(path)))) return new NextResponse("Unavailable", {status:404});
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
    if (path === "/signin") return finish('<section class="panel signin"><span class="eyebrow">Isolated account only</span><h2>Private portal sign-in</h2><p class="muted">Use your existing Vaeroex Sandbox account. No Square consent or database password is needed.</p><form method="post" action="/session"><label>Email<input name="email" type="email" maxlength="254" autocomplete="username" required></label><label>Password<input name="password" type="password" maxlength="1024" autocomplete="current-password" required></label><button class="primary">Sign in</button></form></section>');
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
    if(path==="/activity-filter"){
      const text=await req.text(),form=new URLSearchParams(text);
      const keys=[...form.keys()].sort().join(','),kind=form.get('kind')||'',status=form.get('status')||'',location=form.get('location')||'',from=form.get('from')||'',to=form.get('to')||'',sort=form.get('sort')||'',page=Number(form.get('page')||'1');
      if(Buffer.byteLength(text)>4096||keys!=="from,kind,location,page,sort,status,to"||!['','payment','refund','order','catalog','inventory'].includes(kind)||
        !['','mapped_location','seller_scoped','explicitly_unresolved'].includes(location)||!['newest','oldest'].includes(sort)||
        !/^[A-Za-z0-9_-]{0,80}$/.test(status)||!/^\d{4}-\d{2}-\d{2}$|^$/.test(from)||!/^\d{4}-\d{2}-\d{2}$|^$/.test(to)||(from&&to&&from>to)||!Number.isInteger(page)||page<1||page>40)return finish("Unavailable",403);
      response.cookies.set('square-activity-filter',JSON.stringify({kind,status,location,from,to,sort,page}),{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:3600});
      return redirect('/activity');
    }
    const selected = req.cookies.get('square-evidence-workspace')?.value;
    const workspace = selected ? workspaceLabels.find(name=>name===selected) : workspaceLabels[0];
    let body = controls(workspaceLabels, workspace);
    if (workspace) {
      body += `<section id="overview" class="panel"><span class="eyebrow">Workspace overview · Sandbox</span><h2>${escape(workspace)}</h2><p class="muted">Inspect deterministic provider evidence in an isolated Executive Intelligence experience. Production and QBO are not connected here.</p></section>`;
      signal.throwIfAborted();
      // Membership, subscription and complete evidence authority are one RPC.
      if(path==="/activity"){
        let filter:{kind:string;status:string;location:string;from:string;to:string;sort:"newest"|"oldest";page:number}={kind:"",status:"",location:"",from:"",to:"",sort:"newest",page:1};
        try{const candidate=JSON.parse(req.cookies.get('square-activity-filter')?.value||'{}');if(candidate&&['','payment','refund','order','catalog','inventory'].includes(candidate.kind)&&
          ['','mapped_location','seller_scoped','explicitly_unresolved'].includes(candidate.location)&&['newest','oldest'].includes(candidate.sort)&&
          /^[A-Za-z0-9_-]{0,80}$/.test(candidate.status)&&/^\d{4}-\d{2}-\d{2}$|^$/.test(candidate.from)&&/^\d{4}-\d{2}-\d{2}$|^$/.test(candidate.to)&&
          !(candidate.from&&candidate.to&&candidate.from>candidate.to)&&Number.isInteger(candidate.page)&&candidate.page>=1&&candidate.page<=40)filter=candidate;}catch{}
        const view=await readSquareWorkspaceOperational(client,workspace,{kind:filter.kind||null,status:filter.status||null,location:filter.location||null,from:filter.from||null,to:filter.to||null,sort:filter.sort,page:filter.page},req.headers);
        return finish(view?body+operational(view,filter):body+'<section class="panel"><p>No Square evidence available.</p></section>');
      }
      const evidence = await readSquareWorkspaceCard(client,workspace,req.headers);
      if (!evidence) return finish(body+'<section class="panel"><p>No Square evidence available.</p></section>');
      body += card(evidence);
    } else body += '<section class="panel"><p>No Square evidence available.</p></section>';
    return finish(body);
  } catch { return finish("Evidence unavailable",503); }
}
