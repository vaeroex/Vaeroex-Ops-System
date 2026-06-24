import Link from "next/link";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AuthShell } from "@/components/auth/AuthShell";
import { resetPasswordAction } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const canResetPassword = Boolean(user);

  return (
    <AuthShell
      title="Set a new password."
      subtitle="Create a new password for your Vaeroex account."
    >
      <div className="space-y-4">
        <AuthMessage
          error={
            params?.error ||
            (!canResetPassword
              ? "Your reset link is expired or invalid. Request a new password reset email."
              : undefined)
          }
          message={params?.message}
        />

        {canResetPassword ? (
          <form action={resetPasswordAction} className="space-y-4">
            <label className="block text-sm font-medium">
              New password
              <input
                required
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
              />
            </label>
            <label className="block text-sm font-medium">
              Confirm password
              <input
                required
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
              />
            </label>
            <p className="text-xs leading-5 text-muted">
              Use at least 8 characters. After the update, Vaeroex will send you back to login.
            </p>
            <button className="w-full rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white">
              Update password
            </button>
          </form>
        ) : (
          <Link
            href="/forgot-password"
            className="inline-flex w-full justify-center rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white"
          >
            Request a new reset link
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
