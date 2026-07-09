import Link from "next/link";
import type { Route } from "next";
import {
  archiveReadNotificationsAction,
  clearResolvedNotificationsAction,
  markAllNotificationsReadAction,
  openNotificationAction
} from "@/app/app/accountability/actions";
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
type NotificationView = "unread" | "read" | "archived" | "all";
type PriorityGroup = "High" | "Medium" | "Low";

const NOTIFICATION_VIEWS: Array<{ label: string; value: NotificationView }> = [
  { label: "Unread", value: "unread" },
  { label: "Read", value: "read" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" }
];
const PRIORITY_GROUPS: PriorityGroup[] = ["High", "Medium", "Low"];

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function isNotificationView(value: string | undefined): value is NotificationView {
  return NOTIFICATION_VIEWS.some((view) => view.value === value);
}

function viewHref(value: NotificationView): Route {
  return value === "unread" ? "/app/notifications" : (`/app/notifications?view=${value}` as Route);
}

function currentPath(value: NotificationView) {
  return value === "unread" ? "/app/notifications" : `/app/notifications?view=${value}`;
}

function safeActionHref(value: string | null) {
  return value?.startsWith("/app") ? value : "/app";
}

function priorityGroup(value: string | null): PriorityGroup {
  const priority = String(value || "").toLowerCase();

  if (priority === "urgent" || priority === "high") {
    return "High";
  }

  if (priority === "low") {
    return "Low";
  }

  return "Medium";
}

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>;
}

function TabLink({ label, value, active, count }: { label: string; value: NotificationView; active: boolean; count: number }) {
  return (
    <Link
      href={viewHref(value)}
      className={`rounded-lg px-3 py-2 text-sm font-semibold ${
        active ? "bg-vaeroex-blue text-white" : "border border-line bg-slate-50 text-slate-700 hover:border-vaeroex-accent"
      }`}
    >
      {label} <span className={active ? "text-vaeroex-silver" : "text-muted"}>{count}</span>
    </Link>
  );
}

