import { notFound } from "next/navigation";
import { squareInternalPilotAccess } from "@/lib/integrations/control-plane/square-internal-pilot";
export const dynamic = "force-dynamic";
export default async function SquareInternalPilotPage() {
  if (!await squareInternalPilotAccess()) notFound();
  return <main className="mx-auto max-w-2xl space-y-5 p-8">
    <h1 className="text-2xl font-semibold">Square internal pilot</h1>
    <p>Connect the one approved internal seller. This is not general customer onboarding.</p>
    <p>Read-only provider observations only. Revenue, profit, stock calculations, scheduling, webhooks and automated recommendations remain unavailable.</p>
    <form action="/api/integrations/square/internal/connect" method="post">
      <button className="rounded border px-4 py-2" type="submit">Authorize the approved Square seller</button>
    </form>
  </main>;
}
