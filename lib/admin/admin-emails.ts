function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

type VaeroexAdminUser = {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

export function getVaeroexAdminEmails() {
  return String(process.env.VAEROEX_ADMIN_EMAILS || "")
    .split(/[,;\n]/)
    .map(normalizeEmail)
    .filter(Boolean);
}

export function isVaeroexAdminEmail(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);

  return Boolean(normalizedEmail && getVaeroexAdminEmails().includes(normalizedEmail));
}

export function isVaeroexAdminUser(user?: VaeroexAdminUser | null) {
  const metadata = user?.app_metadata || {};

  return isVaeroexAdminEmail(user?.email) || metadata.vaeroex_admin === true;
}
