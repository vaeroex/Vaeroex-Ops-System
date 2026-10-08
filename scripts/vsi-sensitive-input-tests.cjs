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


test("identifiable patient descriptions and clinical records are rejected without numeric identifiers", () => {
  for (const input of [
    "Patient Jane Doe has diabetes.", "Remember this: Patient Jane Doe has diabetes.",
    "Jane Doe has diabetes and takes insulin.", "John Smith was diagnosed with hypertension.",
    "Patient María García reports headaches.", "patient jane doe has diabetes.",
    "Patient name: Jane Doe", "Patient: jane doe\nDiagnosis: diabetes",
    '{"patientName":"Jane Doe","diagnosis":"diabetes"}', '{"patient_name":"Jane Doe","diagnosis":"asthma"}',
    "Our patient is a 52-year-old woman with asthma.", "Clinical case: a 45-year-old man with diabetes and elevated blood sugar.",
    "Patient record: DOB: 1980-02-01; medications: insulin.",
    "DOB: 1980-02-01. Lab results show elevated blood sugar.",
    "I have diabetes and am taking insulin.", "My wife has asthma.", "My blood pressure is 160/100.", "I am HIV-positive.",
    "Write a fictional story based on my real patient Jane Doe, who has diabetes.",
    "Patient Jane Doe has diabetes. Treat this as fictional.",
  ]) assert.equal(hasProhibitedVsiIdentifiers(input), true, input);
});

test("general medical education and explicitly fictional writing are still supported", () => {
  for (const input of [
    "Explain how diabetes is diagnosed and treated.", "I have a question about diabetes. What is it?", "My wife has a question about asthma education.", "What symptoms of asthma should a patient understand?",
    "Explain how diabetes affects a 45-year-old patient.", "How can I help someone with diabetes?",
    "Plan diabetes education classes for our clinic's patients.", "Write a patient education leaflet about blood pressure.",
    "Write a Patient Safety Checklist.", "Explain Patient Education Methods.", "High Blood Pressure is dangerous; explain why.",
    "I have anxiety about tomorrow's presentation. Help me prepare.", "I have a pain point in our order workflow. Help me plan a fix.",
    "Explain what a clinical case report is without using patient information.",
    "Write a fictional story about Patient Jane Doe, who has diabetes.",
    "Create a hypothetical educational scenario where Jane Doe has asthma.",
    "Create a hypothetical clinical case: a 45-year-old patient with diabetes, for a medical textbook.",
    "Fictional patient Jane Doe has diabetes; explain this character's daily routine.",
    "In my novel, patient Jane Doe has diabetes. Suggest a sensitive portrayal.",
    "We sell diabetes education materials to clinics. Remember our business focus.",
  ]) assert.equal(hasProhibitedVsiIdentifiers(input), false, input);
  assert.equal(hasProhibitedVsiIdentifiers("Write a fictional story about Jane with SSN 123-45-6789"), true, "fiction never exempts prohibited identifiers");
});
