import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Page not found | Vaeroex",
  robots: { index: false, follow: false },
};

export default function UnavailableProductPage() {
  notFound();
}
