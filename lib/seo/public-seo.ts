import type { Metadata } from "next";

export const PUBLIC_SITE_URL = "https://www.vaeroex.com";
const previewHost = typeof process !== "undefined" && process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_URL : undefined;
const assetOrigin = previewHost ? `https://${previewHost}` : PUBLIC_SITE_URL;

type PublicMetadataInput = {
  title: string;
  description: string;
  path?: string;
};

export function publicPageMetadata({ title, description, path = "/" }: PublicMetadataInput): Metadata {
  const canonicalPath = path === "/" ? "/" : path;
  const canonical = `${PUBLIC_SITE_URL}${canonicalPath === "/" ? "" : canonicalPath}`;

  const image = `${assetOrigin}/brand/official/social.png`;

  return {
    title,
    description,
    alternates: {
      canonical
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Vaeroex",
      type: "website",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: "Vaeroex"
        }
      ]
    },
    other: { "twitter:url": canonical },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image]
    }
  };
}

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Vaeroex",
  legalName: "Vaeroex LLC",
  url: PUBLIC_SITE_URL,
  logo: `${assetOrigin}/brand/official/stacked.png`,
  description: "Vaeroex builds Drug Discovery Intelligence to help research teams inspect compound evidence, document decisions, and export approved test batches.",
  address: {
    "@type": "PostalAddress",
    streetAddress: "5319 University Dr, Unit 762",
    addressLocality: "Irvine",
    addressRegion: "CA",
    postalCode: "92612",
    addressCountry: "US"
  },
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@vaeroex.com",
      url: `${PUBLIC_SITE_URL}/support`
    }
  ]
};

export const utilityRobots = { index: false, follow: false } as const;
