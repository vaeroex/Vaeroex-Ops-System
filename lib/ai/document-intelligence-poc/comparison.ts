import "server-only";

import type {
  BenchmarkDocument,
  CatastrophicBusinessErrorCode,
  DocumentBenchmarkComparison,
  DocumentComparisonMetric,
  DocumentComparisonMetrics,
  DocumentExtractionResult,
  NormalizedDocumentElement
} from "@/lib/ai/document-intelligence-poc/contracts";

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\u2012\u2013\u2014\u2212]/g, "-").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return normalized(value).match(/[a-z]+(?:-[a-z]+)*|-?\d+(?:[.,]\d+)*%?/g) || [];
}

function levenshtein(left: readonly string[], right: readonly string[]) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function rate(correct: number, total: number): DocumentComparisonMetric {
  return total ? correct / total : null;
}

const UNSCORED_METRICS: DocumentComparisonMetrics = {
  characterErrorRate: null,
  wordErrorRate: null,
  exactNumericAccuracy: null,
  signAccuracy: null,
  decimalAccuracy: null,
  currencyAccuracy: null,
  percentageAccuracy: null,
  dateAccuracy: null,
  reportingPeriodAccuracy: null,
  kpiNameAccuracy: null,
  kpiValueAccuracy: null,
  kpiTargetAccuracy: null,
  unitAccuracy: null,
  rowReconstructionAccuracy: null,
  columnReconstructionAccuracy: null,
  mergedCellReconstructionAccuracy: null,
  readingOrderAccuracy: null,
  pageAssociationAccuracy: null,
  boundingBoxCoverage: null,
  boundingBoxCorrectness: null,
  headingAccuracy: null,
  sectionAssociationAccuracy: null,
  hallucinatedTextRate: null,
  omittedTextRate: null,
  duplicatedTextRate: null,
  catastrophicBusinessErrorRate: null
};

function flattenTruth(document: BenchmarkDocument) {
  return document.groundTruth.flatMap((page) => page.elements.map((element) => ({ pageNumber: page.pageNumber, element })));
}

function flattenOutput(result: DocumentExtractionResult) {
  return result.pages.flatMap((page) => page.elements.map((element) => ({ pageNumber: page.pageNumber, element })));
}

function overlapScore(left: string, right: string) {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function bestMatch(expected: NormalizedDocumentElement, predicted: readonly { pageNumber: number; element: NormalizedDocumentElement }[]) {
  const exact = predicted.find((candidate) => {
    const left = normalized(expected.rawText);
    const right = normalized(candidate.element.rawText);
    return left === right || right.includes(left) || left.includes(right);
  });
  if (exact) return exact;
  return [...predicted]
    .map((candidate) => ({ candidate, score: overlapScore(expected.rawText, candidate.element.rawText) }))
    .sort((left, right) => right.score - left.score)[0]?.score >= 0.45
    ? [...predicted].map((candidate) => ({ candidate, score: overlapScore(expected.rawText, candidate.element.rawText) })).sort((left, right) => right.score - left.score)[0].candidate
    : null;
}

function numberTokens(value: string) {
  return (value.match(/(?:[$€£]\s*)?\(?-?\d[\d,]*(?:\.\d+)?\)?%?/g) || []).map((displayed) => {
    const parentheses = /\([^)]*\)/.test(displayed);
    const parsed = Number.parseFloat(displayed.replace(/[$€£,%()\s]/g, ""));
    return {
      displayed,
      value: parentheses ? -Math.abs(parsed) : parsed,
      sign: parentheses || /-/.test(displayed) ? -1 : parsed > 0 ? 1 : 0,
      decimals: displayed.match(/\.(\d+)/)?.[1].length || 0,
      currency: /[$€£]/.test(displayed),
      percentage: /%/.test(displayed)
    };
  }).filter((item) => Number.isFinite(item.value));
}

function iou(left: NonNullable<NormalizedDocumentElement["boundingBox"]>, right: NonNullable<NormalizedDocumentElement["boundingBox"]>) {
  const intersectionWidth = Math.max(0, Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin));
  const intersectionHeight = Math.max(0, Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin));
  const intersection = intersectionWidth * intersectionHeight;
  const leftArea = (left.xMax - left.xMin) * (left.yMax - left.yMin);
  const rightArea = (right.xMax - right.xMin) * (right.yMax - right.yMin);
  return intersection / Math.max(Number.EPSILON, leftArea + rightArea - intersection);
}

function equalField(expected: unknown, actual: unknown) {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(expected - actual) < 1e-9;
  return expected === actual;
}

