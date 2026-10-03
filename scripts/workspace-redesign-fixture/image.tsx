import React from "react";
export default function Image({ priority, alt, ...props }: React.ComponentProps<"img"> & { priority?: boolean }) {
  void priority;
  if (!["/icon-192.png", "/brand/vaeroex-logo-white-wordmark.png"].includes(String(props.src))) throw new Error("Unreviewed image source");
  // The fixture serves the reviewed static image directly; no Next image endpoint exists.
  return <picture><img {...props} alt={alt} /></picture>;
}
