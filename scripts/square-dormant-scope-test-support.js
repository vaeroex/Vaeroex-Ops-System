// Exact additive dormant qualification/connection scope. Legacy parser suites still reject
// every other database/runtime path; no directory-wide exemption is permitted.
const approvedSquareQualificationPaths = Object.freeze([
  "supabase/migrations/20260907042202_square_dormant_trusted_authority.sql",
  "supabase/migrations/20260907042352_square_dormant_atomic_pages.sql",
  "supabase/migrations/20260907174326_square_dormant_account_connection.sql",
  "supabase/migrations/20260907225626_square_remote_sandbox_binding.sql",
  "supabase/tests/fixtures/square-durable-platform.sql",
  "supabase/tests/fixtures/square-durable-process.js",
  "supabase/tests/fixtures/square-durable-upgrade-history.sql",
  "app/(square-connection)/app/settings/integrations/square/page.tsx",
  "app/api/integrations/square/connect/route.ts",
  "app/api/integrations/square/callback/route.ts",
  "app/api/integrations/square/mapping/route.ts",
  "app/api/integrations/square/status/route.ts",
  "app/api/integrations/square/reauthorize/route.ts",
  "app/api/integrations/square/disconnect/route.ts",
  "app/api/integrations/square/webhook/route.ts",
  "components/integrations/SquareConnectionPanel.tsx",
  "vercel.json"
]);
const approved = new Set(approvedSquareQualificationPaths);
function withoutSquareQualificationPaths(changedFiles) {
  return changedFiles.split("\n").filter(file => !approved.has(file)).join("\n");
}
module.exports = { approvedSquareQualificationPaths, withoutSquareQualificationPaths };
