import Link from "next/link";
import type { Route } from "next";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/app/accountability/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type NotificationsPageProps = {
  searchParams?: Promise<{ error?: string; message?: string; view?: string }>;
};
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["operational_assignments"]["Row"];

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function safeHref(value: string | null): Route {
  return value?.startsWith("/app") ? (value as Route) : "/app";
}

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>;
}

function NotificationCard({ notification }: { notification: NotificationRow }) {
  const isUnread = !notification.read_at;

  return (
    <article className={`rounded-lg border p-4 shadow-panel ${isUnread ? "border-blue-200 bg-blue-50/70" : "border-line bg-white"}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{notification.title}</h3>
            {isUnread ? <StatusBadge value="Unread" /> : <StatusBadge value="Read" />}
            <StatusBadge value={notification.priority} />
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">{notification.body || "No message provided."}</p>
          <p className="mt-2 text-xs text-muted">
            {notification.related_module || notification.type} · {formatDate(notification.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={safeHref(notification.action_href)} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
            {notification.action_label || "Open"}
          </Link>
          {isUnread ? (
            <form action={markNotificationReadAction}>
              <input type="hidden" name="notification_id" value={notification.id} />
              <input type="hidden" name="return_path" value="/app/notifications" />
              <button className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">Mark read</button>
            </form>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function AssignmentRowItem({ assignment }: { assignment: AssignmentRow }) {
  const owner = assignment.assigned_role || assignment.assigned_department || "Workspace";

  return (
    <div className="grid gap-2 rounded-lg border border-line bg-white p-3 text-sm md:grid-cols-[1fr_auto_auto]">
      <div>
        <p className="font-semibold text-ink">{assignment.title}</p>
        <p className="mt-1 text-xs text-muted">{assignment.source_title || assignment.source_type}</p>
      </div>
      <span className="text-muted">{owner}</span>
      <StatusBadge value={assignment.status} />
    </div>
  );
}

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const view = params?.view || "all";
  const [notificationResult, assignmentResult] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("operational_assignments")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(20)
  ]);
  const notifications = ((notificationResult.data || []) as NotificationRow[]).filter((notification) => {
    if (view === "unread") return !notification.read_at;
    if (view === "read") return Boolean(notification.read_at);
    return true;
  });
  const assignments = ((assignmentResult.data || []) as AssignmentRow[]).filter((assignment) => !["Done", "Dismissed"].includes(assignment.status));
  const unreadCount = ((notificationResult.data || []) as NotificationRow[]).filter((notification) => !notification.read_at).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notifications"
        title="Notification Center"
        description="Review shared reports, KPI alerts, assigned work, checklist misses, file analysis updates, and Vaeroex recommendations."
      />

      <ErrorNotice message={params?.error || notificationResult.error?.message || assignmentResult.error?.message} />
      <SuccessNotice message={params?.message} />

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Unread</p>
          <p className="mt-2 text-3xl font-semibold">{unreadCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Open assignments</p>
          <p className="mt-2 text-3xl font-semibold">{assignments.length}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Total notifications</p>
          <p className="mt-2 text-3xl font-semibold">{notificationResult.data?.length || 0}</p>
        </article>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 shadow-panel">
        <div className="flex flex-wrap gap-2">
          <Link href="/app/notifications" className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === "all" ? "bg-vaeroex-blue text-white" : "border border-line bg-slate-50"}`}>
            All
          </Link>
          <Link href="/app/notifications?view=unread" className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === "unread" ? "bg-vaeroex-blue text-white" : "border border-line bg-slate-50"}`}>
            Unread
          </Link>
          <Link href="/app/notifications?view=read" className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === "read" ? "bg-vaeroex-blue text-white" : "border border-line bg-slate-50"}`}>
            Read
          </Link>
        </div>
        <form action={markAllNotificationsReadAction}>
          <input type="hidden" name="return_path" value="/app/notifications" />
          <ConfirmSubmitButton message="Mark all notifications read?">Mark all read</ConfirmSubmitButton>
        </form>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <SectionCard title="Notifications" description="In-app notifications only. Vaeroex does not send email from this center yet.">
          {notifications.length ? (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <NotificationCard key={notification.id} notification={notification} />
              ))}
            </div>
          ) : (
            <EmptyState title="No notifications" description="Shared reports, KPI alerts, assignments, file analysis, and Vaeroex recommendations will appear here." />
          )}
        </SectionCard>

        <SectionCard title="Open assignments" description="Assigned follow-up work from tasks, issues, reports, KPI alerts, checklists, and Vaeroex recommendations.">
          {assignments.length ? (
            <div className="space-y-2">
              {assignments.slice(0, 12).map((assignment) => (
                <AssignmentRowItem key={assignment.id} assignment={assignment} />
              ))}
            </div>
          ) : (
            <EmptyState title="No open assignments" description="Assignments created from modules and Vaeroex recommendations will appear here." />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
