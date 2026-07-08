import "server-only";

export const MAX_UPLOAD_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export const ALLOWED_UPLOAD_EXTENSIONS = ["csv", "xlsx", "pdf", "png", "jpg", "jpeg", "docx"] as const;

export type AllowedUploadExtension = (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];

const DANGEROUS_EXTENSIONS = new Set([
  "app",
  "bat",
  "bin",
  "cmd",
  "com",
  "cpl",
  "dmg",
  "dll",
  "exe",
  "gadget",
  "hta",
  "jar",
  "js",
  "jse",
  "msi",
  "pkg",
  "ps1",
  "scr",
  "sh",
  "vbe",
  "vbs",
  "wsf",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz"
]);

const MIME_BY_EXTENSION: Record<AllowedUploadExtension, string[]> = {
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

function cleanExtension(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function fileExtension(name: string) {
  const parts = String(name || "").split(".");
  return cleanExtension(parts.length > 1 ? parts.pop() || "" : "");
}

function fileNameParts(name: string) {
  return String(name || "")
    .split(".")
    .map(cleanExtension)
    .filter(Boolean);
}

function hasDangerousCompoundExtension(name: string, finalExtension: string) {
  return fileNameParts(name).some((part, index, parts) => {
    const isFinalPart = index === parts.length - 1 && part === finalExtension;
    return !isFinalPart && DANGEROUS_EXTENSIONS.has(part);
  });
}

function hasMagicSignature(extension: AllowedUploadExtension, buffer: Buffer) {
  if (!buffer.length) return false;

  if (extension === "pdf") return buffer.subarray(0, 4).toString("utf8") === "%PDF";
  if (extension === "png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === "jpg" || extension === "jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === "xlsx" || extension === "docx") return buffer[0] === 0x50 && buffer[1] === 0x4b;

  return true;
}

function looksLikePlainText(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  if (!sample.length) return false;

  let controlCharacters = 0;
  for (const byte of sample) {
    const allowedWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (byte < 0x20 && !allowedWhitespace) {
      controlCharacters += 1;
    }
  }

  return controlCharacters / sample.length < 0.02;
}

function isAllowedExtension(value: string): value is AllowedUploadExtension {
  return (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(value);
}

export function preferredMimeType(extension: AllowedUploadExtension) {
  return MIME_BY_EXTENSION[extension][0];
}

export function normalizeStoredExtension(extension: AllowedUploadExtension) {
  return extension === "jpeg" ? "jpg" : extension;
}

export function validateUploadFileSafety({
  fileName,
  browserMimeType,
  size,
  buffer
}: {
  fileName: string;
  browserMimeType: string;
  size: number;
  buffer: Buffer;
}) {
  if (size <= 0) {
    return { ok: false as const, error: "Choose a file to upload." };
  }

  if (size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return { ok: false as const, error: "Files must be 25 MB or smaller." };
  }

  const extension = fileExtension(fileName);

  if (!extension || !isAllowedExtension(extension)) {
    return { ok: false as const, error: "Supported file types are CSV, XLSX, PDF, PNG, JPG, and DOCX." };
  }

  if (DANGEROUS_EXTENSIONS.has(extension) || hasDangerousCompoundExtension(fileName, extension)) {
    return { ok: false as const, error: "This file type is not allowed for security reasons." };
  }

  const normalizedMimeType = String(browserMimeType || "").toLowerCase().trim();
  const allowedMimeTypes = MIME_BY_EXTENSION[extension];

  if (normalizedMimeType && !allowedMimeTypes.includes(normalizedMimeType)) {
    return { ok: false as const, error: `The file extension and file type do not match. Upload a valid ${extension.toUpperCase()} file.` };
  }

  if (extension === "csv" && !looksLikePlainText(buffer)) {
    return { ok: false as const, error: `Upload a readable ${extension.toUpperCase()} text file.` };
  }

  if (extension !== "csv" && !hasMagicSignature(extension, buffer)) {
    return { ok: false as const, error: `Upload a valid ${extension.toUpperCase()} file. The file contents did not match the selected type.` };
  }

  return {
    ok: true as const,
    extension,
    storedExtension: normalizeStoredExtension(extension),
    mimeType: normalizedMimeType || preferredMimeType(extension)
  };
}
