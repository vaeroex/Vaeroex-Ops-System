import Link from "next/link";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AuthShell } from "@/components/auth/AuthShell";
import { signUpAction } from "@/lib/auth/actions";

type SignupPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Get Started With Vaeroex"
      subtitle="Create your workspace and access Operations Intelligence."
    >
      <form action={signUpAction} className="space-y-4">
        <AuthMessage error={params?.error} message={params?.message} />
        <label className="block text-sm font-medium">
          Full name
          <input
            required
            name="full_name"
            autoComplete="name"
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
        </label>
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
            minLength={8}
            name="password"
            type="password"
            autoComplete="new-password"
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
        </label>
        <button className="w-full rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white">
          Create account
        </button>
      </form>
      <p className="mt-5 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-vaeroex-blue">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
