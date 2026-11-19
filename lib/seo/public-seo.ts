import type { Metadata } from "next";

export const PUBLIC_SITE_URL = "https://www.vaeroex.com";

type PublicMetadataInput = {
  title: string;
  description: string;
  path?: string;
};

export function publicPageMetadata({ title, description, path = "/" }: PublicMetadataInput): Metadata {
  const canonicalPath = path === "/" ? "/" : path;
  const canonical = `${PUBLIC_SITE_URL}${canonicalPath === "/" ? "" : canonicalPath}`;

  const discovery = path === "/" || path === "/drug-discovery-intelligence" || path === "/drug-discovery-intelligence/demo";
  const previewHost = typeof process !== "undefined" && process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_URL : undefined;
  const assetOrigin = previewHost ? `https://${previewHost}` : PUBLIC_SITE_URL;
  const image = discovery ? `${assetOrigin}/brand/drug-discovery-social.png` : `${PUBLIC_SITE_URL}/brand/vaeroex-social.jpg`;

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
          alt: discovery ? "Vaeroex Drug Discovery Intelligence. Acetazolamide bound to human carbonic anhydrase II, PDB 3HS4." : "Vaeroex"
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
  logo: `${PUBLIC_SITE_URL}/brand/vaeroex-logo-white-wordmark.png`,
  description: "Vaeroex builds Drug Discovery Intelligence for compound and evidence review, Executive Intelligence for business operations, and custom software for client workflows.",
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

export const operationsIntelligenceJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Executive Intelligence",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: `${PUBLIC_SITE_URL}/executive-intelligence`,
  publisher: {
    "@type": "Organization",
    name: "Vaeroex",
    url: PUBLIC_SITE_URL
  },
  description: "Executive Intelligence helps restaurants, breweries, retailers, and other businesses explore performance, inspect business evidence, and ask deeper questions with Vaeroex Super Intelligence."
};

export const utilityRobots = { index: false, follow: false } as const;
