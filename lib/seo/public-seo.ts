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
      siteName: "Vaeroex Intelligence Systems",
      type: "website",
      images: [
        {
          url: `${PUBLIC_SITE_URL}/brand/vaeroex-logo.png`,
          width: 1200,
          height: 630,
          alt: "Vaeroex"
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${PUBLIC_SITE_URL}/brand/vaeroex-logo.png`]
    }
  };
}

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Vaeroex Intelligence Systems",
  legalName: "Vaeroex LLC",
  url: PUBLIC_SITE_URL,
  logo: `${PUBLIC_SITE_URL}/brand/vaeroex-logo.png`,
  description: "Vaeroex Intelligence Systems develops evidence-backed intelligence software that turns fragmented information into decision-ready understanding for leadership.",
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
  name: "Operations Intelligence",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: `${PUBLIC_SITE_URL}/operations-intelligence`,
  publisher: {
    "@type": "Organization",
    name: "Vaeroex Intelligence Systems",
    url: PUBLIC_SITE_URL
  },
  description: "Operations Intelligence by Vaeroex turns business evidence into executive understanding, prioritized findings, KPI context, Business Memory, and Reports."
};
