import "server-only";

import { readFile } from "fs/promises";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";
import type { WorkspaceAgreementSnapshot } from "@/lib/legal/workspace-agreement";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const NAVY = rgb(0.025, 0.067, 0.12);
const CYAN = rgb(0.05, 0.65, 0.8);
const INK = rgb(0.08, 0.12, 0.18);
const MUTED = rgb(0.34, 0.4, 0.48);
const LINE = rgb(0.82, 0.85, 0.89);

type FontSet = {
  regular: PDFFont;
  bold: PDFFont;
};

function splitLongWord(word: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const parts: string[] = [];
  let current = "";

  for (const character of word) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      parts.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.trim().split(/\s+/).flatMap((word) =>
      font.widthOfTextAtSize(word, fontSize) > maxWidth ? splitLongWord(word, font, fontSize, maxWidth) : [word]
    );
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) lines.push(line);
  }

  return lines;
}

function addPage(document: PDFDocument) {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 34, width: PAGE_WIDTH, height: 34, color: NAVY });
  return page;
}

function drawLines({
  page,
  lines,
  x,
  y,
  font,
  fontSize,
  lineHeight,
  color = INK
}: {
  page: PDFPage;
  lines: string[];
  x: number;
  y: number;
  font: PDFFont;
  fontSize: number;
  lineHeight: number;
  color?: ReturnType<typeof rgb>;
}) {
  let nextY = y;
  for (const line of lines) {
    if (line) page.drawText(line, { x, y: nextY, size: fontSize, font, color });
    nextY -= lineHeight;
  }
  return nextY;
}

export async function generateWorkspaceAgreementPdf({
  snapshot,
  immutableHash
}: {
  snapshot: WorkspaceAgreementSnapshot;
  immutableHash: string;
}) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(process.cwd(), "public", "fonts", "NotoSans-Regular.ttf")),
    readFile(path.join(process.cwd(), "public", "fonts", "NotoSans-Bold.ttf"))
  ]);
  const fonts: FontSet = {
    regular: await document.embedFont(regularBytes, { subset: true }),
    bold: await document.embedFont(boldBytes, { subset: true })
  };
  const signedDate = new Date(snapshot.signedAt);
  document.setTitle(`Vaeroex Workspace Agreement - ${snapshot.organizationName}`);
  document.setAuthor("Vaeroex LLC");
  document.setSubject("Electronically signed Vaeroex Workspace Agreement");
  document.setProducer("Vaeroex Executive Intelligence");
  document.setCreator(`Vaeroex ${snapshot.applicationVersion}`);
  document.setCreationDate(signedDate);
  document.setModificationDate(signedDate);

  let page = addPage(document);
  let y = PAGE_HEIGHT - 72;

  const ensureSpace = (height: number) => {
    if (y - height >= 58) return;
    page = addPage(document);
    y = PAGE_HEIGHT - 68;
  };

  const heading = (text: string, size = 13) => {
    ensureSpace(size + 18);
    page.drawText(text, { x: MARGIN, y, size, font: fonts.bold, color: NAVY });
    y -= size + 8;
  };

  const paragraph = (text: string, options: { size?: number; indent?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const size = options.size ?? 9.5;
    const indent = options.indent ?? 0;
    const lines = wrapText(text, fonts.regular, size, CONTENT_WIDTH - indent);
    const lineHeight = size + 4;
    ensureSpace(lines.length * lineHeight + 4);
    y = drawLines({ page, lines, x: MARGIN + indent, y, font: fonts.regular, fontSize: size, lineHeight, color: options.color });
    y -= 4;
  };

  page.drawText("VAEROEX", { x: MARGIN, y, size: 11, font: fonts.bold, color: CYAN });
  y -= 28;
  page.drawText("Workspace Agreement", { x: MARGIN, y, size: 24, font: fonts.bold, color: NAVY });
  y -= 24;
  paragraph("Electronically signed agreement for an Executive Intelligence Workspace.", { size: 10.5, color: MUTED });
  y -= 8;

  const details = [
    ["Organization", snapshot.organizationName],
    ["Workspace owner", `${snapshot.owner.legalName}, ${snapshot.owner.jobTitle}`],
    ["Owner email", snapshot.owner.businessEmail],
    ["Business type", snapshot.businessType],
    ["Team size", snapshot.teamSize || "Not provided"],
    ["Number of locations", snapshot.numberOfLocations || "Not provided"]
  ];

  for (const [label, value] of details) {
    ensureSpace(34);
    page.drawText(label, { x: MARGIN, y, size: 8.5, font: fonts.bold, color: MUTED });
    const lines = wrapText(value, fonts.regular, 10, CONTENT_WIDTH - 150);
    y = drawLines({ page, lines, x: MARGIN + 150, y, font: fonts.regular, fontSize: 10, lineHeight: 14 });
    y -= 5;
  }

  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.7, color: LINE });
  y -= 22;
  heading("Agreement", 15);

  snapshot.sections.forEach((section, index) => {
    const bodyHeight = wrapText(section.text, fonts.regular, 9.5, CONTENT_WIDTH).length * 13.5 + 4;
    const detailHeight = section.details.reduce(
      (height, detail) => height + wrapText(`- ${detail}`, fonts.regular, 9.5, CONTENT_WIDTH - 12).length * 13.5 + 4,
      0
    );
    ensureSpace(24 + bodyHeight + detailHeight + 5);
    heading(`${index + 1}. ${section.title}`, 11);
    paragraph(section.text);
    for (const detail of section.details) paragraph(`- ${detail}`, { indent: 12, color: MUTED });
    y -= 5;
  });

  heading("Electronic Signature", 15);
  paragraph(snapshot.signatureIntent);
  y -= 4;
  const signatureDetails = [
    ["Typed signature", snapshot.typedSignature],
    ["Signed at (UTC)", snapshot.signedAt],
    ["Agreement version", snapshot.agreementVersion],
    ["Terms version", snapshot.termsVersion],
    ["Privacy version", snapshot.privacyVersion],
    ["Agreement ID", snapshot.agreementId],
    ["Workspace ID", snapshot.workspaceId],
    ["Immutable SHA-256 hash", immutableHash]
  ];

  for (const [label, value] of signatureDetails) {
    ensureSpace(42);
    page.drawText(label, { x: MARGIN, y, size: 8.5, font: fonts.bold, color: MUTED });
    const lines = wrapText(value, fonts.regular, 9, CONTENT_WIDTH - 150);
    y = drawLines({ page, lines, x: MARGIN + 150, y, font: fonts.regular, fontSize: 9, lineHeight: 13 });
    y -= 6;
  }

  const pages = document.getPages();
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({ start: { x: MARGIN, y: 45 }, end: { x: PAGE_WIDTH - MARGIN, y: 45 }, thickness: 0.5, color: LINE });
    currentPage.drawText(`Vaeroex Workspace Agreement  |  ${snapshot.agreementId}`, {
      x: MARGIN,
      y: 28,
      size: 7,
      font: fonts.regular,
      color: MUTED
    });
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    currentPage.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(pageLabel, 7),
      y: 28,
      size: 7,
      font: fonts.regular,
      color: MUTED
    });
  });

  return Buffer.from(await document.save());
}
