import { ReleaseNotesPage } from "@/components/legal/ReleaseNotesPage";

import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata = publicPageMetadata({
  title: "Executive Intelligence Release Notes | Vaeroex",
  description: "Read published updates to the Executive Intelligence business workspace, including product features, improvements, and security.",
  path: "/release-notes",
});

export default function PublicReleaseNotesPage() {
  return <ReleaseNotesPage />;
}
