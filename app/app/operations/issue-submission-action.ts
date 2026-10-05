"use server";
import { createIssueAction } from "./actions";

export async function submitIssue(_previous: null, data: FormData) {
  await createIssueAction(data);
  return null;
}
