import type { ReactNode } from "react";

type AnswerBlock = { kind: "heading" | "paragraph" | "code"; text: string } | { kind: "ordered" | "unordered"; items: string[] };
const headingPattern = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const listPattern = /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

/** Parse structural lines before blank lines so fenced text stays intact. */
function answerBlocks(content: string): AnswerBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n"), blocks: AnswerBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = line.match(fencePattern);
    if (fence) {
      index++;
      const code: string[] = [];
      while (index < lines.length) {
        const closing = lines[index].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (closing && closing[1][0] === fence[1][0] && closing[1].length >= fence[1].length) { index++; break; }
        code.push(lines[index++]);
      }
      blocks.push({ kind: "code", text: code.join("\n") }); continue;
    }
    const heading = line.match(headingPattern);
    if (heading) {
      blocks.push({ kind: "heading", text: (heading[1] || "").replace(/[ \t]+#+[ \t]*$/, "") }); index++; continue;
    }
    const list = line.match(listPattern);
    if (list) {
      const ordered = /^\d/.test(list[1]), items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(listPattern);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(item[2]); index++;
      }
      blocks.push({ kind: ordered ? "ordered" : "unordered", items }); continue;
    }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !headingPattern.test(lines[index]) && !fencePattern.test(lines[index]) && !listPattern.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

/** Small, text-only renderer: never renders model HTML or model-selected URLs. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-slate-100 px-1 text-[0.92em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

export function AnswerContent({ content }: { content: string }) {
  return <div className="space-y-3 break-words text-sm leading-7 text-slate-800 [overflow-wrap:anywhere]">
    {answerBlocks(content).map((block, index) => {
      if (block.kind === "code") return <pre key={index} className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs leading-6"><code>{block.text}</code></pre>;
      if (block.kind === "heading") return <h3 key={index} className="font-semibold text-slate-900">{inline(block.text)}</h3>;
      if (block.kind === "unordered") return <ul key={index} className="list-disc space-y-1 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>;
      if (block.kind === "ordered") return <ol key={index} className="list-decimal space-y-1 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ol>;
      return <p key={index} className="whitespace-pre-wrap">{inline(block.text)}</p>;
    })}
  </div>;
}
