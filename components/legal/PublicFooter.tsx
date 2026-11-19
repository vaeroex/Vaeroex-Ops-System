import Link from "next/link";
import type { Route } from "next";
import "@/components/marketing/public-design.css";
import { VAEROEX_COMPANY_ADDRESS_LINES, VAEROEX_CONTACT_EMAILS, VAEROEX_FOOTER_LOCATION, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { legalLinks } from "@/lib/legal/content";

const platformLinks: Array<[string, Route]> = [
  ["Drug Discovery Intelligence", "/drug-discovery-intelligence"],
  ["Explore sample compounds", "/drug-discovery-intelligence/demo"],
  ["Request a walkthrough", "/contact?inquiry=drug-discovery"],
  ["Executive Intelligence", "/executive-intelligence"],
  ["Executive pricing", "/pricing#intelligence-pricing"],
  ["Custom software", "/custom-business-systems"],
  ["Discuss a project", "/contact?inquiry=custom-business-systems"],
  ["Website development", "/website-development"]
] as Array<[string, Route]>;

const companyLinks = [
  ["About", "/about"],
  ["Why Vaeroex", "/about/why-vaeroex"],
  ["Vaeroex Super Intelligence", "/about#vsi"],
  ["Trust Center", "/trust"],
  ["Contact", "/contact"],
  ["Careers", "/careers"],
  ["Network", "/networking"]
] as const;

const supportLinks = [
  ["Help", "/help"],
  ["Executive Intelligence sign in", "/login"],
  ["Contact", "/contact"]
] as const;

const emailLinks = [
  ["Support", VAEROEX_CONTACT_EMAILS.support, VAEROEX_MAILTO_LINKS.support],
  ["Billing", VAEROEX_CONTACT_EMAILS.billing, VAEROEX_MAILTO_LINKS.billing],
  ["Partners", VAEROEX_CONTACT_EMAILS.partners, VAEROEX_MAILTO_LINKS.partners]
] as const;

const policyGroups = [
  {
    title: "Legal & Billing",
    paths: ["/terms", "/subscription-billing-terms", "/refund-policy", "/workspace-capacity-terms", "/acceptable-use"]
  },
  {
    title: "Privacy & Trust",
    paths: ["/privacy", "/trust", "/sensitive-data-policy", "/data-retention", "/ai-disclaimer", "/human-review"]
  }
].map(({ title, paths }) => ({
  title,
  links: paths.flatMap((path) => legalLinks.filter((link) => link.href === path))
}));

export function PublicFooter() {
  return (
    <footer className="vx-footer px-5 py-10 text-sm text-slate-400 sm:px-6 lg:py-14">
      <div className="mx-auto grid max-w-[86rem] gap-10 lg:grid-cols-[1.1fr_1.5fr] lg:items-start">
        <div>
          <Link href="/" className="inline-flex items-center gap-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" aria-label="Vaeroex home">
            <span className="vx-footer-wordmark">VAEROEX</span>
          </Link>
          <p className="mt-4 max-w-sm text-base leading-7 text-slate-300">Drug Discovery Intelligence connects compound evidence to the decision about what to test next.</p>
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
        <div className="vx-footer-links grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="font-semibold text-slate-200">Products &amp; services</p>
            <div className="mt-2 grid gap-1.5">
              {platformLinks.map(([label, href]) => (
                href === "/executive-intelligence" ? (
                  <div key={href} className="vx-footer-product">
                    <Link href={href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                      {label}
                    </Link>
                    <p className="vx-footer-product-description">Includes VSI Chat.</p>
                  </div>
                ) : (
                  <Link key={href} href={href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                    {label}
                  </Link>
                )
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
          <div className="vx-footer-support">
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
          {policyGroups.map(({ title, links }) => (
            <nav key={title} aria-label={title}>
              <p className="font-semibold text-slate-200">{title}</p>
              <div className="mt-2 grid gap-1.5">
                {links.map((link) => (
                  <Link key={link.href} href={link.href} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                    {link.label}
                  </Link>
                ))}
              </div>
            </nav>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-[86rem] flex-col gap-2 border-t border-white/10 pt-5 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Vaeroex LLC. All rights reserved.</p>
      </div>
    </footer>
  );
}
