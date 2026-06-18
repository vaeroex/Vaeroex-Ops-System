import Link from "next/link";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AuthShell } from "@/components/auth/AuthShell";
import { acceptInviteAction } from "@/lib/auth/actions";

type AcceptInvitePageProps = {
  searchParams?: Promise<{
    email?: string;
    error?: string;
    message?: string;
  }>;
};

export default async function AcceptInvitePage({ searchParams }: AcceptInvitePageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Accept invite"
      subtitle="Create your account with the invited email so your workspace role can be activated."
    >
      <form action={acceptInviteAction} className="space-y-4">
        <AuthMessage error={params?.error} message={params?.message} />
        <input type="hidden" name="invited_email" value={params?.email || ""} />
        <label className="block text-sm font-medium">
          Invited email
          <input
            required
            defaultValue={params?.email}
            name="email"
            type="email"
            autoComplete="email"
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            required
            minLength={8}
            name="password"
            type="password"
            autoComplete="new-password"
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
        </label>
        <button className="w-full rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white">
          Accept invite
        </button>
      </form>
      <p className="mt-5 text-sm text-muted">
        Already accepted?{" "}
        <Link href="/login" className="text-vaeroex-blue">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
