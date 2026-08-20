type StartWithVaeroexMenuProps = {
  align?: "left" | "right";
  className?: string;
  label?: string;
  size?: "default" | "compact";
};

export function StartWithVaeroexMenu({ className = "", label = "Start With Vaeroex", size = "default" }: StartWithVaeroexMenuProps) {
  const linkSize = size === "compact" ? "px-4 py-2" : "px-5 py-3";

	return (
	  <a
	      href="/checkout/legal"
      className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-vaeroex-blue ${linkSize} text-sm font-semibold text-white shadow-sm hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/40 ${className}`}
    >
      {label}
    </a>
  );
}
