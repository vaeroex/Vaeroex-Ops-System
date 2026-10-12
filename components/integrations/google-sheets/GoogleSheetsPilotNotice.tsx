import Link from "next/link";
import { GOOGLE_SHEETS_PILOT } from "@/lib/integrations/google-sheets/availability";

export function GoogleSheetsPilotNotice({ className = "", showReconnect = false }: {
  className?: string;
  showReconnect?: boolean;
}) {
  return <aside aria-label="Google Sheets availability" data-google-sheets-pilot className={`text-sm leading-6 ${className}`}>
    <p><strong>{GOOGLE_SHEETS_PILOT.title}.</strong> {GOOGLE_SHEETS_PILOT.eligibility}</p>
    {showReconnect ? <p className="mt-1">{GOOGLE_SHEETS_PILOT.reconnect}</p> : null}
    <p className="mt-1"><Link href="/app/sources" prefetch={false} className="font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Upload supported spreadsheet files in Files &amp; Notes</Link> instead.</p>
  </aside>;
}
