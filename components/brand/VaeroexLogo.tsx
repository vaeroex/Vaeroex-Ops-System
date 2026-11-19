import Image from "next/image";

type LogoVariant = "wordmark" | "stacked" | "symbol";
type LogoSize = "xs" | "sm" | "md" | "lg" | "hero";

const artwork = {
  wordmark: { src: "/brand/official/wordmark.png", width: 1498, height: 209 },
  stacked: { src: "/brand/official/stacked.png", width: 894, height: 657 },
  symbol: { src: "/brand/official/symbol.png", width: 854, height: 581 },
} as const;

const widths: Record<LogoVariant, Record<LogoSize, string>> = {
  wordmark: { xs: "w-24", sm: "w-28", md: "w-36", lg: "w-44", hero: "w-56" },
  stacked: { xs: "w-16", sm: "w-20", md: "w-28", lg: "w-36", hero: "w-44" },
  symbol: { xs: "w-7", sm: "w-9", md: "w-11", lg: "w-16", hero: "w-24" },
};

export function VaeroexLogo({
  variant = "wordmark", size = "md", compact = false, priority = false, className = "",
}: {
  variant?: LogoVariant;
  size?: LogoSize;
  compact?: boolean;
  priority?: boolean;
  className?: string;
}) {
  return (
    <picture data-logo-variant={variant} className={`inline-block max-w-full shrink-0 align-middle ${widths[variant][size]} ${compact ? "max-[1000px]:w-10" : ""} ${className}`}>
      {compact && <source media="(max-width: 1000px)" srcSet={artwork.symbol.src} width={artwork.symbol.width} height={artwork.symbol.height} />}
      <Image unoptimized {...artwork[variant]} alt="Vaeroex"
        loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined}
        className="block h-auto w-full object-contain" />
    </picture>
  );
}
