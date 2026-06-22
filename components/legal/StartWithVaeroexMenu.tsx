import { squarespaceCheckoutUrl } from "@/lib/billing/squarespace-plan-map";
import { VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const startOptions = [
  {
    title: "Operations Intelligence",
    description: "Start the current Vaeroex product subscription.",
    href: squarespaceCheckoutUrl,
    action: "Start subscription"
  },
  {
    title: "Contact Vaeroex",
    description: "Ask a question before starting.",
    href: VAEROEX_MAILTO_LINKS.general,
    action: "Contact"
  },
  {
    title: "Billing Questions",
    description: "Ask about subscriptions, payments, or billing.",
    href: VAEROEX_MAILTO_LINKS.billing,
    action: "Ask billing"
  }
] as const;

type StartWithVaeroexMenuProps = {
  align?: "left" | "right";
  className?: string;
  size?: "default" | "compact";
};

export function StartWithVaeroexMenu({ align = "left", className = "", size = "default" }: StartWithVaeroexMenuProps) {
  const menuAlignment = align === "right" ? "right-0" : "left-0";
  const summarySize = size === "compact" ? "px-4 py-2" : "px-5 py-3";

  return (
    <details className={`group relative ${className}`}>
      <summary className={`cursor-pointer list-none rounded-lg bg-vaeroex-blue ${summarySize} text-sm font-semibold text-white shadow-sm hover:bg-vaeroex-accent hover:text-vaeroex-navy focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/40 [&::-webkit-details-marker]:hidden`}>
        Start With Vaeroex
      </summary>
      <div className={`absolute ${menuAlignment} z-30 mt-2 grid w-[min(20rem,calc(100vw-3rem))] gap-2 rounded-lg border border-line bg-white p-2 text-ink shadow-command`}>
        {startOptions.map((option) => (
          <a key={option.title} href={option.href} className="rounded-lg border border-transparent px-3 py-3 hover:border-vaeroex-blue/30 hover:bg-slate-50">
            <span className="block text-sm font-semibold text-ink">{option.title}</span>
            <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
            <span className="mt-2 inline-flex text-xs font-semibold text-vaeroex-blue">{option.action}</span>
          </a>
        ))}
      </div>
    </details>
  );
}
