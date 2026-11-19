import Link from "next/link";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthTurnstile } from "@/components/auth/AuthTurnstile";
import { signInAction } from "@/lib/auth/actions";
import { getAuthCaptchaSiteKey } from "@/lib/auth/captcha";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Executive Intelligence sign in"
      subtitle="Sign in to your business workspace and connected systems."
    >
      <form action={signInAction} className="space-y-4">
        <AuthMessage error={params?.error} message={params?.message} />
        <input type="hidden" name="next" value={params?.next || "/systems"} />
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
        <AuthTurnstile siteKey={getAuthCaptchaSiteKey()} />
        <button className="w-full rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white">
          Log in
        </button>
      </form>
      <Link href="/drug-discovery-intelligence" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue">Looking for Drug Discovery Intelligence?</Link>
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm text-muted">
        <Link href="/forgot-password" className="text-vaeroex-blue">
          Forgot password?
        </Link>
        <Link href={`/signup?next=${encodeURIComponent(params?.next || "/systems")}`} className="text-vaeroex-blue">
          Create account
        </Link>
      </div>
    </AuthShell>
  );
}
