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
  columns: string[];
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
  const counts = new Map<string, number>();

  return headerRow.map((value, index) => {
    const header = cleanHeader(value, index);
    const count = (counts.get(header) || 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header} (${count})`;
  });
}

function recordsFromNumberedGrid(grid: NumberedGridRow[]) {
  const nonEmptyRows = grid.filter(({ cells }) => cells.some((cell) => cell !== null && String(cell).trim() !== ""));
  const headerRow = nonEmptyRows[0]?.cells || [];
  const headers = uniqueHeaders(headerRow);
  const dataRows = nonEmptyRows.slice(1);

  return {
    headers,
    rows: dataRows.map(({ rowNumber, cells }) => {
      const record: ImportRow = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? null;
      });

      return { rowNumber, values: record };
    })
  };
}

function rowsFromGrid(grid: ImportCellValue[][]) {
  return recordsFromNumberedGrid(grid.map((cells, index) => ({ rowNumber: index + 1, cells }))).rows.map((row) => row.values);
}

function parseCsvGrid(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

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
    } else if (character === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }

  row.push(cell.trim());
  rows.push(row);

  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textBetween(value: string, tag: string) {
  const match = value.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1]) : "";
}

function attr(value: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
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
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Spreadsheet file could not be read. Please export it again as CSV or XLSX.");
}

function readZipEntries(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, ZipEntry>();

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Spreadsheet file structure is not supported.");
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressedData : method === 8 ? inflateRawSync(compressedData) : null;

    if (data) {
      entries.set(name, { name, data });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function parseSharedStrings(xml: string) {
  return Array.from(xml.matchAll(/<si[\s\S]*?<\/si>/g)).map(([item]) => {
    const textParts = Array.from(item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => decodeXml(match[1]));
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
  if (!/<worksheet\b/.test(xml) || !/<\/worksheet>/.test(xml) || !/<sheetData\b/.test(xml)) {
    throw new Error("The worksheet XML is malformed or missing its sheet data section.");
  }

  const openingRowCount = Array.from(xml.matchAll(/<row\b/g)).length;
  const closingRowCount = Array.from(xml.matchAll(/<\/row>/g)).length;
  if (openingRowCount !== closingRowCount) {
    throw new Error("The worksheet XML contains an incomplete row and could not be parsed safely.");
  }

  return Array.from(xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)).map((rowMatch, rowIndex) => {
    const rowCells: ImportCellValue[] = [];
    let fallbackIndex = 0;

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const cellAttributes = cellMatch[1];
      const cellXml = cellMatch[2];
      const index = columnIndex(attr(cellAttributes, "r"), fallbackIndex);
      rowCells[index] = parseCellValue(cellAttributes, cellXml, sharedStrings);
      fallbackIndex = index + 1;
    }

    const parsedRowNumber = Number(attr(rowMatch[1], "r"));
    return {
      rowNumber: Number.isInteger(parsedRowNumber) && parsedRowNumber > 0 ? parsedRowNumber : rowIndex + 1,
      cells: rowCells
    };
  });
}

function normalizedWorksheetTarget(target: string) {
  const withoutLeadingSlash = target.replace(/^\//, "");
  const withWorkbookDirectory = withoutLeadingSlash.startsWith("xl/") ? withoutLeadingSlash : `xl/${withoutLeadingSlash}`;
  const segments: string[] = [];

  for (const segment of withWorkbookDirectory.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }

  return segments.join("/");
}

function workbookRelationships(xml: string) {
  const relationships = new Map<string, { target: string; type: string }>();

  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const id = attr(match[1], "Id");
    const target = attr(match[1], "Target");
    if (id && target) {
      relationships.set(id, { target: normalizedWorksheetTarget(target), type: attr(match[1], "Type") });
    }
  }

  return relationships;
}

export function parseXlsxWorkbookEntries(entries: Map<string, ZipEntry>): SpreadsheetWorkbook {
  const workbookEntry = entries.get("xl/workbook.xml");
  const relationshipEntry = entries.get("xl/_rels/workbook.xml.rels");

  if (!workbookEntry || !relationshipEntry) {
    throw new Error("The XLSX workbook index is missing. Please export the workbook again as XLSX.");
  }

  const workbookXml = workbookEntry.data.toString("utf8");
  const relationships = workbookRelationships(relationshipEntry.data.toString("utf8"));
  const sharedStringsXml = entries.get("xl/sharedStrings.xml")?.data.toString("utf8") || "";
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const worksheets: SpreadsheetWorksheet[] = [];
  const issues: SpreadsheetParseIssue[] = [];
  const sheetMatches = Array.from(workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g));

  if (!sheetMatches.length) {
    throw new Error("No worksheets were declared in this XLSX workbook.");
  }

  sheetMatches.forEach((sheetMatch, index) => {
    const attributes = sheetMatch[1];
    const name = attr(attributes, "name") || `Worksheet ${index + 1}`;
    const state = attr(attributes, "state") || "visible";
    const relationshipId = attr(attributes, "r:id");
    const relationship = relationships.get(relationshipId);
    const issueBase = { worksheet: name, worksheetIndex: index + 1 };

    if (!relationship) {
      const message = "The worksheet relationship is missing from the workbook index.";
      worksheets.push({ name, index: index + 1, state, columns: [], rows: [], status: "failed", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    if (!relationship.type.endsWith("/worksheet")) {
      const message = "This workbook tab is not a standard worksheet and cannot be imported.";
      worksheets.push({ name, index: index + 1, state, columns: [], rows: [], status: "unsupported", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    const worksheetEntry = entries.get(relationship.target);
    if (!worksheetEntry) {
      const message = `The worksheet data file (${relationship.target}) is missing.`;
      worksheets.push({ name, index: index + 1, state, columns: [], rows: [], status: "failed", error: message });
      issues.push({ stage: "worksheet_detection", ...issueBase, message });
      return;
    }

    try {
      const parsed = recordsFromNumberedGrid(parseSheetRows(worksheetEntry.data.toString("utf8"), sharedStrings));
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
        columns: parsed.headers,
        rows,
        status: rows.length ? "parsed" : "empty"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Worksheet rows could not be parsed.";
      worksheets.push({ name, index: index + 1, state, columns: [], rows: [], status: "failed", error: message });
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
  return rowsFromGrid(parseCsvGrid(content.replace(/^\uFEFF/, "")));
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
    const parsedRows = parseCsvRows(buffer.toString("utf8"));
    const rows = parsedRows.map((values, index) => ({
      worksheetName: "CSV",
      worksheetIndex: 1,
      worksheetRowNumber: index + 2,
      values
    }));
    return {
      rows,
      worksheets: [{
        name: "CSV",
        index: 1,
        state: "visible",
        columns: Object.keys(parsedRows[0] || {}),
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
