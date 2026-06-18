import { inflateRawSync } from "zlib";

export type ImportCellValue = string | number | null;
export type ImportRow = Record<string, ImportCellValue>;

type ZipEntry = {
  name: string;
  data: Buffer;
};

function cleanHeader(value: ImportCellValue, index: number) {
  const fallback = `Column ${index + 1}`;
  const header = String(value ?? "").trim() || fallback;
  return header.length > 80 ? header.slice(0, 80) : header;
}

function rowsFromGrid(grid: ImportCellValue[][]) {
  const nonEmptyRows = grid.filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  const headerRow = nonEmptyRows[0] || [];
  const headers = headerRow.map(cleanHeader);
  const dataRows = nonEmptyRows.slice(1);

  return dataRows.map((row) => {
    const record: ImportRow = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? null;
    });
    return record;
  });
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
  const match = value.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : "";
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
  return Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
    const rowCells: ImportCellValue[] = [];
    let fallbackIndex = 0;

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const cellAttributes = cellMatch[1];
      const cellXml = cellMatch[2];
      const index = columnIndex(attr(cellAttributes, "r"), fallbackIndex);
      rowCells[index] = parseCellValue(cellAttributes, cellXml, sharedStrings);
      fallbackIndex = index + 1;
    }

    return rowCells;
  });
}

export function parseCsvRows(content: string) {
  return rowsFromGrid(parseCsvGrid(content.replace(/^\uFEFF/, "")));
}

export function parseXlsxRows(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const sharedStringsXml = entries.get("xl/sharedStrings.xml")?.data.toString("utf8") || "";
  const worksheetEntry =
    entries.get("xl/worksheets/sheet1.xml") ||
    Array.from(entries.values()).find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name));

  if (!worksheetEntry) {
    throw new Error("No worksheet was found in this XLSX file.");
  }

  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  return rowsFromGrid(parseSheetRows(worksheetEntry.data.toString("utf8"), sharedStrings));
}

export function parseSpreadsheetRows({
  fileName,
  buffer
}: {
  fileName: string;
  buffer: Buffer;
}) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    return parseCsvRows(buffer.toString("utf8"));
  }

  if (lowerName.endsWith(".xlsx")) {
    return parseXlsxRows(buffer);
  }

  throw new Error("Only CSV and XLSX files can be imported or analyzed right now.");
}

export function previewRows(rows: ImportRow[], limit = 20) {
  return rows.slice(0, limit).map((row, index) => ({
    row_number: index + 1,
    values: row
  }));
}