function NotificationCard({ notification, returnPath }: { notification: NotificationRow; returnPath: string }) {
  const isUnread = !notification.read_at;
  const isArchived = Boolean(notification.archived_at);

  return (
    <form action={openNotificationAction}>
      <input type="hidden" name="notification_id" value={notification.id} />
      <input type="hidden" name="return_path" value={returnPath} />
      <input type="hidden" name="action_href" value={safeActionHref(notification.action_href)} />
      <button
        type="submit"
        className={`block w-full rounded-lg border p-4 text-left shadow-panel transition hover:border-vaeroex-accent hover:bg-vaeroex-soft ${
          isUnread ? "border-vaeroex-accent/50 bg-vaeroex-soft" : isArchived ? "border-slate-200 bg-slate-50" : "border-line bg-white"
        }`}
        aria-label={`Open notification: ${notification.title}`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">{notification.title}</h3>
              <StatusBadge value={isArchived ? "Archived" : isUnread ? "Unread" : "Read"} />
              <StatusBadge value={notification.priority} />
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{notification.body || "No message provided."}</p>
            <p className="mt-2 text-xs text-muted">
              {notification.related_module || notification.type} · {formatDate(notification.created_at)}
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
            {notification.action_label || "Open"}
          </span>
        </div>
      </button>
    </form>
  );
}

function NotificationPriorityGroup({
  label,
  notifications,
  returnPath
}: {
  label: PriorityGroup;
  notifications: NotificationRow[];
  returnPath: string;
}) {
  if (!notifications.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{label} priority</h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-muted">{notifications.length}</span>
      </div>
      <div className="space-y-3">
        {notifications.map((notification) => (
          <NotificationCard key={notification.id} notification={notification} returnPath={returnPath} />
        ))}
      </div>
    </section>
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
  const view = isNotificationView(params?.view) ? params.view : "unread";
  const returnPath = currentPath(view);
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
      .is("archived_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(20)
  ]);
  const allNotifications = ((notificationResult.data || []) as NotificationRow[]).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const activeNotifications = allNotifications.filter((notification) => !notification.archived_at);
  const notifications = allNotifications.filter((notification) => {
    if (view === "unread") return !notification.archived_at && !notification.read_at;
    if (view === "read") return !notification.archived_at && Boolean(notification.read_at);
    if (view === "archived") return Boolean(notification.archived_at);
    return true;
  });
  const assignments = ((assignmentResult.data || []) as AssignmentRow[]).filter((assignment) => !["Done", "Dismissed"].includes(assignment.status));
  const unreadCount = activeNotifications.filter((notification) => !notification.read_at).length;
  const readCount = activeNotifications.filter((notification) => notification.read_at).length;
  const archivedCount = allNotifications.filter((notification) => notification.archived_at).length;
  const totalCount = allNotifications.length;
  const tabCounts: Record<NotificationView, number> = {
    unread: unreadCount,
    read: readCount,
    archived: archivedCount,
    all: totalCount
  };
  const groupedNotifications = PRIORITY_GROUPS.map((group) => ({
    label: group,
    notifications: notifications.filter((notification) => priorityGroup(notification.priority) === group)
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notifications"
        title="Notification Center"
        description="Review shared reports, KPI alerts, file analysis updates, Business Signals, and Vaeroex recommendations."
      />

      <ErrorNotice message={params?.error || notificationResult.error?.message || assignmentResult.error?.message} />
      <SuccessNotice message={params?.message} />

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Unread</p>
          <p className="mt-2 text-3xl font-semibold">{unreadCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Open assignments</p>
          <p className="mt-2 text-3xl font-semibold">{assignments.length}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Archived</p>
          <p className="mt-2 text-3xl font-semibold">{archivedCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Total notifications</p>
          <p className="mt-2 text-3xl font-semibold">{totalCount}</p>
        </article>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 shadow-panel">
        <div className="flex flex-wrap gap-2">
          {NOTIFICATION_VIEWS.map((tab) => (
            <TabLink key={tab.value} label={tab.label} value={tab.value} active={view === tab.value} count={tabCounts[tab.value]} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={markAllNotificationsReadAction}>
            <input type="hidden" name="return_path" value={returnPath} />
            <ConfirmSubmitButton message="Mark all unread notifications read?">Mark All Read</ConfirmSubmitButton>
          </form>
          <form action={archiveReadNotificationsAction}>
            <input type="hidden" name="return_path" value={returnPath} />
            <ConfirmSubmitButton message="Archive all read notifications?">Archive Read</ConfirmSubmitButton>
          </form>
          <form action={clearResolvedNotificationsAction}>
            <input type="hidden" name="return_path" value={returnPath} />
            <ConfirmSubmitButton message="Clear read and archived notifications from this history view?">Clear Resolved</ConfirmSubmitButton>
          </form>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <SectionCard title="Notifications" description="In-app notifications only. Vaeroex does not send email from this center yet.">
          {notifications.length ? (
            <div className="space-y-6">
              {groupedNotifications.map((group) => (
                <NotificationPriorityGroup
                  key={group.label}
                  label={group.label}
                  notifications={group.notifications}
                  returnPath={returnPath}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title={view === "unread" ? "No unread notifications" : "No notifications"}
              description={
                view === "unread"
                  ? "You are caught up. Read and archived history is still available in the other tabs."
                  : "Shared reports, KPI alerts, Business Signals, file analysis, and Vaeroex recommendations will appear here."
              }
            />
          )}
        </SectionCard>

        <SectionCard title="Workspace signals" description="Business Signals and shared-review signals from reports, KPI alerts, checklists, and Vaeroex recommendations.">
          {assignments.length ? (
            <div className="space-y-2">
              {assignments.slice(0, 12).map((assignment) => (
                <AssignmentRowItem key={assignment.id} assignment={assignment} />
              ))}
            </div>
          ) : (
            <EmptyState title="No workspace signals" description="Shared review signals from modules and Vaeroex recommendations will appear here." />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
