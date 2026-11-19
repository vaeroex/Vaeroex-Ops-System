import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="vaeroex-public-site min-h-screen bg-vaeroex-navy px-6 py-10 text-white">
      <section className="mx-auto max-w-2xl rounded-lg border border-white/15 p-7">
        <VaeroexLogo size="sm" />
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">This address does not open a current Vaeroex page.</p>
        <Link href="/" className="vx-button vx-button--primary mt-5">
          Return to Vaeroex
        </Link>
      </section>
    </main>
  );
}
