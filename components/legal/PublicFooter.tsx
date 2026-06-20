import Link from "next/link";
import type { Route } from "next";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { legalLinks } from "@/lib/legal/content";

const platformLinks: Array<[string, Route]> = [
  ["Operations Intelligence", "/#operations-intelligence"],
  ["Pricing", "/pricing"],
  ["About", "/about"],
  ["Network", "/networking"],
  ["Trust", "/trust"],
  ["Help", "/help"]
] as Array<[string, Route]>;

const accessLinks = [
  ["Book a Demo", "/demo"],
  ["Contact", "/contact"],
  ["Login", "/login"],
  ["Signup", "/signup"]
] as const;

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-white px-6 py-8 text-sm text-muted">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <div>
          <Link href="/" className="inline-flex items-center gap-3 text-ink" aria-label="Vaeroex home">
            <VaeroexLogo variant="symbol" size="xs" />
            <span className="font-semibold">Vaeroex</span>
          </Link>
          <p className="mt-3 max-w-md leading-6">
            Intelligence Platform. Build the structure your growth depends on.
          </p>
          <p className="mt-3 text-xs">Visibility • Accountability • Execution</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="font-semibold text-ink">Platform</p>
            <div className="mt-3 grid gap-2">
              {platformLinks.map(([label, href]) => (
                <Link key={href} href={href} className="hover:text-vaeroex-blue">
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-ink">Access</p>
            <div className="mt-3 grid gap-2">
              {accessLinks.map(([label, href]) => (
                <Link key={href} href={href} className="hover:text-vaeroex-blue">
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-ink">Legal</p>
            <nav className="mt-3 grid gap-2" aria-label="Legal links">
              {legalLinks.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-vaeroex-blue">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
