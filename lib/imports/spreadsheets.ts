import { inflateRawSync } from "zlib";

export type ImportCellValue = string | number | null;
export type ImportRow = Record<string, ImportCellValue>;

export type SpreadsheetRow = {
  worksheetName: string;
  worksheetIndex: number;
  worksheetRowNumber: number;
  values: ImportRow;
};

export type SpreadsheetWorksheet = {
  name: string;
  index: number;
  state: string;
  relationshipId?: string;
  relationshipTarget?: string;
  columns: string[];
  columnSources?: Array<{ key: string; originalHeader: string; columnNumber: number }>;
  rows: SpreadsheetRow[];
  status: "parsed" | "empty" | "unsupported" | "failed";
  error?: string;
};

export type SpreadsheetParseIssue = {
  stage: "workbook_parsing" | "worksheet_detection" | "record_extraction";
  worksheet: string;
  worksheetIndex: number;
  message: string;
};

export type SpreadsheetWorkbook = {
  rows: SpreadsheetRow[];
  worksheets: SpreadsheetWorksheet[];
  issues: SpreadsheetParseIssue[];
};

type ZipEntry = {
  name: string;
  data: Buffer;
};

const MAX_ZIP_ENTRIES = 5_000;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_WORKSHEET_COUNT = 200;
const MAX_DECOMPRESSION_RATIO = 200;
const XML_NAME = "[A-Za-z_][A-Za-z0-9_.-]*";

function cleanHeader(value: ImportCellValue, index: number) {
  const fallback = `Column ${index + 1}`;
  const header = String(value ?? "").trim() || fallback;
  return header.length > 80 ? header.slice(0, 80) : header;
}

type NumberedGridRow = {
  rowNumber: number;
  cells: ImportCellValue[];
};

function uniqueHeaders(headerRow: ImportCellValue[]) {
  // Reserve source labels before allocating suffixes, so a duplicate cannot
  // consume a later column's original name (for example Amount (2)).
  const originals = headerRow.map(cleanHeader);
  const reserved = new Set(originals);
  const used = new Set<string>();

  return originals.map((header) => {
    let candidate = header;
    let suffix = 2;
    while (used.has(candidate)) {
      do {
        candidate = `${header} (${suffix++})`;
      } while (reserved.has(candidate));
    }
    used.add(candidate);
    return candidate;
  });
}

function recordsFromNumberedGrid(grid: NumberedGridRow[]) {
  const nonEmptyRows = grid.filter(({ cells }) => cells.some((cell) => cell !== null && String(cell).trim() !== ""));
  const headerRow = nonEmptyRows[0]?.cells || [];
  const headers = uniqueHeaders(headerRow);
  const dataRows = nonEmptyRows.slice(1);

  return {
    headers,
    columnSources: headers.map((key, index) => ({ key, originalHeader: String(headerRow[index] ?? ""), columnNumber: index + 1 })),
    rows: dataRows.map(({ rowNumber, cells }) => {
      const record: ImportRow = {};
      headers.forEach((header, index) => {
        Object.defineProperty(record, header, { value: cells[index] ?? null, enumerable: true, writable: true, configurable: true });
      });

      return { rowNumber, values: record };
    })
  };
}

