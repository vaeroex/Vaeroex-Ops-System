"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { resolveAuthCaptchaSubmission } from "@/lib/auth/captcha";
import { safeAuthRedirectPath } from "@/lib/auth/safe-redirect";
import { getAppUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function isEmail(valueToCheck: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueToCheck);
}

function authRedirect(path: string, type: "message" | "error", text: string, next?: string): never {
  const params = new URLSearchParams({ [type]: text });
  if (next) params.set("next", next);
  redirect(`${path}?${params.toString()}` as Route);
}

function authCaptchaToken(formData: FormData, errorPath: string, next?: string): string | undefined {
  const captcha = resolveAuthCaptchaSubmission(formData);

  if (!captcha.enabled) {
    return undefined;
  }

  if (!captcha.token) {
    authRedirect(errorPath, "error", "Complete the security check and try again.", next);
  }

  return captcha.token;
}

function validatePasswordUpdate(password: string, confirmPassword: string, errorPath: string) {
  if (!password || !confirmPassword) {
    authRedirect(errorPath, "error", "Enter and confirm your new password.");
  }

  if (password.length < 8) {
    authRedirect(errorPath, "error", "Use at least 8 characters for the new password.");
  }

  if (password !== confirmPassword) {
    authRedirect(errorPath, "error", "The passwords do not match.");
  }
}

async function updateCurrentUserPassword({
  formData,
  errorPath,
  successPath,
  successMessage,
  missingSessionMessage
}: {
  formData: FormData;
  errorPath: string;
  successPath: string;
  successMessage: string;
  missingSessionMessage: string;
}) {
  const password = value(formData, "password");
  const confirmPassword = value(formData, "confirm_password");
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    authRedirect(errorPath, "error", "Password management is not configured yet.");
  }

  validatePasswordUpdate(password, confirmPassword, errorPath);

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    authRedirect(errorPath, "error", missingSessionMessage);
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    authRedirect(errorPath, "error", "Vaeroex could not update your password. Request a new reset link and try again.");
  }

  authRedirect(successPath, "message", successMessage);
}

export async function signInAction(formData: FormData) {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const next = safeAuthRedirectPath(value(formData, "next"));
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    authRedirect("/login", "error", "Supabase is not configured yet. Add your environment variables first.", next);
  }

  if (!email || !password) {
    authRedirect("/login", "error", "Enter your email and password.", next);
  }

  if (!isEmail(email)) {
    authRedirect("/login", "error", "Enter a valid email address.", next);
  }

  const captchaToken = authCaptchaToken(formData, "/login", next);
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken }
  });

  if (error) {
    authRedirect("/login", "error", error.message, next);
  }

  await supabase.rpc("accept_workspace_invites_for_current_user");

  redirect(next as Route);
}

export async function signUpAction(formData: FormData) {
  const fullName = value(formData, "full_name");
  const email = value(formData, "email");
  const password = value(formData, "password");
  const next = safeAuthRedirectPath(value(formData, "next"));
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    authRedirect("/signup", "error", "Supabase is not configured yet. Add your environment variables first.", next);
  }

  if (!fullName || !email || !password) {
    authRedirect("/signup", "error", "Enter your name, email, and password.", next);
  }

  if (!isEmail(email)) {
    authRedirect("/signup", "error", "Enter a valid email address.", next);
  }

  if (password.length < 8) {
    authRedirect("/signup", "error", "Use at least 8 characters for the password.", next);
  }

  const captchaToken = authCaptchaToken(formData, "/signup", next);
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName
      },
      captchaToken,
      emailRedirectTo: `${getAppUrl()}/auth/callback?next=${encodeURIComponent(next)}`
    }
  });

  if (error) {
    authRedirect("/signup", "error", error.message, next);
  }

  authRedirect(
    "/login",
    "message",
    "Account created. Check your email if confirmation is enabled, then continue.",
    next
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

  const captchaToken = authCaptchaToken(formData, "/forgot-password");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    captchaToken,
    redirectTo: `${getAppUrl()}/auth/callback?next=/reset-password`
  });

  if (error) {
    authRedirect("/forgot-password", "error", "Password reset instructions could not be sent. Check the email address and try again.");
  }

  authRedirect("/forgot-password", "message", "Password reset instructions sent.");
}

export async function resetPasswordAction(formData: FormData) {
  await updateCurrentUserPassword({
    formData,
    errorPath: "/reset-password",
    successPath: "/login",
    successMessage: "Password updated. Sign in with your new password.",
    missingSessionMessage: "Your reset link is expired or invalid. Request a new password reset email."
  });
}

export async function changePasswordAction(formData: FormData) {
  await updateCurrentUserPassword({
    formData,
    errorPath: "/app/settings",
    successPath: "/app/settings",
    successMessage: "Password updated.",
    missingSessionMessage: "Your session expired. Sign in again before changing your password."
  });
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

  const captchaToken = authCaptchaToken(formData, "/accept-invite");
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: inviteEmail,
        invited_email: inviteEmail
      },
      captchaToken,
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
