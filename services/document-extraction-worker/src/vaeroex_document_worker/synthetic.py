"""Frozen, synthetic-only Phase C1 qualification support.

The worker never accepts a fixture path or upload from a caller. During the
explicit Preview qualification window it binds a claimed source hash to this
committed corpus, materializes only the corresponding committed page images,
and emits content-free benchmark measurements.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Sequence

from .provider_types import ProviderResult, RenderedPage

SYNTHETIC_CONTRACT_VERSION = "document_extraction_phase_c1_synthetic_v1"
BENCHMARK_VERSION = "document_intelligence_benchmark_v1"
FIXTURE_SOURCE_COMMIT = "cc3c125b01ac41513b3b92213b6daa39fa5ba91f"
FIXTURE_CORPUS_SHA256 = "c0e6b1aa615e3674e5aa418436a84555889d8766d4d8a1e3401685dbe2495dec"
FIXTURE_COUNT = 12
PAGE_COUNT = 13
EXPECTED_PROVIDER_PAGE_CALLS = 12

WORKER_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = WORKER_ROOT / "fixtures" / "synthetic-v1"
BASELINE_PATH = WORKER_ROOT / "fixtures" / "current-baseline-v1.json"

APPROVED_DOCUMENT_IDS = (
    "synthetic-doc-executive-kpi-review",
    "synthetic-doc-scanned-profit-loss",
    "synthetic-doc-rotated-invoice",
    "synthetic-doc-skewed-operations",
    "synthetic-doc-three-column-brief",
    "synthetic-doc-merged-table",
    "synthetic-doc-multi-page-financials",
    "synthetic-doc-dashboard-chart",
    "synthetic-doc-handwritten-annotation",
    "synthetic-doc-prompt-injection",
    "synthetic-doc-empty-page",
    "synthetic-doc-corrupted-image",
)

METRIC_KEYS = (
    "characterErrorRate",
    "wordErrorRate",
    "exactNumericAccuracy",
    "signAccuracy",
    "decimalAccuracy",
    "currencyAccuracy",
    "percentageAccuracy",
    "dateAccuracy",
    "reportingPeriodAccuracy",
    "kpiNameAccuracy",
    "kpiValueAccuracy",
    "kpiTargetAccuracy",
    "unitAccuracy",
    "rowReconstructionAccuracy",
    "columnReconstructionAccuracy",
    "mergedCellReconstructionAccuracy",
    "readingOrderAccuracy",
    "pageAssociationAccuracy",
    "boundingBoxCoverage",
    "boundingBoxCorrectness",
    "headingAccuracy",
    "sectionAssociationAccuracy",
    "hallucinatedTextRate",
    "omittedTextRate",
    "duplicatedTextRate",
    "catastrophicBusinessErrorRate",
)

STRUCTURE_CLASSES = frozenset(
    {
        "dense_financial_table",
        "merged_cell_table",
        "multi_page_table",
        "spreadsheet_rendered_as_pdf",
    }
)
DIFFICULT_CLASSES = frozenset(
    {
        "scanned_pdf",
        "image_only_pdf",
        "rotated_page",
        "skewed_scan",
        "low_resolution_image",
        "poor_contrast_scan",
        "handwritten_annotation",
    }
)

_SOURCE_FILE = re.compile(r"^synthetic-doc-[a-z0-9-]+\.(?:pdf|png|jpg)$")
_PAGE_FILE = re.compile(r"^synthetic-doc-[a-z0-9-]+-page-\d+\.png$")
_TOKEN = re.compile(r"[a-z]+(?:-[a-z]+)*|-?\d+(?:[.,]\d+)*%?")
_NUMBER = re.compile(r"(?:[$EURGBP\u20ac\u00a3]\s*)?\(?-?\d[\d,]*(?:\.\d+)?\)?%?")
_MONTHS = {
    "january": "01",
    "february": "02",
    "march": "03",
    "april": "04",
    "may": "05",
    "june": "06",
    "july": "07",
    "august": "08",
    "september": "09",
    "october": "10",
    "november": "11",
    "december": "12",
}

JsonObject = dict[str, Any]
MetricValue = float | None
Metrics = dict[str, MetricValue]


class SyntheticQualificationFailure(RuntimeError):
    """A content-free, fail-closed qualification error."""


@dataclass(frozen=True)
class FrozenSyntheticFixture:
    fixture_index: int
    document_id: str
    document_classes: tuple[str, ...]
    source_path: Path
    source_sha256: str
    rendered_page_paths: tuple[Path, ...]
    ground_truth: tuple[JsonObject, ...]
    provider_eligible: bool


@dataclass(frozen=True)
class NumberToken:
    displayed: str
    value: float
    sign: int
    decimals: int
    currency: bool
    percentage: bool


@dataclass(frozen=True)
class SyntheticEvaluation:
    fixture_index: int
    document_classes: tuple[str, ...]
    status: str
    page_count: int
    provider_calls: int
    retry_count: int
    latency_ms: int
    payload_modes: tuple[str, ...]
    metrics: Metrics
    catastrophic_errors: tuple[str, ...]
    failure_code: str | None

    def privacy_safe_record(self) -> JsonObject:
        return {
            "event": "document_extraction_synthetic_fixture_v1",
            "contractVersion": SYNTHETIC_CONTRACT_VERSION,
            "benchmarkVersion": BENCHMARK_VERSION,
            "syntheticOnly": True,
            "fixtureIndex": self.fixture_index,
            "documentClasses": list(self.document_classes),
            "status": self.status,
            "pageCount": self.page_count,
            "providerCalls": self.provider_calls,
            "retryCount": self.retry_count,
            "latencyMs": self.latency_ms,
            "payloadModes": list(self.payload_modes),
            "metrics": self.metrics,
            "catastrophicErrors": list(self.catastrophic_errors),
            "failureCode": self.failure_code,
        }


def _corpus_digest(root: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(path for path in root.rglob("*") if path.is_file())
    for path in files:
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _require_string(value: object, code: str) -> str:
    if not isinstance(value, str) or not value:
        raise SyntheticQualificationFailure(code)
    return value


def _require_object(value: object, code: str) -> JsonObject:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise SyntheticQualificationFailure(code)
    return value


def _png_dimensions(path: Path) -> tuple[int, int]:
    content = path.read_bytes()
    if (
        len(content) < 24
        or content[:8] != b"\x89PNG\r\n\x1a\n"
        or content[12:16] != b"IHDR"
    ):
        raise SyntheticQualificationFailure("synthetic_fixture_page_invalid")
    return int.from_bytes(content[16:20], "big"), int.from_bytes(content[20:24], "big")


@lru_cache(maxsize=1)
def load_frozen_corpus() -> tuple[FrozenSyntheticFixture, ...]:
    if _corpus_digest(FIXTURE_ROOT) != FIXTURE_CORPUS_SHA256:
        raise SyntheticQualificationFailure("synthetic_fixture_corpus_digest_mismatch")
    try:
        raw = json.loads((FIXTURE_ROOT / "ground-truth.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SyntheticQualificationFailure("synthetic_fixture_manifest_invalid") from error
    if not isinstance(raw, list) or len(raw) != FIXTURE_COUNT:
        raise SyntheticQualificationFailure("synthetic_fixture_manifest_invalid")

    fixtures: list[FrozenSyntheticFixture] = []
    seen_hashes: set[str] = set()
    for fixture_index, raw_entry in enumerate(raw, start=1):
        entry = _require_object(raw_entry, "synthetic_fixture_manifest_invalid")
        document_id = _require_string(entry.get("documentId"), "synthetic_fixture_identity_invalid")
        if document_id != APPROVED_DOCUMENT_IDS[fixture_index - 1]:
            raise SyntheticQualificationFailure("synthetic_fixture_identity_invalid")
        source_file = _require_string(entry.get("sourceFile"), "synthetic_fixture_path_invalid")
        if not _SOURCE_FILE.fullmatch(source_file):
            raise SyntheticQualificationFailure("synthetic_fixture_path_invalid")
        rendered_names = entry.get("renderedPageFiles")
        classes = entry.get("documentClasses")
        truth = entry.get("groundTruth")
        if (
            not isinstance(rendered_names, list)
            or not rendered_names
            or not all(isinstance(value, str) and _PAGE_FILE.fullmatch(value) for value in rendered_names)
            or not isinstance(classes, list)
            or not classes
            or not all(isinstance(value, str) and re.fullmatch(r"[a-z0-9_]{1,80}", value) for value in classes)
            or not isinstance(truth, list)
            or len(truth) != len(rendered_names)
            or not all(isinstance(page, dict) for page in truth)
        ):
            raise SyntheticQualificationFailure("synthetic_fixture_manifest_invalid")
        source_path = FIXTURE_ROOT / "generated" / source_file
        rendered_paths = tuple(FIXTURE_ROOT / "generated" / name for name in rendered_names)
        if not source_path.is_file() or any(not path.is_file() for path in rendered_paths):
            raise SyntheticQualificationFailure("synthetic_fixture_path_invalid")
        for path in rendered_paths:
            _png_dimensions(path)
        source_sha256 = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if source_sha256 in seen_hashes:
            raise SyntheticQualificationFailure("synthetic_fixture_source_collision")
        seen_hashes.add(source_sha256)
        fixtures.append(
            FrozenSyntheticFixture(
                fixture_index=fixture_index,
                document_id=document_id,
                document_classes=tuple(classes),
                source_path=source_path,
                source_sha256=source_sha256,
                rendered_page_paths=rendered_paths,
                ground_truth=tuple(_require_object(page, "synthetic_fixture_manifest_invalid") for page in truth),
                provider_eligible="corrupted_page" not in classes,
            )
        )
    if sum(len(fixture.rendered_page_paths) for fixture in fixtures) != PAGE_COUNT:
        raise SyntheticQualificationFailure("synthetic_fixture_page_count_mismatch")
    if sum(len(fixture.rendered_page_paths) for fixture in fixtures if fixture.provider_eligible) != EXPECTED_PROVIDER_PAGE_CALLS:
        raise SyntheticQualificationFailure("synthetic_fixture_provider_call_bound_mismatch")
    return tuple(fixtures)


def approved_fixture_for_source(document_sha256: str, expected_pages: int) -> FrozenSyntheticFixture:
    fixture = next(
        (candidate for candidate in load_frozen_corpus() if candidate.source_sha256 == document_sha256),
        None,
    )
    if fixture is None or len(fixture.rendered_page_paths) != expected_pages:
        raise SyntheticQualificationFailure("synthetic_fixture_not_approved")
    return fixture


def materialize_approved_pages(fixture: FrozenSyntheticFixture, destination: Path) -> list[RenderedPage]:
    if not fixture.provider_eligible:
        raise SyntheticQualificationFailure("synthetic_fixture_locally_invalid")
    destination.mkdir(mode=0o700)
    pages: list[RenderedPage] = []
    for page_number, source in enumerate(fixture.rendered_page_paths, start=1):
        target = destination / f"page-{page_number:04d}.png"
        shutil.copyfile(source, target)
        os.chmod(target, 0o600)
        content = target.read_bytes()
        width, height = _png_dimensions(target)
        pages.append(
            RenderedPage(
                page=page_number,
                path=target,
                mime_type="image/png",
                width=width,
                height=height,
                byte_length=len(content),
                content_sha256=hashlib.sha256(content).hexdigest(),
            )
        )
    return pages


def _normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = re.sub(r"[\u2012\u2013\u2014\u2212]", "-", value)
    return re.sub(r"\s+", " ", value).strip()


def _tokens(value: str) -> list[str]:
    return _TOKEN.findall(_normalized(value))


def _levenshtein(left: Sequence[str], right: Sequence[str]) -> int:
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for left_index, left_item in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_item in enumerate(right, start=1):
            current.append(
                min(
                    current[right_index - 1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (0 if left_item == right_item else 1),
                )
            )
        previous = current
    return previous[-1]


def _rate(correct: int, total: int) -> MetricValue:
    return correct / total if total else None


def _number_tokens(value: str) -> list[NumberToken]:
    values: list[NumberToken] = []
    for match in _NUMBER.finditer(value):
        displayed = match.group(0)
        parentheses = "(" in displayed and ")" in displayed
        numeric = re.sub(r"[$\u20ac\u00a3,%()\s]", "", displayed)
        try:
            parsed = float(numeric.replace(",", ""))
        except ValueError:
            continue
        if parentheses:
            parsed = -abs(parsed)
        decimal_match = re.search(r"\.(\d+)", displayed)
        values.append(
            NumberToken(
                displayed=displayed,
                value=parsed,
                sign=-1 if parentheses or "-" in displayed else 1 if parsed > 0 else 0,
                decimals=len(decimal_match.group(1)) if decimal_match else 0,
                currency=bool(re.search(r"[$\u20ac\u00a3]", displayed)),
                percentage="%" in displayed,
            )
        )
    return values


def _reporting_period(value: str) -> str | None:
    quarter = re.search(r"\bQ([1-4])\s+(20\d{2})\b", value, re.IGNORECASE)
    if quarter:
        return f"{quarter.group(2)}-Q{quarter.group(1)}"
    month = re.search(
        rf"\b({'|'.join(_MONTHS)})\s+(20\d{{2}})\b",
        value,
        re.IGNORECASE,
    )
    return f"{month.group(2)}-{_MONTHS[month.group(1).lower()]}" if month else None


def _calendar_date(value: str) -> str | None:
    match = re.search(
        rf"\b({'|'.join(_MONTHS)})\s+(\d{{1,2}}),\s*(20\d{{2}})\b",
        value,
        re.IGNORECASE,
    )
    return (
        f"{match.group(3)}-{_MONTHS[match.group(1).lower()]}-{match.group(2).zfill(2)}"
        if match
        else None
    )


def _kpi_name(value: str) -> str | None:
    match = re.match(r"^([^:|]{2,80}):", value)
    if not match:
        return None
    candidate = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", match.group(1))).strip()
    return None if re.search(r"invoice|date|subtotal|tax|total due|prior period", candidate, re.IGNORECASE) else candidate


def _target(value: str) -> float | None:
    match = re.search(
        r"\bTarget(?:\s+[A-Za-z]+)?\s*:\s*(?:[$\u20ac\u00a3]\s*)?\(?(-?\d[\d,]*(?:\.\d+)?)\)?",
        value,
        re.IGNORECASE,
    )
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def _unit(value: str) -> str | None:
    if "%" in value:
        return "percent"
    for pattern, unit in (
        (r"\bmin(?:ute)?s?\b", "minutes"),
        (r"\bhours?\b", "hours"),
        (r"\borders?\b", "orders"),
        (r"\bunits?\b", "units"),
        (r"\breviews?\b", "reviews"),
        (r"\(\$M\)|million USD", "million USD"),
        (r"\(\$K\)|thousand USD", "thousand USD"),
    ):
        if re.search(pattern, value, re.IGNORECASE):
            return unit
    return None


def _predicted_elements(result: ProviderResult) -> list[tuple[int, JsonObject]]:
    predicted: list[tuple[int, JsonObject]] = []
    for raw_page in result.pages:
        page_number = raw_page.get("page")
        blocks = raw_page.get("blocks")
        if not isinstance(page_number, int) or not isinstance(blocks, list):
            continue
        for index, raw_block in enumerate(blocks):
            if not isinstance(raw_block, dict) or not isinstance(raw_block.get("text"), str):
                continue
            text = raw_block["text"]
            numbers = _number_tokens(text)
            first_number = numbers[0] if numbers else None
            coordinates = raw_block.get("coordinates")
            bounding_box: JsonObject | None = None
            if isinstance(coordinates, dict) and all(
                isinstance(coordinates.get(key), (int, float)) for key in ("x", "y", "width", "height")
            ):
                x = float(coordinates["x"])
                y = float(coordinates["y"])
                width = float(coordinates["width"])
                height = float(coordinates["height"])
                bounding_box = {"xMin": x, "yMin": y, "xMax": x + width, "yMax": y + height}
            name = _kpi_name(text)
            predicted.append(
                (
                    page_number,
                    {
                        "rawText": text,
                        "normalizedText": re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip(),
                        "boundingBox": bounding_box,
                        "readingOrderIndex": index,
                        "elementType": raw_block.get("kind"),
                        "sign": "negative" if first_number and first_number.sign < 0 else "positive" if first_number and first_number.sign > 0 else "zero" if first_number else None,
                        "decimalPrecision": first_number.decimals if first_number else None,
                        "currency": "USD" if first_number and "$" in first_number.displayed else "EUR" if first_number and "\u20ac" in first_number.displayed else "GBP" if first_number and "\u00a3" in first_number.displayed else None,
                        "percentage": first_number.value if first_number and first_number.percentage else None,
                        "date": _calendar_date(text),
                        "reportingPeriod": _reporting_period(text),
                        "kpiName": name,
                        "kpiValue": first_number.value if name and first_number else None,
                        "kpiTarget": _target(text),
                        "unit": _unit(text),
                        "rowIndex": None,
                        "columnIndex": None,
                        "rowSpan": None,
                        "columnSpan": None,
                        "headingLevel": None,
                        "sectionIdentity": None,
                    },
                )
            )
    return predicted


def _truth_elements(fixture: FrozenSyntheticFixture) -> list[tuple[int, JsonObject]]:
    values: list[tuple[int, JsonObject]] = []
    for page in fixture.ground_truth:
        page_number = page.get("pageNumber")
        elements = page.get("elements")
        if not isinstance(page_number, int) or not isinstance(elements, list):
            raise SyntheticQualificationFailure("synthetic_fixture_ground_truth_invalid")
        for element in elements:
            values.append((page_number, _require_object(element, "synthetic_fixture_ground_truth_invalid")))
    return values


def _overlap_score(left: str, right: str) -> float:
    left_tokens = set(_tokens(left))
    right_tokens = set(_tokens(right))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def _best_match(expected: JsonObject, predicted: Sequence[tuple[int, JsonObject]]) -> tuple[int, JsonObject] | None:
    expected_text = _normalized(_require_string(expected.get("rawText"), "synthetic_fixture_ground_truth_invalid"))
    for candidate in predicted:
        candidate_text = _normalized(_require_string(candidate[1].get("rawText"), "synthetic_result_invalid"))
        if expected_text == candidate_text or expected_text in candidate_text or candidate_text in expected_text:
            return candidate
    ranked = sorted(
        predicted,
        key=lambda candidate: _overlap_score(expected_text, str(candidate[1].get("rawText", ""))),
        reverse=True,
    )
    return ranked[0] if ranked and _overlap_score(expected_text, str(ranked[0][1].get("rawText", ""))) >= 0.45 else None


def _iou(left: JsonObject, right: JsonObject) -> float:
    intersection_width = max(0.0, min(float(left["xMax"]), float(right["xMax"])) - max(float(left["xMin"]), float(right["xMin"])))
    intersection_height = max(0.0, min(float(left["yMax"]), float(right["yMax"])) - max(float(left["yMin"]), float(right["yMin"])))
    intersection = intersection_width * intersection_height
    left_area = (float(left["xMax"]) - float(left["xMin"])) * (float(left["yMax"]) - float(left["yMin"]))
    right_area = (float(right["xMax"]) - float(right["xMin"])) * (float(right["yMax"]) - float(right["yMin"]))
    return intersection / max(sys.float_info.epsilon, left_area + right_area - intersection)


def _equal_field(expected: object, actual: object) -> bool:
    if isinstance(expected, (int, float)) and not isinstance(expected, bool) and isinstance(actual, (int, float)) and not isinstance(actual, bool):
        return abs(float(expected) - float(actual)) < 1e-9
    return expected == actual


def _accuracy_for_field(
    truth: Sequence[tuple[int, JsonObject]],
    predicted: Sequence[tuple[int, JsonObject]],
    field: str,
) -> MetricValue:
    relevant = [element for _page, element in truth if element.get(field) is not None]
    correct = 0
    for element in relevant:
        match = _best_match(element, predicted)
        if match and _equal_field(element.get(field), match[1].get(field)):
            correct += 1
    return _rate(correct, len(relevant))


def _catastrophic_errors(
    fixture: FrozenSyntheticFixture,
    predicted: Sequence[tuple[int, JsonObject]],
) -> tuple[str, ...]:
    truth = _truth_elements(fixture)
    errors: set[str] = set()
    expected_numbers = {
        number.value
        for _page, element in truth
        for number in _number_tokens(str(element.get("rawText", "")))
    }
    for page_number, element in truth:
        expected_numeric = element.get("normalizedNumericValue")
        if not isinstance(expected_numeric, (int, float)) or isinstance(expected_numeric, bool):
            continue
        match = _best_match(element, predicted)
        if not match:
            errors.add("critical_page_omitted")
            continue
        expected_text = str(element.get("displayedNumericText") or element.get("rawText") or "")
        expected_tokens = _number_tokens(expected_text)
        actual_tokens = _number_tokens(str(match[1].get("rawText", "")))
        expected_number = expected_tokens[0] if expected_tokens else None
        actual_number = next((number for number in actual_tokens if abs(number.value - float(expected_numeric)) < 1e-9), actual_tokens[0] if actual_tokens else None)
        if expected_number is None or actual_number is None:
            errors.add("critical_page_omitted")
            continue
        exact_source = _normalized(str(element.get("rawText", ""))) == _normalized(str(match[1].get("rawText", "")))
        if expected_number.sign != actual_number.sign:
            errors.add("numeric_sign_changed")
        ratio = abs(actual_number.value / expected_number.value) if expected_number.value and actual_number.value else 1.0
        if expected_number.decimals != actual_number.decimals and (ratio >= 9.9 or ratio <= 0.101):
            errors.add("decimal_shift")
        if element.get("currency") and expected_number.value != actual_number.value and (ratio >= 9.9 or ratio <= 0.101):
            errors.add("currency_magnitude_changed")
        if match[0] != page_number:
            errors.add("wrong_source_coordinates")
        if not exact_source and element.get("kpiName") and match[1].get("kpiName") and _normalized(str(element["kpiName"])) != _normalized(str(match[1]["kpiName"])):
            errors.add("wrong_kpi_assignment")
        if element.get("kpiValue") is not None and element.get("kpiTarget") is not None and match[1].get("kpiValue") == element.get("kpiTarget"):
            errors.add("current_target_confusion")
        if not exact_source and element.get("reportingPeriod") and match[1].get("reportingPeriod") and element.get("reportingPeriod") != match[1].get("reportingPeriod"):
            errors.add("reporting_period_merged")
    for _page, element in predicted:
        for number in _number_tokens(str(element.get("rawText", ""))):
            if number.value not in expected_numbers:
                errors.add("fabricated_business_value")
    return tuple(sorted(errors))


def _empty_metrics() -> Metrics:
    return {key: None for key in METRIC_KEYS}


def evaluate_synthetic_result(
    fixture: FrozenSyntheticFixture,
    result: ProviderResult,
    *,
    provider_calls: int,
    retry_count: int,
) -> SyntheticEvaluation:
    truth = _truth_elements(fixture)
    predicted = _predicted_elements(result)
    truth_text = "\n".join(str(element.get("normalizedText", "")) for _page, element in truth)
    predicted_text = "\n".join(str(element.get("normalizedText", "")) for _page, element in predicted)
    truth_characters = list(_normalized(truth_text))
    predicted_characters = list(_normalized(predicted_text))
    truth_words = _tokens(truth_text)
    predicted_words = _tokens(predicted_text)
    matches = [(element, _best_match(element, predicted)) for _page, element in truth]
    numeric_expected = [(element, match) for element, match in matches if element.get("normalizedNumericValue") is not None]
    numeric_correct = sum(
        1
        for element, match in numeric_expected
        if match and any(number.value == element.get("normalizedNumericValue") for number in _number_tokens(str(match[1].get("rawText", ""))))
    )
    bbox_expected = [(element, match) for element, match in matches if isinstance(element.get("boundingBox"), dict)]
    bbox_available = [(element, match) for element, match in bbox_expected if match and isinstance(match[1].get("boundingBox"), dict)]
    bbox_correct = sum(
        1
        for element, match in bbox_expected
        if match and isinstance(match[1].get("boundingBox"), dict) and _iou(element["boundingBox"], match[1]["boundingBox"]) >= 0.45
    )
    truth_counts = Counter(_normalized(str(element.get("rawText", ""))) for _page, element in truth)
    predicted_counts = Counter(_normalized(str(element.get("rawText", ""))) for _page, element in predicted)
    duplicated = sum(max(0, count - truth_counts.get(text, 0)) for text, count in predicted_counts.items())
    truth_token_set = set(truth_words)
    predicted_token_set = set(predicted_words)
    hallucinated = sum(1 for token in predicted_words if token not in truth_token_set)
    omitted = sum(1 for token in truth_words if token not in predicted_token_set)
    errors = _catastrophic_errors(fixture, predicted)
    metrics: Metrics = {
        "characterErrorRate": _levenshtein(truth_characters, predicted_characters) / len(truth_characters) if truth_characters else 1.0 if predicted_characters else 0.0,
        "wordErrorRate": _levenshtein(truth_words, predicted_words) / len(truth_words) if truth_words else 1.0 if predicted_words else 0.0,
        "exactNumericAccuracy": _rate(numeric_correct, len(numeric_expected)),
        "signAccuracy": _accuracy_for_field(truth, predicted, "sign"),
        "decimalAccuracy": _accuracy_for_field(truth, predicted, "decimalPrecision"),
        "currencyAccuracy": _accuracy_for_field(truth, predicted, "currency"),
        "percentageAccuracy": _accuracy_for_field(truth, predicted, "percentage"),
        "dateAccuracy": _accuracy_for_field(truth, predicted, "date"),
        "reportingPeriodAccuracy": _accuracy_for_field(truth, predicted, "reportingPeriod"),
        "kpiNameAccuracy": _accuracy_for_field(truth, predicted, "kpiName"),
        "kpiValueAccuracy": _accuracy_for_field(truth, predicted, "kpiValue"),
        "kpiTargetAccuracy": _accuracy_for_field(truth, predicted, "kpiTarget"),
        "unitAccuracy": _accuracy_for_field(truth, predicted, "unit"),
        "rowReconstructionAccuracy": None,
        "columnReconstructionAccuracy": None,
        "mergedCellReconstructionAccuracy": None,
        "readingOrderAccuracy": _rate(sum(1 for element, match in matches if match and match[1].get("readingOrderIndex") == element.get("readingOrderIndex")), len(matches)),
        "pageAssociationAccuracy": _rate(sum(1 for element, match in matches if match and match[0] == element.get("provenance", {}).get("sourcePage")), len(matches)),
        "boundingBoxCoverage": _rate(len(bbox_available), len(bbox_expected)),
        "boundingBoxCorrectness": _rate(bbox_correct, len(bbox_expected)),
        "headingAccuracy": None,
        "sectionAssociationAccuracy": None,
        "hallucinatedTextRate": hallucinated / len(predicted_words) if predicted_words else 0.0,
        "omittedTextRate": omitted / len(truth_words) if truth_words else 0.0,
        "duplicatedTextRate": duplicated / len(predicted) if predicted else 0.0,
        "catastrophicBusinessErrorRate": len(errors) / max(1, len(numeric_expected)) if errors else 0.0,
    }
    return SyntheticEvaluation(
        fixture_index=fixture.fixture_index,
        document_classes=fixture.document_classes,
        status="success",
        page_count=len(fixture.rendered_page_paths),
        provider_calls=provider_calls,
        retry_count=retry_count,
        latency_ms=result.latency_ms,
        payload_modes=result.payload_modes,
        metrics=metrics,
        catastrophic_errors=errors,
        failure_code=None,
    )


def failed_synthetic_evaluation(
    fixture: FrozenSyntheticFixture,
    *,
    provider_calls: int,
    retry_count: int,
    failure_code: str,
) -> SyntheticEvaluation:
    return SyntheticEvaluation(
        fixture_index=fixture.fixture_index,
        document_classes=fixture.document_classes,
        status="failed",
        page_count=len(fixture.rendered_page_paths),
        provider_calls=provider_calls,
        retry_count=retry_count,
        latency_ms=0,
        payload_modes=(),
        metrics=_empty_metrics(),
        catastrophic_errors=(),
        failure_code=failure_code,
    )


def emit_synthetic_evaluation(evaluation: SyntheticEvaluation) -> None:
    payload = evaluation.privacy_safe_record()
    payload["timestamp"] = datetime.now(UTC).isoformat(timespec="milliseconds")
    print(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True), flush=True)


def _average(values: Iterable[MetricValue]) -> MetricValue:
    available = [value for value in values if value is not None]
    return sum(available) / len(available) if available else None


def _aggregate_metrics(records: Sequence[JsonObject]) -> Metrics:
    return {
        key: _average(
            record.get("metrics", {}).get(key)
            for record in records
            if isinstance(record.get("metrics"), dict)
        )
        for key in METRIC_KEYS
    }


def _percentile(values: Sequence[int], value: float) -> int | None:
    if not values:
        return None
    sorted_values = sorted(values)
    return sorted_values[min(len(sorted_values) - 1, max(0, math.ceil(value * len(sorted_values)) - 1))]


def _recommend_class(
    document_class: str,
    current: Metrics,
    nvidia: Metrics,
    records: Sequence[JsonObject],
) -> str:
    successful = [record for record in records if record.get("status") == "success"]
    if not successful:
        locally_invalid = all(record.get("failureCode") == "synthetic_fixture_locally_invalid" for record in records)
        return "REJECT FOR THIS DOCUMENT CLASS" if locally_invalid else "BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE"
    if len(successful) != len(records):
        return "REJECT FOR THIS DOCUMENT CLASS"
    if document_class in STRUCTURE_CLASSES and nvidia["rowReconstructionAccuracy"] is None:
        return "BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE"
    if nvidia["exactNumericAccuracy"] is None and nvidia["wordErrorRate"] is None:
        return "REJECT FOR THIS DOCUMENT CLASS"
    required_numeric = 0.99 if document_class in DIFFICULT_CLASSES else 0.995
    zero_catastrophic = nvidia["catastrophicBusinessErrorRate"] == 0
    numeric_pass = nvidia["exactNumericAccuracy"] is None or nvidia["exactNumericAccuracy"] >= required_numeric
    sign_pass = nvidia["signAccuracy"] is None or nvidia["signAccuracy"] == 1
    currency_pass = nvidia["currencyAccuracy"] is None or nvidia["currencyAccuracy"] == 1
    period_pass = nvidia["reportingPeriodAccuracy"] is None or nvidia["reportingPeriodAccuracy"] == 1
    hallucination_pass = (nvidia["hallucinatedTextRate"] if nvidia["hallucinatedTextRate"] is not None else 1) <= 0.001
    current_numeric = current["exactNumericAccuracy"] or 0
    nvidia_numeric = nvidia["exactNumericAccuracy"] or 0
    accuracy_improvement = nvidia_numeric - current_numeric
    current_word_error = current["wordErrorRate"]
    nvidia_word_error = nvidia["wordErrorRate"]
    if current_word_error and nvidia_word_error is not None:
        word_error_improvement = (current_word_error - nvidia_word_error) / current_word_error
    else:
        word_error_improvement = 1 if nvidia_word_error is not None and nvidia_word_error < 0.25 else 0
    materially_better = accuracy_improvement >= 0.05 or word_error_improvement >= 0.25
    if zero_catastrophic and numeric_pass and sign_pass and currency_pass and period_pass and hallucination_pass and materially_better:
        return "QUALIFIED FOR SPECIALIST PILOT" if document_class in DIFFICULT_CLASSES else "QUALIFIED FOR CONDITIONAL FALLBACK"
    if not zero_catastrophic or not numeric_pass or not sign_pass or not currency_pass or not period_pass:
        return "REJECT FOR THIS DOCUMENT CLASS"
    return "REMAIN SHADOW ONLY"


def aggregate_synthetic_records(records: Sequence[JsonObject]) -> JsonObject:
    fixtures = load_frozen_corpus()
    if len(records) != FIXTURE_COUNT:
        raise SyntheticQualificationFailure("synthetic_qualification_record_count_invalid")
    by_index: dict[int, JsonObject] = {}
    for record in records:
        index = record.get("fixtureIndex")
        if (
            record.get("event") != "document_extraction_synthetic_fixture_v1"
            or record.get("contractVersion") != SYNTHETIC_CONTRACT_VERSION
            or not isinstance(index, int)
            or not 1 <= index <= FIXTURE_COUNT
            or index in by_index
        ):
            raise SyntheticQualificationFailure("synthetic_qualification_record_invalid")
        by_index[index] = record
    ordered = [by_index[index] for index in range(1, FIXTURE_COUNT + 1)]
    try:
        baseline = json.loads(BASELINE_PATH.read_text(encoding="ascii"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SyntheticQualificationFailure("synthetic_qualification_baseline_invalid") from error
    baseline_by_class = {
        item["documentClass"]: item["current"]
        for item in baseline.get("byClass", [])
        if isinstance(item, dict) and isinstance(item.get("documentClass"), str) and isinstance(item.get("current"), dict)
    }
    classes = sorted({document_class for fixture in fixtures for document_class in fixture.document_classes})
    class_results: list[JsonObject] = []
    for document_class in classes:
        class_records = [
            ordered[fixture.fixture_index - 1]
            for fixture in fixtures
            if document_class in fixture.document_classes
        ]
        current = baseline_by_class.get(document_class)
        if not isinstance(current, dict):
            raise SyntheticQualificationFailure("synthetic_qualification_baseline_invalid")
        nvidia = _aggregate_metrics(class_records)
        class_results.append(
            {
                "documentClass": document_class,
                "fixtureCount": len(class_records),
                "current": current,
                "nvidia": nvidia,
                "successfulNvidiaFixtures": sum(record.get("status") == "success" for record in class_records),
                "catastrophicErrors": sorted(
                    {
                        error
                        for record in class_records
                        for error in record.get("catastrophicErrors", [])
                        if isinstance(error, str)
                    }
                ),
                "recommendation": _recommend_class(document_class, current, nvidia, class_records),
            }
        )
    successful_latencies = [
        int(record["latencyMs"])
        for record in ordered
        if record.get("status") == "success" and isinstance(record.get("latencyMs"), int)
    ]
    failure_codes = Counter(str(record.get("failureCode")) for record in ordered if record.get("failureCode"))
    provider_calls = sum(int(record.get("providerCalls", 0)) for record in ordered)
    nvidia_aggregate = _aggregate_metrics(ordered)
    recommendations = {item["recommendation"] for item in class_results}
    global_pass = recommendations <= {"QUALIFIED FOR SPECIALIST PILOT", "QUALIFIED FOR CONDITIONAL FALLBACK"}
    return {
        "benchmarkVersion": BENCHMARK_VERSION,
        "qualificationContractVersion": SYNTHETIC_CONTRACT_VERSION,
        "fixtureSourceCommit": FIXTURE_SOURCE_COMMIT,
        "syntheticOnly": True,
        "fixtureCount": FIXTURE_COUNT,
        "pageCount": PAGE_COUNT,
        "providerCalls": {
            "attempted": provider_calls,
            "succeeded": sum(int(record.get("providerCalls", 0)) for record in ordered if record.get("status") == "success"),
            "authenticationFailures": failure_codes.get("provider_authentication_failed", 0),
            "timeouts": failure_codes.get("provider_timeout", 0),
            "retries": sum(int(record.get("retryCount", 0)) for record in ordered),
            "ambiguousDispatches": failure_codes.get("provider_dispatch_ambiguous", 0),
            "latencyMs": {
                "p50": _percentile(successful_latencies, 0.5),
                "p95": _percentile(successful_latencies, 0.95),
                "p99": _percentile(successful_latencies, 0.99),
            },
        },
        "reliability": {
            "rendererFailures": sum(code.startswith("renderer_") for code in failure_codes.elements()),
            "responseValidationFailures": sum(code.startswith("provider_") and "malformed" in code for code in failure_codes.elements()),
            "normalizationFailures": failure_codes.get("normalized_output_empty", 0),
            "encryptionFailures": failure_codes.get("encryption_failed", 0),
            "cacheResults": {"storedForReview": sum(record.get("status") == "success" for record in ordered)},
        },
        "nvcf": {
            "assetPageCalls": sum(
                mode == "nvcf_asset_reference"
                for record in ordered
                for mode in record.get("payloadModes", [])
            ),
            "cleanupFailures": failure_codes.get("provider_asset_cleanup_failed", 0),
        },
        "currentAggregate": baseline.get("currentAggregate"),
        "nvidiaAggregate": nvidia_aggregate,
        "byClass": class_results,
        "adoptionGate": "passed" if global_pass else "failed",
        "cost": {"authoritativePricingAvailable": False, "estimatedCostUsd": None},
        "authorityBoundary": {
            "productionEnabled": False,
            "activeIngestionChanged": False,
            "writesBusinessMemory": False,
            "writesKpis": False,
            "entersSnapshot": False,
            "changesBusinessHealth": False,
            "rawContentInTelemetry": False,
            "requiresHumanReview": True,
        },
    }


def _load_records(path: Path) -> list[JsonObject]:
    records: list[JsonObject] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("event") == "document_extraction_synthetic_fixture_v1":
            records.append(value)
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("verify")
    aggregate = subparsers.add_parser("aggregate")
    aggregate.add_argument("log_file", type=Path)
    arguments = parser.parse_args()
    if arguments.command == "verify":
        corpus = load_frozen_corpus()
        result = {
            "ok": True,
            "benchmarkVersion": BENCHMARK_VERSION,
            "sourceCommit": FIXTURE_SOURCE_COMMIT,
            "fixtureCount": len(corpus),
            "pageCount": sum(len(fixture.rendered_page_paths) for fixture in corpus),
            "providerPageCallBound": sum(len(fixture.rendered_page_paths) for fixture in corpus if fixture.provider_eligible),
        }
    else:
        result = aggregate_synthetic_records(_load_records(arguments.log_file))
    print(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
