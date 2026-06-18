"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { getAppUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function isEmail(valueToCheck: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueToCheck);
}

function authRedirect(path: string, type: "message" | "error", text: string): never {
  redirect(`${path}?${type}=${encodeURIComponent(text)}` as Route);
}

export async function signInAction(formData: FormData) {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    authRedirect("/login", "error", "Supabase is not configured yet. Add your environment variables first.");
  }

  if (!email || !password) {
    authRedirect("/login", "error", "Enter your email and password.");
  }

  if (!isEmail(email)) {
    authRedirect("/login", "error", "Enter a valid email address.");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    authRedirect("/login", "error", error.message);
  }

  await supabase.rpc("accept_workspace_invites_for_current_user");

  redirect("/app");
}

export async function signUpAction(formData: FormData) {
  const fullName = value(formData, "full_name");
  const email = value(formData, "email");
  const password = value(formData, "password");
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    authRedirect("/signup", "error", "Supabase is not configured yet. Add your environment variables first.");
  }

  if (!fullName || !email || !password) {
    authRedirect("/signup", "error", "Enter your name, email, and password.");
  }

  if (!isEmail(email)) {
    authRedirect("/signup", "error", "Enter a valid email address.");
  }

  if (password.length < 8) {
    authRedirect("/signup", "error", "Use at least 8 characters for the password.");
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName
      },
      emailRedirectTo: `${getAppUrl()}/auth/callback?next=/app/setup`
    }
  });

  if (error) {
    authRedirect("/signup", "error", error.message);
  }

  authRedirect(
    "/login",
    "message",
    "Account created. Check your email if confirmation is enabled, then continue to setup."
  );
}

export async function forgotPasswordAction(formData: FormData) {
  const email = value(formData, "email");
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    authRedirect("/forgot-password", "error", "Supabase is not configured yet. Add your environment variables first.");
  }

  if (!email) {
    authRedirect("/forgot-password", "error", "Enter your email address.");
  }

  if (!isEmail(email)) {
    authRedirect("/forgot-password", "error", "Enter a valid email address.");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppUrl()}/auth/callback?next=/app`
  });

  if (error) {
    authRedirect("/forgot-password", "error", error.message);
  }

  authRedirect("/forgot-password", "message", "Password reset instructions sent.");
}

export async function acceptInviteAction(formData: FormData) {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const inviteEmail = value(formData, "invited_email") || email;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    authRedirect("/accept-invite", "error", "Supabase is not configured yet. Add your environment variables first.");
  }

  if (!email || !password) {
    authRedirect("/accept-invite", "error", "Enter the invited email and a password.");
  }

  if (!isEmail(email)) {
    authRedirect("/accept-invite", "error", "Enter a valid email address.");
  }

  if (password.length < 8) {
    authRedirect("/accept-invite", "error", "Use at least 8 characters for the password.");
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: inviteEmail,
        invited_email: inviteEmail
      },
      emailRedirectTo: `${getAppUrl()}/auth/callback?next=/app`
    }
  });

  if (error) {
    authRedirect("/accept-invite", "error", error.message);
  }

  authRedirect("/login", "message", "Invite accepted. Sign in to continue.");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/login");
}