function parseCsvGrid(content: string) {
  const rows: NumberedGridRow[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let physicalLine = 1;
  let recordStartLine = 1;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (character === "\n" || (character === "\r" && next !== "\n")) physicalLine += 1;

    if (inQuotes) {
      if (character === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (character === "\"") {
        inQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === "\"") {
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      row.push(cell.trim());
      rows.push({ rowNumber: recordStartLine, cells: row });
      row = [];
      cell = "";
      if (character === "\r" && next === "\n") {
        physicalLine += 1;
        index += 1;
      }
      recordStartLine = physicalLine;
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  rows.push({ rowNumber: recordStartLine, cells: row });

  // CSV row locations are physical start lines, including quoted multiline
  // records. Blank records are removed only after their locations are retained.
  return rows;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function qualifiedElement(localName: string) {
  return `(?:${XML_NAME}:)?${localName}`;
}

function openingElements(value: string, localName: string) {
  return Array.from(value.matchAll(new RegExp(`<${qualifiedElement(localName)}\\b([^<>]*)>`, "g")));
}

function pairedElements(value: string, localName: string) {
  return Array.from(value.matchAll(new RegExp(`<(${qualifiedElement(localName)})\\b([^<>]*)>([\\s\\S]*?)<\\/\\1\\s*>`, "g")));
}

function selfClosingElements(value: string, localName: string) {
  return Array.from(value.matchAll(new RegExp(`<${qualifiedElement(localName)}\\b([^<>]*)\\/\\s*>`, "g")));
}

function elementStartCount(value: string, localName: string) {
  return Array.from(value.matchAll(new RegExp(`<${qualifiedElement(localName)}\\b`, "g"))).length;
}

function textBetween(value: string, tag: string) {
  const match = pairedElements(value, tag)[0];
  return match ? decodeXml(match[3]) : "";
}

function attr(value: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return match ? decodeXml(match[1] ?? match[2] ?? "") : "";
}

function attrByLocalName(value: string, localName: string) {
  const escapedName = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`(?:^|\\s)(?:${XML_NAME}:)?${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return match ? decodeXml(match[1] ?? match[2] ?? "") : "";
}

function xmlText(entry: ZipEntry, label: string) {
  if (entry.data.length > MAX_XML_BYTES) {
    throw new Error(`${label} is too large to process safely.`);
  }

  return entry.data.toString("utf8").replace(/^\uFEFF/, "");
}

function rejectUnsafeXml(xml: string, label: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(`${label} contains unsupported XML declarations.`);
  }
}

function columnIndex(cellReference: string, fallback: number) {
  const letters = cellReference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();

  if (!letters) {
    return fallback;
  }

  return letters.split("").reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      return offset;
    }
  }

  throw new Error("Spreadsheet file could not be read. Please export it again as CSV or XLSX.");
}

function readZipEntries(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new Error("Encrypted XLSX workbooks are not supported.");
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const directoryEnd = offset + buffer.readUInt32LE(eocdOffset + 12);
  const entries = new Map<string, ZipEntry>();
  let totalUncompressedBytes = 0;
  let totalExpandedBytes = 0;

  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error("The XLSX package contains too many files to process safely.");
  }
  if (buffer.readUInt16LE(eocdOffset + 4) !== 0 || buffer.readUInt16LE(eocdOffset + 6) !== 0 ||
      buffer.readUInt16LE(eocdOffset + 8) !== entryCount || directoryEnd !== eocdOffset) {
    throw new Error("Spreadsheet file structure is not supported.");
  }

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (offset + 46 > directoryEnd || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Spreadsheet file structure is not supported.");
    }

    const method = buffer.readUInt16LE(offset + 10);
    const flags = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const pathSegments = name.replace(/\\/g, "/").split("/");

    if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || pathSegments.includes("..")) {
      throw new Error("The XLSX package contains an unsafe file path.");
    }
    if (entries.has(name)) {
      throw new Error("The XLSX package contains duplicate file entries.");
    }
    if (method !== 0 && method !== 8) {
      throw new Error("The XLSX package uses an unsupported compression method.");
    }
    if (flags & 1) throw new Error("Encrypted XLSX workbooks are not supported.");
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new Error("The XLSX package contains an oversized file entry.");
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw new Error("The XLSX package expands beyond the safe processing limit.");
    }
    if (compressedSize > 0 && uncompressedSize > 1024 * 1024 && uncompressedSize / compressedSize > MAX_DECOMPRESSION_RATIO) {
      throw new Error("The XLSX package has an unsafe decompression ratio.");
    }
    if (localHeaderOffset + 30 > offset || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error("Spreadsheet file structure is not supported.");
    }

    if (offset + 46 + fileNameLength + extraLength + commentLength > directoryEnd) {
      throw new Error("Spreadsheet file structure is not supported.");
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const localName = buffer.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength).toString("utf8");
    if (localName !== name || buffer.readUInt16LE(localHeaderOffset + 8) !== method ||
        buffer.readUInt16LE(localHeaderOffset + 6) !== flags ||
        (!(flags & 8) && (buffer.readUInt32LE(localHeaderOffset + 18) !== compressedSize || buffer.readUInt32LE(localHeaderOffset + 22) !== uncompressedSize))) {
      throw new Error("The XLSX package contains inconsistent file headers.");
    }
    if (dataStart + compressedSize > buffer.readUInt32LE(eocdOffset + 16) || (compressedSize === 0 && uncompressedSize > 0)) {
      throw new Error("The XLSX package contains an incomplete file entry.");
    }
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
    let expanded: Buffer | undefined;
    // Inflate only parts consumed by the workbook parser. Enforce actual output
    // size inside zlib; untrusted declared sizes are never allocation authority.
    entries.set(name, { name, get data() {
      if (expanded) return expanded;
      const maxOutputLength = Math.max(1, Math.min(uncompressedSize, MAX_XML_BYTES, MAX_XLSX_UNCOMPRESSED_BYTES - totalExpandedBytes));
      if (uncompressedSize > MAX_XML_BYTES || totalExpandedBytes + uncompressedSize > MAX_XLSX_UNCOMPRESSED_BYTES) {
        throw new Error("The XLSX package expands beyond the safe processing limit.");
      }
      try {
        expanded = method === 0 ? compressedData : inflateRawSync(compressedData, { maxOutputLength });
      } catch {
        throw new Error("The XLSX package contains an invalid or oversized compressed entry.");
      }
      if (expanded.length !== uncompressedSize) throw new Error("The XLSX package contains an incomplete file entry.");
      totalExpandedBytes += expanded.length;
      return expanded;
    } });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  if (offset !== directoryEnd) throw new Error("Spreadsheet file structure is not supported.");

  return entries;
}

function parseSharedStrings(xml: string) {
  rejectUnsafeXml(xml, "The XLSX shared string table");
  const hasStringTable = pairedElements(xml, "sst").length || selfClosingElements(xml, "sst").length;
  if (!hasStringTable) throw new Error("The XLSX shared string table is malformed.");

  return pairedElements(xml, "si").map((item) => {
    const textParts = pairedElements(item[3], "t").map((match) => decodeXml(match[3]));
    return textParts.join("");
  });
}

function parseCellValue(cellAttributes: string, cellXml: string, sharedStrings: string[]): ImportCellValue {
  const type = attr(cellAttributes, "t");

  if (type === "inlineStr") {
    return textBetween(cellXml, "t").trim();
  }

  const rawValue = textBetween(cellXml, "v");

  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  if (type === "str") {
    return rawValue.trim();
  }

  if (!rawValue.trim()) {
    return null;
  }

  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : rawValue.trim();
}

function parseSheetRows(xml: string, sharedStrings: string[]) {
  rejectUnsafeXml(xml, "The worksheet XML");
  const worksheet = pairedElements(xml, "worksheet")[0];
  if (!worksheet) {
    throw new Error("The worksheet XML is malformed or missing its sheet data section.");
  }

  const sheetData = pairedElements(worksheet[3], "sheetData")[0];
  if (!sheetData) {
    if (selfClosingElements(worksheet[3], "sheetData").length) return [];
    throw new Error("The worksheet XML is malformed or missing its sheet data section.");
  }

  const openingRowCount = openingElements(sheetData[3], "row").length;
  const rowMatches = pairedElements(sheetData[3], "row");
  const selfClosingRowCount = selfClosingElements(sheetData[3], "row").length;
  if (openingRowCount !== rowMatches.length + selfClosingRowCount) {
    throw new Error("The worksheet XML contains an incomplete row and could not be parsed safely.");
  }

  return rowMatches.map((rowMatch, rowIndex) => {
    const rowCells: ImportCellValue[] = [];
    let fallbackIndex = 0;

    const cellMatches = pairedElements(rowMatch[3], "c");
    const selfClosingCellCount = selfClosingElements(rowMatch[3], "c").length;
    if (elementStartCount(rowMatch[3], "c") !== cellMatches.length + selfClosingCellCount) {
      throw new Error("The worksheet XML contains an incomplete cell and could not be parsed safely.");
    }

    for (const cellMatch of cellMatches) {
      const cellAttributes = cellMatch[2];
      const cellXml = cellMatch[3];
      const index = columnIndex(attr(cellAttributes, "r"), fallbackIndex);
      rowCells[index] = parseCellValue(cellAttributes, cellXml, sharedStrings);
      fallbackIndex = index + 1;
    }

    const parsedRowNumber = Number(attr(rowMatch[2], "r"));
    return {
      rowNumber: Number.isInteger(parsedRowNumber) && parsedRowNumber > 0 ? parsedRowNumber : rowIndex + 1,
      cells: rowCells
    };
  });
}

function normalizedWorksheetTarget(target: string) {
  const normalized = target.replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.includes("?") || normalized.includes("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalized)) {
    return null;
  }

  const withoutLeadingSlash = normalized.replace(/^\/+/, "");
  const path = normalized.startsWith("/") ? withoutLeadingSlash : `xl/${withoutLeadingSlash}`;
  const segments = path.split("/").filter((segment) => segment && segment !== ".");
  if (segments.includes("..") || segments[0] !== "xl") return null;
  return segments.join("/");
}

function workbookRelationships(xml: string) {
  rejectUnsafeXml(xml, "The XLSX workbook relationships XML");
  if (!pairedElements(xml, "Relationships").length && !selfClosingElements(xml, "Relationships").length) {
    throw new Error("The XLSX workbook relationships XML is malformed.");
  }

  const relationshipElements = openingElements(xml, "Relationship");
  if (elementStartCount(xml, "Relationship") !== relationshipElements.length) {
    throw new Error("The XLSX workbook relationships XML is malformed.");
  }

  const relationships = new Map<string, { target: string; type: string; targetMode: string }>();

  for (const match of relationshipElements) {
    const id = attr(match[1], "Id");
    const target = attr(match[1], "Target");
    if (id && target) {
      relationships.set(id, { target, type: attr(match[1], "Type"), targetMode: attr(match[1], "TargetMode") });
    }
  }

  return relationships;
}

export function parseXlsxWorkbookEntries(entries: Map<string, ZipEntry>): SpreadsheetWorkbook {
  const workbookEntry = entries.get("xl/workbook.xml");
  const relationshipEntry = entries.get("xl/_rels/workbook.xml.rels");

  if (!workbookEntry) throw new Error("The XLSX workbook XML is missing. Please export the workbook again as XLSX.");
  if (!relationshipEntry) throw new Error("The XLSX workbook relationships file is missing. Please export the workbook again as XLSX.");

  for (const name of entries.keys()) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "xl/vbaproject.bin" || normalizedName.startsWith("xl/embeddings/") || normalizedName.startsWith("xl/activex/")) {
      throw new Error("XLSX files containing macros or embedded objects are not supported.");
    }
  }

  const workbookXml = xmlText(workbookEntry, "The XLSX workbook XML");
  rejectUnsafeXml(workbookXml, "The XLSX workbook XML");
  const workbook = pairedElements(workbookXml, "workbook")[0];
  const sheets = workbook ? pairedElements(workbook[3], "sheets")[0] : null;
  const hasEmptySheets = workbook ? selfClosingElements(workbook[3], "sheets").length > 0 : false;
  if (!workbook || (!sheets && !hasEmptySheets)) throw new Error("The XLSX workbook XML is malformed.");

  const relationships = workbookRelationships(xmlText(relationshipEntry, "The XLSX workbook relationships XML"));
  const sharedStringsEntry = entries.get("xl/sharedStrings.xml");
  const sharedStringsXml = sharedStringsEntry ? xmlText(sharedStringsEntry, "The XLSX shared string table") : "";
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const worksheets: SpreadsheetWorksheet[] = [];
  const issues: SpreadsheetParseIssue[] = [];
  const sheetMatches = sheets ? openingElements(sheets[3], "sheet") : [];

  if (sheets && elementStartCount(sheets[3], "sheet") !== sheetMatches.length) {
    throw new Error("The XLSX workbook XML is malformed.");
  }

  if (!sheetMatches.length) {
    throw new Error("No worksheets were declared in this XLSX workbook.");
  }
  if (sheetMatches.length > MAX_WORKSHEET_COUNT) {
    throw new Error(`This XLSX workbook declares more than ${MAX_WORKSHEET_COUNT} worksheets and cannot be processed safely.`);
  }

  sheetMatches.forEach((sheetMatch, index) => {
    const attributes = sheetMatch[1];
    const name = attr(attributes, "name") || `Worksheet ${index + 1}`;
    const state = attr(attributes, "state") || "visible";
    const relationshipId = attrByLocalName(attributes, "id");
    const relationship = relationships.get(relationshipId);
    const issueBase = { worksheet: name, worksheetIndex: index + 1 };

    if (!relationship) {
      const message = "The worksheet relationship is missing from the workbook index.";
      worksheets.push({ name, index: index + 1, state, relationshipId, columns: [], rows: [], status: "failed", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    if (!relationship.type.endsWith("/worksheet")) {
      const message = "This workbook tab is not a standard worksheet and cannot be imported.";
      worksheets.push({ name, index: index + 1, state, relationshipId, columns: [], rows: [], status: "unsupported", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    if (relationship.targetMode.toLowerCase() === "external") {
      const message = "External worksheet relationships are not supported.";
      worksheets.push({ name, index: index + 1, state, relationshipId, columns: [], rows: [], status: "failed", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    const relationshipTarget = normalizedWorksheetTarget(relationship.target);
    if (!relationshipTarget) {
      const message = "The worksheet relationship target is unsafe or outside the XLSX package.";
      worksheets.push({ name, index: index + 1, state, relationshipId, columns: [], rows: [], status: "failed", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    const worksheetEntry = entries.get(relationshipTarget);
    if (!worksheetEntry) {
      const message = `The worksheet data file (${relationshipTarget}) is missing.`;
      worksheets.push({ name, index: index + 1, state, relationshipId, relationshipTarget, columns: [], rows: [], status: "failed", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    try {
      const parsed = recordsFromNumberedGrid(parseSheetRows(xmlText(worksheetEntry, `Worksheet ${name}`), sharedStrings));
      const rows = parsed.rows.map((row) => ({
        worksheetName: name,
        worksheetIndex: index + 1,
        worksheetRowNumber: row.rowNumber,
        values: row.values
      }));
      worksheets.push({
        name,
        index: index + 1,
        state,
        relationshipId,
        relationshipTarget,
        columns: parsed.headers,
        columnSources: parsed.columnSources,
        rows,
        status: rows.length ? "parsed" : "empty"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Worksheet rows could not be parsed.";
      worksheets.push({ name, index: index + 1, state, relationshipId, relationshipTarget, columns: [], rows: [], status: "failed", error: message });
      issues.push({ stage: "record_extraction", ...issueBase, message });
    }
  });

  return {
    worksheets,
    rows: worksheets.flatMap((worksheet) => worksheet.rows),
    issues
  };
}

export function parseCsvRows(content: string) {
  return recordsFromNumberedGrid(parseCsvGrid(content.replace(/^\uFEFF/, ""))).rows.map((row) => row.values);
}

export function parseXlsxRows(buffer: Buffer) {
  return parseXlsxWorkbookEntries(readZipEntries(buffer)).rows.map((row) => row.values);
}

export function parseSpreadsheetWorkbook({
  fileName,
  buffer
}: {
  fileName: string;
  buffer: Buffer;
}): SpreadsheetWorkbook {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    const parsed = recordsFromNumberedGrid(parseCsvGrid(buffer.toString("utf8").replace(/^\uFEFF/, "")));
    const rows = parsed.rows.map(({ values, rowNumber }) => ({
      worksheetName: "CSV",
      worksheetIndex: 1,
      worksheetRowNumber: rowNumber,
      values
    }));
    return {
      rows,
      worksheets: [{
        name: "CSV",
        index: 1,
        state: "visible",
        columns: parsed.headers,
        columnSources: parsed.columnSources,
        rows,
        status: rows.length ? "parsed" : "empty"
      }],
      issues: []
    };
  }

  if (lowerName.endsWith(".xlsx")) {
    return parseXlsxWorkbookEntries(readZipEntries(buffer));
  }

  throw new Error("Only CSV and XLSX files can be imported or analyzed right now.");
}

export function parseSpreadsheetRows({
  fileName,
  buffer
}: {
  fileName: string;
  buffer: Buffer;
}) {
  return parseSpreadsheetWorkbook({ fileName, buffer }).rows.map((row) => row.values);
}

export function previewRows(rows: ImportRow[], limit = 20) {
  return rows.slice(0, limit).map((row, index) => ({
    row_number: index + 1,
    values: row
  }));
}
