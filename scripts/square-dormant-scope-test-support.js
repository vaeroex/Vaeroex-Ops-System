// Exact additive database qualification scope. Legacy parser suites still reject
// every other database/runtime path; no directory-wide exemption is permitted.
const approvedSquareQualificationPaths = Object.freeze([
  "supabase/migrations/20260907042202_square_dormant_trusted_authority.sql",
  "supabase/migrations/20260907042352_square_dormant_atomic_pages.sql",
  "supabase/tests/fixtures/square-durable-platform.sql",
  "supabase/tests/fixtures/square-durable-process.js",
  "supabase/tests/fixtures/square-durable-upgrade-history.sql"
]);
const approved = new Set(approvedSquareQualificationPaths);
function withoutSquareQualificationPaths(changedFiles) {
  return changedFiles.split("\n").filter(file => !approved.has(file)).join("\n");
}
module.exports = { approvedSquareQualificationPaths, withoutSquareQualificationPaths };