function accuracyForField(
  truth: ReturnType<typeof flattenTruth>,
  predicted: ReturnType<typeof flattenOutput>,
  field: keyof NormalizedDocumentElement
) {
  const relevant = truth.filter(({ element }) => element[field] !== null);
  let correct = 0;
  for (const { element } of relevant) {
    const match = bestMatch(element, predicted);
    if (match && equalField(element[field], match.element[field])) correct += 1;
  }
  return rate(correct, relevant.length);
}

function catastrophicErrors(document: BenchmarkDocument, result: DocumentExtractionResult) {
  if (result.status !== "success") return [];
  const truth = flattenTruth(document);
  const predicted = flattenOutput(result);
  const errors = new Set<CatastrophicBusinessErrorCode>();
  const allExpectedNumbers = new Set(document.groundTruth.flatMap((page) => page.elements.flatMap((element) => numberTokens(element.rawText).map((number) => number.value))));

  for (const { pageNumber, element } of truth) {
    if (element.normalizedNumericValue === null) continue;
    const match = bestMatch(element, predicted);
    if (!match) {
      errors.add("critical_page_omitted");
      continue;
    }
    const exactSourceText = normalized(element.rawText) === normalized(match.element.rawText);
    const expectedNumber = numberTokens(element.displayedNumericText || element.rawText)[0];
    const actualNumber = numberTokens(match.element.rawText).find((number) => Math.abs(number.value - (element.normalizedNumericValue as number)) < 1e-9) || numberTokens(match.element.rawText)[0];
    if (!expectedNumber || !actualNumber) {
      errors.add("critical_page_omitted");
      continue;
    }
    if (expectedNumber.sign !== actualNumber.sign) errors.add("numeric_sign_changed");
    const ratio = expectedNumber.value && actualNumber.value ? Math.abs(actualNumber.value / expectedNumber.value) : 1;
    if (expectedNumber.decimals !== actualNumber.decimals && (ratio >= 9.9 || ratio <= 0.101)) errors.add("decimal_shift");
    if (element.currency && expectedNumber.value !== actualNumber.value && (ratio >= 9.9 || ratio <= 0.101)) errors.add("currency_magnitude_changed");
    if (match.pageNumber !== pageNumber) errors.add("wrong_source_coordinates");
    if (!exactSourceText && element.kpiName && match.element.kpiName && normalized(element.kpiName) !== normalized(match.element.kpiName)) errors.add("wrong_kpi_assignment");
    if (element.kpiValue !== null && element.kpiTarget !== null && match.element.kpiValue === element.kpiTarget) errors.add("current_target_confusion");
    if (!exactSourceText && element.reportingPeriod && match.element.reportingPeriod && element.reportingPeriod !== match.element.reportingPeriod) errors.add("reporting_period_merged");
  }

  for (const { element } of predicted) {
    for (const number of numberTokens(element.rawText)) {
      if (!allExpectedNumbers.has(number.value)) errors.add("fabricated_business_value");
    }
  }
  return Array.from(errors).sort();
}

