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
      siteName: "Vaeroex",
      type: "website",
      images: [
        {
          url: `${PUBLIC_SITE_URL}/brand/vaeroex-logo-full.png`,
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
      images: [`${PUBLIC_SITE_URL}/brand/vaeroex-logo-full.png`]
    }
  };
}

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Vaeroex",
  legalName: "Vaeroex LLC",
  url: PUBLIC_SITE_URL,
  logo: `${PUBLIC_SITE_URL}/brand/vaeroex-logo-symbol.png`,
  description: "Vaeroex is an Operations Intelligence Platform that helps organizations transform information into visibility, awareness, prediction, and action.",
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
    name: "Vaeroex",
    url: PUBLIC_SITE_URL
  },
  description: "Operations Intelligence by Vaeroex transforms operational activity into visibility, context, prediction, evidence, and executive recommendations."
};
