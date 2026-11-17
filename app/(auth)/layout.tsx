import type { ReactNode } from "react";
import { utilityRobots } from "@/lib/seo/public-seo";
export const metadata = { robots: utilityRobots };
export default function UtilityLayout({ children }: { children: ReactNode }) { return children; }