export function compareDocumentExtraction(document: BenchmarkDocument, result: DocumentExtractionResult): DocumentBenchmarkComparison {
  if (result.status !== "success") {
    return {
      documentId: document.documentId,
      documentClasses: document.documentClasses,
      parser: result.parser,
      status: result.status,
      metrics: UNSCORED_METRICS,
      catastrophicErrors: [],
      latencyMs: result.latencyMs,
      requestCount: result.requestCount,
      retryCount: result.retryCount,
      failureCode: result.failureCode,
      supportedCapabilities: result.supportedCapabilities,
      unsupportedCapabilities: result.unsupportedCapabilities
    };
  }
  const truth = flattenTruth(document);
  const predicted = flattenOutput(result);
  const truthText = truth.map(({ element }) => element.normalizedText).join("\n");
  const predictedText = predicted.map(({ element }) => element.normalizedText).join("\n");
  const truthCharacters = Array.from(normalized(truthText));
  const predictedCharacters = Array.from(normalized(predictedText));
  const truthWords = tokens(truthText);
  const predictedWords = tokens(predictedText);
  const matches = truth.map(({ element }) => ({ expected: element, match: bestMatch(element, predicted) }));
  const numericExpected = matches.filter(({ expected }) => expected.normalizedNumericValue !== null);
  const numericCorrect = numericExpected.filter(({ expected, match }) => match && numberTokens(match.element.rawText).some((item) => item.value === expected.normalizedNumericValue)).length;
  const bboxExpected = matches.filter(({ expected }) => expected.boundingBox);
  const bboxAvailable = bboxExpected.filter(({ match }) => Boolean(match?.element.boundingBox));
  const bboxCorrect = bboxExpected.filter(({ expected, match }) => expected.boundingBox && match?.element.boundingBox && iou(expected.boundingBox, match.element.boundingBox) >= 0.45).length;
  const truthCounts = new Map<string, number>();
  const predictionCounts = new Map<string, number>();
  truth.forEach(({ element }) => truthCounts.set(normalized(element.rawText), (truthCounts.get(normalized(element.rawText)) || 0) + 1));
  predicted.forEach(({ element }) => predictionCounts.set(normalized(element.rawText), (predictionCounts.get(normalized(element.rawText)) || 0) + 1));
  const duplicated = Array.from(predictionCounts).reduce((sum, [text, count]) => sum + Math.max(0, count - (truthCounts.get(text) || 0)), 0);
  const truthTokenSet = new Set(truthWords);
  const predictedTokenSet = new Set(predictedWords);
  const hallucinated = predictedWords.filter((token) => !truthTokenSet.has(token)).length;
  const omitted = truthWords.filter((token) => !predictedTokenSet.has(token)).length;
  const errors = catastrophicErrors(document, result);
  const structureSupported = result.supportedCapabilities.includes("tables");
  const readingOrderSupported = result.supportedCapabilities.includes("reading_order");
  const headingSupported = result.supportedCapabilities.includes("headings");
  const sectionsSupported = result.supportedCapabilities.includes("sections");
  const metrics: DocumentComparisonMetrics = {
    characterErrorRate: truthCharacters.length ? levenshtein(truthCharacters, predictedCharacters) / truthCharacters.length : predictedCharacters.length ? 1 : 0,
    wordErrorRate: truthWords.length ? levenshtein(truthWords, predictedWords) / truthWords.length : predictedWords.length ? 1 : 0,
    exactNumericAccuracy: rate(numericCorrect, numericExpected.length),
    signAccuracy: accuracyForField(truth, predicted, "sign"),
    decimalAccuracy: accuracyForField(truth, predicted, "decimalPrecision"),
    currencyAccuracy: accuracyForField(truth, predicted, "currency"),
    percentageAccuracy: accuracyForField(truth, predicted, "percentage"),
    dateAccuracy: accuracyForField(truth, predicted, "date"),
    reportingPeriodAccuracy: accuracyForField(truth, predicted, "reportingPeriod"),
    kpiNameAccuracy: accuracyForField(truth, predicted, "kpiName"),
    kpiValueAccuracy: accuracyForField(truth, predicted, "kpiValue"),
    kpiTargetAccuracy: accuracyForField(truth, predicted, "kpiTarget"),
    unitAccuracy: accuracyForField(truth, predicted, "unit"),
    rowReconstructionAccuracy: structureSupported ? accuracyForField(truth, predicted, "rowIndex") : null,
    columnReconstructionAccuracy: structureSupported ? accuracyForField(truth, predicted, "columnIndex") : null,
    mergedCellReconstructionAccuracy: structureSupported ? Math.min(accuracyForField(truth, predicted, "rowSpan") ?? 1, accuracyForField(truth, predicted, "columnSpan") ?? 1) : null,
    readingOrderAccuracy: readingOrderSupported ? rate(matches.filter(({ expected, match }) => match?.element.readingOrderIndex === expected.readingOrderIndex).length, matches.length) : null,
    pageAssociationAccuracy: rate(matches.filter(({ expected, match }) => match?.pageNumber === expected.provenance.sourcePage).length, matches.length),
    boundingBoxCoverage: rate(bboxAvailable.length, bboxExpected.length),
    boundingBoxCorrectness: rate(bboxCorrect, bboxExpected.length),
    headingAccuracy: headingSupported ? accuracyForField(truth, predicted, "headingLevel") : null,
    sectionAssociationAccuracy: sectionsSupported ? accuracyForField(truth, predicted, "sectionIdentity") : null,
    hallucinatedTextRate: predictedWords.length ? hallucinated / predictedWords.length : 0,
    omittedTextRate: truthWords.length ? omitted / truthWords.length : 0,
    duplicatedTextRate: predicted.length ? duplicated / predicted.length : 0,
    catastrophicBusinessErrorRate: errors.length ? errors.length / Math.max(1, numericExpected.length) : 0
  };
  return {
    documentId: document.documentId,
    documentClasses: document.documentClasses,
    parser: result.parser,
    status: result.status,
    metrics,
    catastrophicErrors: errors,
    latencyMs: result.latencyMs,
    requestCount: result.requestCount,
    retryCount: result.retryCount,
    failureCode: result.failureCode,
    supportedCapabilities: result.supportedCapabilities,
    unsupportedCapabilities: result.unsupportedCapabilities
  };
}
