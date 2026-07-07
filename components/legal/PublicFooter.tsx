import Link from "next/link";
import type { Route } from "next";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { VAEROEX_COMPANY_ADDRESS_LINES, VAEROEX_CONTACT_EMAILS, VAEROEX_FOOTER_LOCATION, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { legalLinks } from "@/lib/legal/content";

const platformLinks: Array<[string, Route]> = [
  ["Platform", "/"],
  ["Operations Intelligence", "/operations-intelligence"],
  ["Pricing", "/pricing"],
  ["About", "/about"],
  ["Careers", "/careers"],
  ["Network", "/networking"],
  ["Trust", "/trust"],
  ["Help", "/help"]
] as Array<[string, Route]>;

const accessLinks = [
  ["Explore Operations Intelligence", "/operations-intelligence"],
  ["Contact", "/contact"],
  ["Login", "/login"],
  ["Signup", "/signup"]
] as const;

const contactLinks = [
  ["General", VAEROEX_CONTACT_EMAILS.general, VAEROEX_MAILTO_LINKS.general],
  ["Support", VAEROEX_CONTACT_EMAILS.support, VAEROEX_MAILTO_LINKS.support],
  ["Billing", VAEROEX_CONTACT_EMAILS.billing, VAEROEX_MAILTO_LINKS.billing],
  ["Partners", VAEROEX_CONTACT_EMAILS.partners, VAEROEX_MAILTO_LINKS.partners]
] as const;

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-white px-6 py-6 text-sm text-muted">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <div>
          <Link href="/" className="inline-flex items-center gap-3 text-ink" aria-label="Vaeroex home">
            <VaeroexLogo variant="symbol" size="xs" />
            <span className="font-semibold">Vaeroex</span>
          </Link>
          <p className="mt-2 max-w-md leading-5">
            Intelligence Platform. The Advantage of Knowing First.
          </p>
          <p className="mt-2 text-xs">Visibility • Awareness • Execution</p>
          <p className="mt-2 text-xs">{VAEROEX_FOOTER_LOCATION}</p>
          <div className="mt-3 text-xs leading-5">
            <p className="font-semibold text-ink">Business Address</p>
            <address className="mt-1 not-italic">
              {VAEROEX_COMPANY_ADDRESS_LINES.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold text-ink">Platform</p>
            <div className="mt-2 grid gap-1.5">
              {platformLinks.map(([label, href]) => (
                <Link key={href} href={href} className="hover:text-vaeroex-blue">
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-ink">Access</p>
            <div className="mt-2 grid gap-1.5">
              {accessLinks.map(([label, href]) => (
                <Link key={href} href={href} className="hover:text-vaeroex-blue">
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-ink">Direct Email</p>
            <div className="mt-2 grid gap-1.5">
              {contactLinks.map(([label, email, href]) => (
                <a key={email} href={href} className="hover:text-vaeroex-blue">
                  {label}: {email}
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-ink">Legal</p>
            <nav className="mt-2 grid gap-1.5" aria-label="Legal links">
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
