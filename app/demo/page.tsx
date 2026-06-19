import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicRequestForm } from "@/components/legal/PublicRequestForm";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";

type DemoPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

const previewItems = [
  "Executive Dashboard",
  "Business Health Score",
  "KPI trends",
  "CRM pipeline",
  "Reports",
  "Profit Leak Detection",
  "Business Memory",
  "Accountability signals"
];

export default async function DemoPage({ searchParams }: DemoPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Book a Demo</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Preview Vaeroex as an Operations Intelligence Platform.</h1>
          <p className="mt-4 text-sm leading-6 text-muted">
            Tell us what you are trying to improve. Vaeroex will review your request and help you understand how visibility,
            accountability, and execution can fit your business.
          </p>
          <div className="mt-6 rounded-lg border border-line bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Product preview can include</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {previewItems.map((item) => (
                <div key={item} className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-5 text-sm leading-6 text-muted">
            Already have an account? <Link href="/login" className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">Login</Link> or go to your workspace.
          </p>
        </div>
        <PublicRequestForm
          returnPath="/demo"
          issueType="Demo request"
          message={params?.message}
          error={params?.error}
          submitLabel="Request demo"
        />
      </section>
      <PublicFooter />
    </main>
  );
}
