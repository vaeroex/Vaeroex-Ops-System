import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type PublicPageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  aside?: ReactNode;
};

export function PublicPageHero({ eyebrow, title, description, actions, aside }: PublicPageHeroProps) {
  return (
    <section className="vaeroex-public-hero relative overflow-hidden border-b border-white/10 px-5 py-12 text-white sm:px-6 sm:py-16">
      <div className="vaeroex-public-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className={`relative mx-auto max-w-7xl ${aside ? "grid gap-8 lg:grid-cols-[minmax(0,.96fr)_minmax(30rem,1.04fr)] lg:items-center" : ""}`}>
        <div className="vaeroex-hero-reveal max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.08] tracking-normal text-white sm:text-5xl lg:text-[3.35rem]">
            {title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">{description}</p>
          {actions ? <div className="mt-7 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </div>
    </section>
  );
}

type PublicSectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
};

export function PublicSectionHeading({ eyebrow, title, description, align = "left" }: PublicSectionHeadingProps) {
  const alignment = align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl";

  return (
    <div className={alignment}>
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{eyebrow}</p> : null}
      <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-normal text-white sm:text-4xl">{title}</h2>
      {description ? <p className="mt-4 text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">{description}</p> : null}
    </div>
  );
}

type PublicCtaBandProps = {
  eyebrow?: string;
  title: string;
  description: string;
  primaryHref?: Route;
  primaryLabel?: string;
  secondaryHref?: Route;
  secondaryLabel?: string;
};

export function PublicCtaBand({
  eyebrow = "Vaeroex Operations Intelligence",
  title,
  description,
  primaryHref = "/pricing",
  primaryLabel = "Start With Vaeroex",
  secondaryHref = "/contact",
  secondaryLabel = "Contact Vaeroex"
}: PublicCtaBandProps) {
  return (
    <section className="px-5 py-8 sm:px-6 sm:py-10">
      <div className="vaeroex-cta-band mx-auto flex max-w-7xl flex-col gap-5 overflow-hidden rounded-lg border border-cyan-300/20 bg-[#07111f] p-5 text-white shadow-command sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">{eyebrow}</p>
          <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-normal sm:text-3xl">{title}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link href={primaryHref} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            {primaryLabel}
          </Link>
          <Link href={secondaryHref} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
