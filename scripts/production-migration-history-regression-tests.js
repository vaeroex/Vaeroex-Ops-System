const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const migrationsDirectory = path.join(root, "supabase/migrations");
const reconciliation = fs.readFileSync(path.join(root, "docs/production-migration-history-reconciliation.md"), "utf8");

const expected = new Map([
  [
    "20260618025749_fix_workspace_setup_rls.sql",
    {
      raw: "acac92fa4f16fad3ed4e8a4c21e092b178fdd8b69cdc0c9f5ab2e1da1b1ef4fa",
      normalized: "f0921c7b0b83be1acba50ed78f6cbfe072780300cffd21ea7ab7897cb814ee35"
    }
  ],
  [
    "20260713204716_restrict_lifecycle_rpc_to_authenticated.sql",
    {
      raw: "f12707c2c81db0085abdd165e775edb404bae8a879f33df82e16f329535a5b96",
      normalized: "365902b81e16ddf663b3e42bd23cde15cb5ea47d2731d0f4a642108637e92064"
    }
  ],
  [
    "20260726042242_business_notes_least_privilege.sql",
    {
      raw: "adb6b91104257f3326d8008a7a81b4d2219818d2c1492ee107ad9d9a8f3a78ca",
      normalized: "e539dd877fee7deb2eb0e75872acb1f85c815ff91abe0fc19b1fd2afe562d166"
    }
  ],
  [
    "20260727013628_workspace_agreement_admin_email_delivery_least_privilege.sql",
    {
      raw: "a8017ecda61f7f4bc2fbeef20f1f2ba43c7ff271dff964a76fe0db51e6c327ac",
      normalized: "9eb2fcfa35043f37072b0644a696cff6a782f69647d6eef3c85ff91fd96d44ed"
    }
  ]
]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.replace(/\r\n/g, "\n").trim().replace(/\s+/g, " ");
const migrationNames = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"));

for (const [name, hashes] of expected) {
  const version = name.split("_")[0];
  const matchingVersion = migrationNames.filter((candidate) => candidate.startsWith(`${version}_`));
  assert.deepEqual(matchingVersion, [name], `${version} must remain represented by exactly its canonical historical filename`);

  const source = fs.readFileSync(path.join(migrationsDirectory, name), "utf8");
  assert.equal(sha256(source), hashes.raw, `${name} must remain byte-identical to the recovered Production statement content`);
  assert.equal(sha256(normalize(source)), hashes.normalized, `${name} normalized SQL must remain unchanged`);
}

const canonicalApplied = [
  "202606170001", "202606170002", "202606170003", "202606170004", "202606180002", "202606180003",
  "202606180004", "202606180005", "202606180006", "202606180007", "202606180012", "202606220002",
  "202606260001", "202607060001", "202607070001", "202607080001", "202607080002", "202607080003",
  "202607080004", "202607110002", "20260721220519", "202607250001", "202607250002", "20260726205442",
  "202607270001", "202607270002", "202607300001", "20260731092011", "20260731093656", "20260731213000",
  "20260731224500", "20260731231500", "20260803052701", "20260803172709", "20260803181405", "20260803204552",
  "20260803205520", "20260803230226", "20260804010000", "20260804160932", "20260805011604", "20260805163333",
  "202606180008", "202606180009", "202606180010", "202606180011", "20260619110000", "202606220001",
  "202606230001", "202607260001", "20260806180609", "20260807172710", "20260807181420", "20260807185224",
  "20260807195152", "20260807203645", "20260807215440", "20260808060301", "20260808064500", "20260808070000"
];
const aliasesReverted = [
  "20260618015711", "20260618015721", "20260618015814", "20260618015903", "20260618061639", "20260618084518",
  "20260618152156", "20260618161311", "20260618172630", "20260618181707", "20260619062213", "20260622224719",
  "20260626223440", "20260706215202", "20260707210949", "20260731012629", "20260708090351", "20260708101247",
  "20260708112329", "20260713204553", "20260721234940", "20260726041024", "20260726200616", "20260727012022",
  "20260731012720", "20260731012817", "20260731013019", "20260801221404", "20260801221419", "20260801221428",
  "20260801221439", "20260801221447", "20260809025117", "20260809025123", "20260809025128", "20260809025137",
  "20260809025142", "20260809025150", "20260809025154", "20260809025158", "20260809025203", "20260809025207"
];

assert.equal(canonicalApplied.length, 60, "the proposed plan must retain exactly 60 canonical/history-only apply commands");
assert.equal(new Set(canonicalApplied).size, 60, "canonical/history-only apply versions must be unique");
assert.equal(aliasesReverted.length, 42, "the proposed plan must retain exactly 42 alias revert commands");
assert.equal(new Set(aliasesReverted).size, 42, "alias revert versions must be unique");
assert.equal(canonicalApplied.some((version) => aliasesReverted.includes(version)), false, "apply and revert sets must be disjoint");

for (const name of expected.keys()) {
  const version = name.split("_")[0];
  assert.equal(canonicalApplied.includes(version), false, `${version} must not be repaired as a canonical replacement`);
  assert.equal(aliasesReverted.includes(version), false, `${version} must remain applied and must not be reverted`);
  assert.match(reconciliation, new RegExp(`\\b${version}\\b`), `${version} must remain documented as legitimate Production lineage`);
}

for (const version of [...canonicalApplied, ...aliasesReverted]) {
  assert.match(reconciliation, new RegExp(`\\b${version}\\b`), `${version} must remain in the checkpointed reconciliation note`);
}

console.log("Production migration history regressions passed.");
