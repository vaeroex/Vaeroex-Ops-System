import Link from "next/link";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AuthShell } from "@/components/auth/AuthShell";
import { forgotPasswordAction } from "@/lib/auth/actions";

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Reset password"
      subtitle="Send password reset instructions for your Vaeroex account."
    >
      <form action={forgotPasswordAction} className="space-y-4">
        <AuthMessage error={params?.error} message={params?.message} />
        <label className="block text-sm font-medium">
          Email
          <input
            required
            name="email"
            type="email"
            autoComplete="email"
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
        </label>
        <button className="w-full rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white">
          Send reset instructions
        </button>
      </form>
      <p className="mt-5 text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="text-vaeroex-blue">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
