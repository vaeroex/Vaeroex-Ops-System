/* eslint-disable @typescript-eslint/no-require-imports -- Pure server input guard behavior tests. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadSource } = require("./integrations-ui-test-support");
const { hasProhibitedVsiIdentifiers } = loadSource("lib/vsi/sensitive-input.ts");

test("explicit remember and general chat reject recognizable prohibited identifiers", () => {
  for (const input of ["remember this: SSN 123-45-6789", "My social security number is 123456789", "Remember the customer's number: 123 45 6789.",
    "MRN: 81273", "medical record number is A88219", "medical record ID 22-515", "insurance ID: ABC1234", "insurance member number: X09", "patient ID P197"]) {
    assert.equal(hasProhibitedVsiIdentifiers(input), true, input);
  }
});

test("ordinary healthcare explanations, plans, identifiers without private values, and business numbers remain supported", () => {
  for (const input of ["What is an MRN?", "Explain why an insurance ID is used.", "Plan staffing for a clinic without patient data.",
    "What is the difference between a cold and the flu?", "Remember this: we sell furniture and aim for 123456789 in annual sales.",
    "Our business phone is 415-555-0181.", "Explain how Social Security numbers are protected.", "Compare inventory IDs ABC1234 and ABC1235."]) {
    assert.equal(hasProhibitedVsiIdentifiers(input), false, input);
  }
});
