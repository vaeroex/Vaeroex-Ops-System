import Link from "next/link";
import { legalLinks } from "@/lib/legal/content";

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-white px-6 py-6 text-sm text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>Vaeroex - Operations Intelligence Platform</p>
        <nav className="flex flex-wrap gap-3" aria-label="Legal links">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href} className="font-semibold text-slate-600 hover:text-vaeroex-blue">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
