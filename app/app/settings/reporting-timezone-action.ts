"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

export type ReportingTimezoneState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const inputSchema = z.object({
  expectedWorkspaceId: z.string().uuid(),
  reportingTimezone: z.string().max(64)
});

export async function saveReportingTimezoneAction(
  _previous: ReportingTimezoneState,
  formData: FormData
): Promise<ReportingTimezoneState> {
  const { supabase, user, workspaceId, membership } = await requireWorkspaceAccess();
  if (membership.role !== "owner" || membership.status !== "active"
    || membership.workspace_id !== workspaceId || membership.user_id !== user.id) {
    return { status: "error", message: "Only the workspace owner can change the reporting timezone." };
  }

  const parsed = inputSchema.safeParse({
    expectedWorkspaceId: formData.get("expectedWorkspaceId"),
    reportingTimezone: formData.get("reportingTimezone")
  });
  if (!parsed.success || formData.getAll("expectedWorkspaceId").length !== 1
    || formData.getAll("reportingTimezone").length !== 1) {
    return { status: "error", message: "Choose a valid reporting timezone and try again." };
  }
  if (parsed.data.expectedWorkspaceId !== workspaceId) {
    return { status: "error", message: "Your active workspace changed. Reload Settings before saving." };
  }

  const reportingTimezone = parsed.data.reportingTimezone || null;
  if (reportingTimezone !== null) {
    if (reportingTimezone !== reportingTimezone.trim()
      || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(reportingTimezone)) {
      return { status: "error", message: "Choose a valid reporting timezone and try again." };
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: reportingTimezone }).format(0);
    } catch {
      return { status: "error", message: "Choose a recognized reporting timezone and try again." };
    }
  }

  try {
    const { data, error } = await supabase.from("workspaces")
      .update({ reporting_timezone: reportingTimezone })
      .eq("id", workspaceId)
      .select("id, reporting_timezone")
      .single();
    if (error || !data || data.id !== workspaceId || data.reporting_timezone !== reportingTimezone) {
      return { status: "error", message: "The reporting timezone could not be saved. Try again." };
    }
  } catch {
    return { status: "error", message: "The reporting timezone could not be saved. Try again." };
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/intelligence");
  return { status: "success", message: reportingTimezone
    ? `Reporting timezone saved: ${reportingTimezone}.`
    : "Reporting timezone cleared. Refresh timestamps use UTC until configured." };
}
