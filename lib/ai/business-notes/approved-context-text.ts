import type { BusinessNoteExtraction, BusinessNoteUserAddedContext } from "./contracts";
import { businessNoteUserAddedContextText } from "./review-context";

function periodLabel(extraction: BusinessNoteExtraction) {
  const { start, end } = extraction.reportingPeriod;
  if (start && end) return start === end ? start : `${start} to ${end}`;
  return start || end || "Not specified";
}

export function approvedContextText(
  extraction: BusinessNoteExtraction,
  userAddedContext: readonly BusinessNoteUserAddedContext[]
) {
  const lines = [
    `Business Note: ${extraction.title}`,
    `Note type: ${extraction.noteType.replace(/_/g, " ")}`,
    `Source classification: ${extraction.sourceClassification.replace(/_/g, " ")}`,
    `Departments: ${extraction.departments.join(", ") || "Not specified"}`,
    `Topics: ${extraction.topics.join(", ") || "Not specified"}`,
    `Reporting period: ${periodLabel(extraction)}`,
    `Context summary: ${extraction.summary}`
  ];
  const add = (label: string, values: readonly { text: string; quote: string }[]) => {
    values.forEach((item) => lines.push(`${label}: ${item.text}\nExact note quotation: ${item.quote}`));
  };

  add("Reported fact", extraction.explicitFacts.map((item) => ({ text: item.statement, quote: item.sourceQuote })));
  add("Opinion or assumption", extraction.opinionsOrAssumptions.map((item) => ({ text: item.statement, quote: item.sourceQuote })));
  add("Reported risk", extraction.risks.map((item) => ({ text: item.description, quote: item.sourceQuote })));
  add("Reported opportunity", extraction.opportunities.map((item) => ({ text: item.description, quote: item.sourceQuote })));
  add("Reported decision", extraction.decisions.map((item) => ({ text: item.description, quote: item.sourceQuote })));
  add("Mentioned person", extraction.peopleMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Mentioned customer", extraction.customersMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Mentioned vendor", extraction.vendorsMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Mentioned project", extraction.projectsMentioned.map((item) => ({ text: item.name, quote: item.sourceQuote })));
  add("Reported metric (unverified)", extraction.mentionedMetrics.map((item) => ({
    text: `${item.name}: ${item.value === null ? "value not specified" : item.value}${item.unit ? ` ${item.unit}` : ""}`,
    quote: item.sourceQuote
  })));
  lines.push(...businessNoteUserAddedContextText(userAddedContext));

  return lines.join("\n\n");
}
