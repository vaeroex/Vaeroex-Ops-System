import Link from "next/link";
import { HelpArticleCard } from "@/components/help/HelpArticleCard";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { articlesByCategory, helpCategories, searchHelpArticles, type HelpCategory } from "@/lib/help/content";

type PublicHelpPageProps = {
  searchParams?: Promise<{ q?: string; category?: string }>;
};

async function getLoggedIn() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return Boolean(user);
}

export default async function PublicHelpPage({ searchParams }: PublicHelpPageProps) {
  const params = await searchParams;
  const query = params?.q || "";
  const selectedCategory = helpCategories.includes(params?.category as HelpCategory) ? (params?.category as HelpCategory) : "";
  const loggedIn = await getLoggedIn();
  const articles = query ? searchHelpArticles(query) : selectedCategory ? articlesByCategory(selectedCategory) : searchHelpArticles("");
  const visibleArticles = selectedCategory && query ? articles.filter((article) => article.category === selectedCategory) : articles;

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Help Hub</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Learn how Vaeroex helps build visibility, accountability, and execution.</h1>
            <p className="mt-4 text-sm leading-6 text-muted">
              Public help articles explain the platform, best practices, trust posture, legal policies, and how to contact Vaeroex.
            </p>
            <p className="mt-3 text-sm font-semibold text-vaeroex-blue">Intelligence Platform • Build the structure your growth depends on.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {loggedIn ? (
                <Link href="/app/help" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
                  Open in-app Help Center
                </Link>
              ) : (
                <Link href="/login" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
                  Login for workspace help
                </Link>
              )}
              <Link href="/contact" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Contact Vaeroex
              </Link>
            </div>
          </div>

          <form className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <label className="block text-sm font-semibold">
              Search help
              <input
                name="q"
                defaultValue={query}
                placeholder="Search getting started, KPIs, reports, trust..."
                className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-vaeroex-blue focus:ring-2 focus:ring-vaeroex-blue/15"
              />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Category
              <select
                name="category"
                defaultValue={selectedCategory}
                className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-vaeroex-blue focus:ring-2 focus:ring-vaeroex-blue/15"
              >
                <option value="">All categories</option>
                {helpCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <button className="mt-4 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
          </form>
        </div>

        <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Getting started", "What Vaeroex is and how to begin."],
            ["Feature guides", "KPIs, CRM, reports, files, SOPs, and more."],
            ["AI & Vaeroex", "How recommendations work and why review matters."],
            ["Legal & trust", "Policies, sensitive data, and security posture."]
          ].map(([title, description]) => (
            <article key={title} className="rounded-lg border border-line bg-white p-4 shadow-sm">
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Articles</p>
              <h2 className="mt-1 text-2xl font-semibold">{visibleArticles.length} public guide{visibleArticles.length === 1 ? "" : "s"}</h2>
            </div>
            <Link href="/trust" className="text-sm font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              Visit Trust Center
            </Link>
          </div>
          {visibleArticles.slice(0, 18).map((article) => (
            <HelpArticleCard key={article.id} article={article} />
          ))}
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}
