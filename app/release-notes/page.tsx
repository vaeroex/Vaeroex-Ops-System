import { ReleaseNotesPage } from "@/components/legal/ReleaseNotesPage";
import { publicPageMetadata, utilityRobots } from "@/lib/seo/public-seo";

export const metadata = {
  ...publicPageMetadata({
    title: "Executive Intelligence Release Notes | Vaeroex",
    description: "Product and security updates for existing Executive Intelligence customers.",
    path: "/release-notes",
  }),
  robots: utilityRobots,
};

export default function PublicReleaseNotesPage() {
  return <ReleaseNotesPage />;
}
