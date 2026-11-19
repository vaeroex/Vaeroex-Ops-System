import { postImportRecurringSettings } from "@/lib/integrations/import-refresh/settings-post";

export async function POST(request: Request) { return postImportRecurringSettings(request, "loyverse"); }
