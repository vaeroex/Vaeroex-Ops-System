import Link from "next/link";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AuthShell } from "@/components/auth/AuthShell";
import { signInAction } from "@/lib/auth/actions";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Access your Vaeroex workspace."
      subtitle="Log in to continue working inside Vaeroex."
    >
      <form action={signInAction} className="space-y-4">
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
        <label className="block text-sm font-medium">
          Password
          <input
            required
            name="password"
            type="password"
            autoComplete="current-password"
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
        </label>
        <button className="w-full rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white">
          Log in
        </button>
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm text-muted">
        <Link href="/forgot-password" className="text-vaeroex-blue">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-vaeroex-blue">
          Create account
        </Link>
      </div>
    </AuthShell>
  );
}
