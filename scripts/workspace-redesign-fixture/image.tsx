import React from "react";
export default function Image({ priority, unoptimized, alt, ...props }: React.ComponentProps<"img"> & { priority?: boolean; unoptimized?: boolean }) {
  void priority;
  void unoptimized;
  if (!["/brand/official/symbol.png", "/brand/official/wordmark.png", "/brand/official/stacked.png"].includes(String(props.src))) throw new Error("Unreviewed image source");
  // The fixture serves the reviewed static image directly; no Next image endpoint exists.
  // eslint-disable-next-line @next/next/no-img-element -- This is the image stand-in for the loopback fixture.
  return <img {...props} alt={alt} />;
}
