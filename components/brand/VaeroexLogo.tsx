import Image from "next/image";

type VaeroexLogoProps = {
  variant?: "full" | "symbol";
  size?: "xs" | "sm" | "md" | "lg" | "hero";
  priority?: boolean;
  className?: string;
};

const logoSizes = {
  xs: { className: "h-7 w-10", height: 42, width: 64 },
  sm: { className: "h-9 w-14", height: 54, width: 84 },
  md: { className: "h-12 w-28", height: 90, width: 132 },
  lg: { className: "h-16 w-40", height: 132, width: 192 },
  hero: { className: "h-24 w-64", height: 178, width: 260 }
} as const;

export function VaeroexLogo({ variant = "full", size = "md", priority = false, className = "" }: VaeroexLogoProps) {
  const logo = logoSizes[size];

  return (
    <span data-logo-variant={variant} className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${logo.className} ${className}`}>
      <Image
        src="/brand/vaeroex-logo.png"
        alt="Vaeroex logo"
        width={logo.width}
        height={logo.height}
        priority={priority}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
