import { VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const startOptions = [
  {
    title: "Operations Intelligence",
    description: "Start the current Vaeroex product subscription.",
    href: "/api/stripe/checkout",
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
  const menuAlignment = align === "right" ? "left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0" : "left-0";
  const summarySize = size === "compact" ? "px-4 py-2" : "px-5 py-3";
  const menuSurfaceClass =
    "absolute z-30 mt-2 grid w-[min(20rem,calc(100vw-3rem))] gap-2 rounded-lg border border-vaeroex-accent/25 bg-[#07111f] p-2 text-slate-100 shadow-command";
  const menuItemClass =
    "rounded-lg border border-white/10 bg-[#0b1628] px-3 py-3 text-slate-100 outline-none transition hover:border-vaeroex-accent/45 hover:bg-[linear-gradient(135deg,rgba(20,35,70,0.96),rgba(12,21,42,0.98))] hover:shadow-[0_0_22px_rgba(56,189,248,0.14)] focus-visible:border-vaeroex-accent focus-visible:bg-[linear-gradient(135deg,rgba(20,35,70,0.96),rgba(12,21,42,0.98))] focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 active:border-vaeroex-blue";

  return (
    <details className={`group relative ${className}`}>
      <summary className={`cursor-pointer list-none rounded-lg bg-vaeroex-blue ${summarySize} text-sm font-semibold text-white shadow-sm hover:bg-vaeroex-accent hover:text-vaeroex-navy focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/40 [&::-webkit-details-marker]:hidden`}>
        Start With Vaeroex
      </summary>
      <div className={`${menuSurfaceClass} ${menuAlignment}`}>
        {startOptions.map((option) => (
          <a key={option.title} href={option.href} className={menuItemClass}>
            <span className="block text-sm font-semibold text-slate-50">{option.title}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-300">{option.description}</span>
            <span className="mt-2 inline-flex text-xs font-semibold text-vaeroex-accent">{option.action}</span>
          </a>
        ))}
      </div>
    </details>
  );
}
