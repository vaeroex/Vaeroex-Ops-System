import { inflateRawSync, inflateSync } from "zlib";

type ZipEntry = {
  name: string;
  data: Buffer;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function cleanExtractedText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("DOCX file could not be read. Please export it again and upload the new file.");
}

function readZipEntries(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, ZipEntry>();

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("DOCX file structure is not supported.");
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

function wordXmlToText(xml: string) {
  return cleanExtractedText(
    decodeXml(
      xml
        .replace(/<w:tab\b[^>]*\/>/g, "\t")
        .replace(/<w:br\b[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<\/w:tc>/g, "\t")
        .replace(/<[^>]+>/g, "")
    )
  );
}

export function extractDocxText(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const documentPaths = [
    "word/document.xml",
    ...Array.from(entries.keys()).filter((name) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(name))
  ];
  const parts = documentPaths
    .map((path) => entries.get(path)?.data.toString("utf8") || "")
    .filter(Boolean)
    .map(wordXmlToText)
    .filter(Boolean);

  return cleanExtractedText(parts.join("\n\n"));
}

function utf16BeToString(buffer: Buffer, start = 0) {
  const codeUnits: number[] = [];

  for (let index = start; index + 1 < buffer.length; index += 2) {
    codeUnits.push(buffer.readUInt16BE(index));
  }

  return String.fromCharCode(...codeUnits);
}

function decodePdfHexString(value: string) {
  const cleaned = value.replace(/[^0-9a-f]/gi, "");
  const padded = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`;
  const buffer = Buffer.from(padded, "hex");

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return utf16BeToString(buffer, 2);
  }

  const utf8 = buffer.toString("utf8");
  return utf8.includes("\uFFFD") ? buffer.toString("latin1") : utf8;
}

function decodePdfLiteralString(value: string) {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== "\\") {
      output += character;
      continue;
    }

    const next = value[index + 1];

    if (next === undefined) {
      continue;
    }

    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (next === "\r" || next === "\n") {
      if (next === "\r" && value[index + 2] === "\n") {
        index += 1;
      }
    } else if (/[0-7]/.test(next)) {
      const octal = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] || next;
      output += String.fromCharCode(parseInt(octal, 8));
      index += octal.length - 1;
    } else {
      output += next;
    }

    index += 1;
  }

  return output;
}

function extractPdfStrings(value: string) {
  const strings: string[] = [];

  for (const match of value.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
    strings.push(decodePdfLiteralString(match[1]));
  }

  for (const match of value.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
    strings.push(decodePdfHexString(match[1]));
  }

  return strings;
}

function extractPdfTextOperators(content: string) {
  const pieces: string[] = [];
  const blocks = content.match(/BT[\s\S]*?ET/g) || [content];

  for (const block of blocks) {
    for (const match of block.matchAll(/\[((?:.|\n)*?)\]\s*TJ/g)) {
      pieces.push(...extractPdfStrings(match[1]));
    }

    for (const match of block.matchAll(/(\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)\s*(?:Tj|'|")/g)) {
      pieces.push(...extractPdfStrings(match[1]));
    }
  }

  return cleanExtractedText(pieces.join(" "));
}

function trimPdfStreamBoundaries(buffer: Buffer) {
  let start = 0;
  let end = buffer.length;

  if (buffer[start] === 13 && buffer[start + 1] === 10) {
    start = 2;
  } else if (buffer[start] === 10) {
    start = 1;
  }

  while (end > start && (buffer[end - 1] === 10 || buffer[end - 1] === 13)) {
    end -= 1;
  }

  return buffer.subarray(start, end);
}

function decodePdfStream(header: string, rawStream: string) {
  const streamBuffer = trimPdfStreamBoundaries(Buffer.from(rawStream, "latin1"));

  if (!/\/FlateDecode\b/.test(header)) {
    return streamBuffer.toString("latin1");
  }

  try {
    return inflateSync(streamBuffer).toString("latin1");
  } catch {
    try {
      return inflateRawSync(streamBuffer).toString("latin1");
    } catch {
      return "";
    }
  }
}

export function extractPdfText(buffer: Buffer) {
  const content = buffer.toString("latin1");
  const pieces: string[] = [];

  for (const match of content.matchAll(/<<(?:.|\n|\r)*?>>\s*stream((?:.|\n|\r)*?)endstream/g)) {
    const fullMatch = match[0];
    const streamBody = match[1];
    const header = fullMatch.slice(0, fullMatch.indexOf("stream"));
    const decoded = decodePdfStream(header, streamBody);
    const text = decoded ? extractPdfTextOperators(decoded) : "";

    if (text) {
      pieces.push(text);
    }
  }

  if (!pieces.length) {
    const fallback = extractPdfTextOperators(content);

    if (fallback) {
      pieces.push(fallback);
    }
  }

  return cleanExtractedText(pieces.join("\n\n"));
}
