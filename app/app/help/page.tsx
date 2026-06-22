import Link from "next/link";
import { HelpArticleCard } from "@/components/help/HelpArticleCard";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { articlesByCategory, helpCategories, searchHelpArticles } from "@/lib/help/content";
import { legalDocuments } from "@/lib/legal/content";

type HelpCenterPageProps = {
  searchParams?: Promise<{ q?: string; category?: string }>;
};

export default async function HelpCenterPage({ searchParams }: HelpCenterPageProps) {
  const params = await searchParams;
  const query = params?.q || "";
  const selectedCategory = params?.category || "";
  const activeCategory = helpCategories.find((category) => category === selectedCategory);
  const filtered = query ? searchHelpArticles(query) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Help Center"
        title="Vaeroex customer education"
        description="Guides for Vaeroex as an Intelligence Platform, Operations Intelligence as the current product, trust, legal safety, billing, and support."
        actions={
          <>
            <Link href="/app/support" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">Contact Support</Link>
            <Link href="/app/help/trust" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Trust Center</Link>
          </>
        }
      />

      <SectionCard title="Search help" description="Search articles, policies, best practices, and Vaeroex guidance.">
        <form className="flex flex-col gap-3 sm:flex-row">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search Vaeroex help..."
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-vaeroex-blue focus:ring-2 focus:ring-vaeroex-blue/15"
          />
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {helpCategories.map((category) => (
            <Link
              key={category}
              href={`/app/help?category=${encodeURIComponent(category)}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                selectedCategory === category ? "border-vaeroex-blue bg-vaeroex-soft text-vaeroex-blue" : "border-line text-slate-600"
              }`}
            >
              {category}
            </Link>
          ))}
        </div>
      </SectionCard>

      {query ? (
        <SectionCard title={`Search results for "${query}"`} description={`${filtered.length} article${filtered.length === 1 ? "" : "s"} found.`}>
          <div className="grid gap-4">
            {filtered.length ? filtered.map((article) => <HelpArticleCard key={article.id} article={article} />) : <p className="text-sm text-muted">No matching help articles found.</p>}
          </div>
        </SectionCard>
      ) : null}

      {!query && activeCategory ? (
        <SectionCard title={activeCategory} description="Focused guides for this help category.">
          <div className="grid gap-4">
            {articlesByCategory(activeCategory).map((article) => (
              <HelpArticleCard key={article.id} article={article} />
            ))}
          </div>
        </SectionCard>
      ) : null}

      {!query && !selectedCategory ? (
        <div className="space-y-6">
          {helpCategories.map((category) => {
            const articles = articlesByCategory(category).slice(0, category === "Operations Intelligence" || category === "AI & Vaeroex" ? 8 : 4);

            return (
              <SectionCard key={category} title={category} description="Open a guide for plain-English workflows, common mistakes, and next steps.">
                <div className="grid gap-4 lg:grid-cols-2">
                  {articles.map((article) => (
                    <HelpArticleCard key={article.id} article={article} />
                  ))}
                </div>
                <Link href={`/app/help?category=${encodeURIComponent(category)}`} className="mt-4 inline-flex rounded-lg border border-line px-3 py-2 text-sm font-semibold">
                  View all {category}
                </Link>
              </SectionCard>
            );
          })}
        </div>
      ) : null}

      <SectionCard title="Legal and trust quick links" description="Draft policy structure and customer education. Final legal text should be reviewed by qualified counsel before broad commercial launch.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.values(legalDocuments).map((document) => (
            <Link key={document.id} href={document.href} className="rounded-lg border border-line bg-slate-50 p-4 hover:border-vaeroex-blue">
              <p className="text-sm font-semibold text-ink">{document.title}</p>
              <p className="mt-2 text-xs leading-5 text-muted">{document.summary}</p>
            </Link>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
