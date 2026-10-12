import type { UploadSourceState } from "@/lib/files/upload-types";
import { MAX_UPLOAD_BYTES } from "@/lib/storage-capacity/policy";

type UploadReservation = { reservationId: string; fileId: string; signedUrl: string; mimeType: string };
const uncertain = "The upload result could not be confirmed. Your file and details remain here. Check saved sources before another upload.";

async function errorMessage(response: Response, fallback: string) {
  try {
    const result: { error?: unknown } = await response.json();
    return typeof result.error === "string" ? result.error : fallback;
  } catch { return fallback; }
}

/** Binary bytes travel directly to private object storage, never a server action. */
export async function uploadSourceDirect(workspaceId: string, formData: FormData,
  prepare: (previous: UploadSourceState, metadata: FormData) => Promise<UploadSourceState>): Promise<UploadSourceState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Choose a file of 25 MiB (26,214,400 bytes) or smaller." };
  const displayName = String(formData.get("display_name") ?? "").trim();
  const folderId = String(formData.get("folder_id") ?? "").trim() || null;
  let fileId: string;
  try {
    const reserved = await fetch("/api/storage-capacity/reserve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, requestId: crypto.randomUUID(), originalName: file.name, displayName,
        bytes: file.size, mimeType: file.type, folderId, allowDuplicate: formData.get("allow_duplicate") === "on" }),
    });
    if (!reserved.ok) return { error: await errorMessage(reserved, "The upload could not be reserved. Review Usage & Storage and try again.") };
    const reservation: UploadReservation = await reserved.json();
    const destination = new URL(reservation.signedUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname);
    if ((destination.protocol !== "https:" && !(local && destination.protocol === "http:"))
      || !decodeURIComponent(destination.pathname).startsWith(`/storage/v1/object/upload/sign/workspace-files/${workspaceId}/`)
      || !reservation.reservationId || !reservation.fileId) return { error: "The private upload destination could not be verified. Reload before trying again.", blocked: true };

    const uploaded = await fetch(destination.href, { method: "PUT", headers: { "Content-Type": reservation.mimeType, "x-upsert": "false", "Cache-Control": "max-age=3600" }, body: file });
    if (!uploaded.ok) return { error: "The upload could not be confirmed by private storage. Check saved sources before another upload. Reserved capacity will be reconciled automatically.", blocked: true };
    const completed = await fetch("/api/storage-capacity/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, reservationId: reservation.reservationId }),
    });
    if (!completed.ok) return { error: await errorMessage(completed, uncertain), blocked: true };
    const result: { fileId?: string } = await completed.json();
    if (result.fileId !== reservation.fileId) return { error: uncertain, blocked: true };
    fileId = reservation.fileId;
  } catch { return { error: uncertain, blocked: true }; }

  const metadata = new FormData();
  metadata.set("file_id", fileId);
  metadata.set("expectedWorkspaceId", workspaceId);
  // Preserve Next navigation errors from the metadata-only preparation action.
  // The caller keeps unknown outcomes blocked instead of uploading a second copy.
  return prepare({ error: null }, metadata);
}
