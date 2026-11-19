import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

const contentId = "vaeroex-wordmark";

export const emailBrandImage = `<img src="cid:${contentId}" alt="Vaeroex" width="152" style="display:block;width:152px;max-width:100%;height:auto;border:0;color:#62d8ef;" />`;

export async function emailBrandAttachment() {
  const content = await readFile(path.join(process.cwd(), "public/brand/official/wordmark.png"), "base64");
  return { content, filename: "vaeroex-wordmark.png", content_type: "image/png", content_id: contentId };
}
