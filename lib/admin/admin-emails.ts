function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

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
