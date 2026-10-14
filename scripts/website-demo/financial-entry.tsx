import React from "react";
import Link from "next/link";
import { createRoot } from "react-dom/client";
import { VsiWorkspace } from "@/components/vsi/VsiWorkspace";
import { wrapScreen } from "./screens";
import { usePathname, useSearchParams, navigate } from "./navigation";
import { workspace, profile } from "./data";
import record from "./financial-response.json";
import evidence from "./financial-evidence.json";

// Review-only recording of the genuine authenticated API exchange. No writes,
// generation, provider credentials or backend dependencies are bundled here.
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || (init?.method && init.method !== "GET") || url.searchParams.get("workspaceId") !== workspace.id)
    return Response.json({ message: "This isolated review recording is read-only." }, { status: 405 });
  const common = { workspaceId: workspace.id, canEditBusinessNotes: false };
  if (url.pathname === "/api/vsi/conversations") return Response.json({ ...common, conversations: [record.conversation], nextCursor: null });
  if (url.pathname === `/api/vsi/conversations/${record.conversation.id}`) return Response.json({ ...common, conversation: record.conversation, exchanges: [record.exchange] });
  return Response.json({ message: "Outside this recorded review. No action was performed." }, { status: 404 });
};
document.addEventListener("click", event => {
  const link = (event.target as Element).closest?.("a");
  if (!link || event.defaultPrevented || !link.getAttribute("href")) return;
  event.preventDefault(); const url = new URL(link.href, location.origin);
  if (url.origin === location.origin && url.pathname.startsWith("/app")) navigate(url.pathname + url.search + url.hash);
});
function App() {
  const pathname = usePathname(), params = useSearchParams();
  const sourceId = params.get("sourceId");
  const matched = evidence.sources.filter(source => sourceId ? source.sourceId === sourceId : source.url.split("#")[0] === pathname + location.search);
  const body = pathname === "/app/si" ? <VsiWorkspace workspaceId={workspace.id} workspaceName={workspace.name} userId={profile.id} timeZone="America/Los_Angeles" initialConversationId={record.conversation.id} />
    : <section className="space-y-4"><Link className="underline" href="/app/si">Back to saved conversation</Link><h1 className="text-xl font-semibold">Retrieved evidence snapshot</h1>
      <p className="text-sm">Fictional Coastal Kitchen review. These are the source inputs retrieved for this qualification; the application’s original source links remain permission checked.</p>
      {matched.length ? matched.map(source => <section key={source.id} className="space-y-2 rounded border border-line p-4"><h2 className="font-semibold">{source.title}</h2><p className="text-sm">Evidence: {source.evidenceDate || "Not established"} · Retrieved: {source.retrievedAt}</p><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{(() => { try { return JSON.stringify(JSON.parse(source.text), null, 2); } catch { return source.text; } })()}</pre></section>) : <p>This destination is outside the recorded evidence selection.</p>}
    </section>;
  return <><p className="bg-amber-50 px-3 py-1 text-xs text-amber-950">Isolated fictional review · Recorded real VSI answer · Read-only</p>{wrapScreen(body, "owner", pathname)}</>;
}
createRoot(document.getElementById("root")!).render(<App />);
