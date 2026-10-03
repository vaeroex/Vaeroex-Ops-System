/** Accept public project keys only. This checks configuration, not authority. */
export function publicKey(value: string | undefined) {
  if (!value || value.length > 2048) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  try {
    const parts = value.split('.');
    if (parts.length !== 3) return false;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims.role === 'anon' && claims.ref === 'oysjpoondtcrqpghhrbd' && claims.iss === 'supabase';
  } catch { return false; }
}
