import response from "./vsi-response.json";
import { WORKSPACE_ID } from "./data";
import type { VsiChat, VsiExchange } from "@/components/vsi/contracts";

// A recorded, unedited real engine result against the isolated local dataset.
// Display-only adapter: no provider credentials, generation, writes, or live API.
export const vsiChat: VsiChat = {
  id: "coastal-kitchen-campaign",
  title: response.question.slice(0, 80),
  exchangeCount: 1,
  createdAt: response.createdAt,
  updatedAt: response.createdAt,
};
export const vsiExchange: VsiExchange = {
  id: "coastal-kitchen-campaign-answer",
  userMessage: response.question,
  answer: response.answer,
  citations: response.citations,
  createdAt: response.createdAt,
};
export function vsiReadResponse(url: URL, method = "GET") {
  if (method !== "GET" || url.searchParams.get("workspaceId") !== WORKSPACE_ID) throw new Error("Capture allows only the recorded workspace's read requests");
  if (url.pathname === "/api/vsi/conversations") return { workspaceId: WORKSPACE_ID, conversations: [vsiChat], canEditBusinessNotes: true, nextCursor: null };
  if (url.pathname === `/api/vsi/conversations/${vsiChat.id}`) return { workspaceId: WORKSPACE_ID, conversation: vsiChat, exchanges: [vsiExchange], canEditBusinessNotes: true };
  throw new Error("This VSI capture is read-only; no live action was performed");
}
