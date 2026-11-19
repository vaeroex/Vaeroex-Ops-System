import { permanentRedirect } from "next/navigation";
import { discoveryDemo } from "@/lib/marketing/discovery-evidence";

export default async function LegacyCompoundDemo({
  searchParams,
}: {
  searchParams: Promise<{ compound?: string | string[] }>;
}) {
  const { compound } = await searchParams;
  permanentRedirect(compound === "dorzolamide"
    ? "/drug-discovery-intelligence?compound=dorzolamide#compound-explorer"
    : discoveryDemo);
}
