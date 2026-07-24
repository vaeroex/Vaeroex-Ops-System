import Link from "next/link";
import type { Route } from "next";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { VAEROEX_COMPANY_ADDRESS_LINES, VAEROEX_CONTACT_EMAILS, VAEROEX_FOOTER_LOCATION, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { legalLinks } from "@/lib/legal/content";

const platformLinks: Array<[string, Route]> = [
  ["Home", "/"],
  ["Executive Intelligence", "/executive-intelligence"],
  ["Pricing", "/pricing"],
  ["Trust", "/trust"]
] as Array<[string, Route]>;

const companyLinks = [
  ["About", "/about"],
  ["Contact", "/contact"],
  ["Careers", "/careers"],
  ["Network", "/networking"]
] as const;

const supportLinks = [
  ["Help", "/help"],
  ["Login", "/login"],
  ["Contact", "/contact"]
] as const;

const emailLinks = [
  ["Support", VAEROEX_CONTACT_EMAILS.support, VAEROEX_MAILTO_LINKS.support],
  ["Billing", VAEROEX_CONTACT_EMAILS.billing, VAEROEX_MAILTO_LINKS.billing],
  ["Partners", VAEROEX_CONTACT_EMAILS.partners, VAEROEX_MAILTO_LINKS.partners]
] as const;

export function PublicFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#050b18] px-5 py-8 text-sm text-slate-400 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.1fr_1.5fr] lg:items-start">
        <div>
          <Link href="/" className="inline-flex items-center gap-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" aria-label="Vaeroex home">
            <VaeroexLogo variant="symbol" size="xs" />
            <span className="font-semibold">Vaeroex</span>
          </Link>
          <p className="mt-3 max-w-sm leading-6 text-slate-300">Vaeroex Intelligence Systems transforms business information into visibility, awareness, prediction, and executive action.</p>
          <p className="mt-3 text-xs">{VAEROEX_FOOTER_LOCATION}</p>
          <div className="mt-4 text-xs leading-5">
            <p className="font-semibold text-slate-200">Business Address</p>
            <address className="mt-1 not-italic">
              {VAEROEX_COMPANY_ADDRESS_LINES.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold text-slate-200">Product</p>
            <div className="mt-2 grid gap-1.5">
              {platformLinks.map(([label, href]) => (
                <Link key={href} href={href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-slate-200">Company</p>
            <div className="mt-2 grid gap-1.5">
              {companyLinks.map(([label, href]) => (
                <Link key={href} href={href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-slate-200">Support</p>
            <div className="mt-2 grid gap-1.5">
              {supportLinks.map(([label, href]) => (
                <Link key={href} href={href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {label}
                </Link>
              ))}
              {emailLinks.map(([label, email, href]) => (
                <a key={email} href={href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {label}
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-slate-200">Legal</p>
            <nav className="mt-2 grid gap-1.5" aria-label="Legal links">
              {legalLinks.map((link) => (
                <Link key={link.href} href={link.href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-6 flex max-w-7xl flex-col gap-2 border-t border-white/10 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Vaeroex LLC. All rights reserved.</p>
        <p>The Advantage of Knowing First.</p>
      </div>
    </footer>
  );
}
