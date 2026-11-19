import { permanentRedirect } from "next/navigation";

export default function CustomBusinessSystemsPage() {
  permanentRedirect("/contact?inquiry=custom-software");
}
