/**
 * Minimal, safe Markdown parsing for Gemini grounded answers.
 *
 * - Produces a plain data tree rendered with React elements (never raw HTML),
 *   so nothing in the model output can inject markup or scripts.
 * - Only presentation changes: the original text is preserved verbatim apart
 *   from Markdown syntax characters. Nothing is extracted, ranked or rewritten.
 * - Citations are inserted as private-use markers at their original UTF-16
 *   offsets before parsing, so references stay attached to the cited text.
 */
import type { GroundedAnswer } from "./grounded-search";

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "cite"; sources: number[] };

export type ListItem = { inline: Inline[]; children: Block[] };
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "rule" };

const OPEN = "";
const CLOSE = "";

/** Insert citation markers at each citation's end offset (merging shared offsets). */
export function withCitationMarkers(answer: Pick<GroundedAnswer, "text" | "citations">) {
  const at = new Map<number, Set<number>>();
  for (const c of answer.citations) {
    const set = at.get(c.end) || new Set<number>();
    c.source_indices.forEach((i) => set.add(i));
    at.set(c.end, set);
  }
  let out = "";
  let previous = 0;
  for (const [end, sources] of [...at].sort(([a], [b]) => a - b)) {
    out += answer.text.slice(previous, end);
    out += OPEN + [...sources].sort((a, b) => a - b).join(",") + CLOSE;
    previous = end;
  }
  return out + answer.text.slice(previous);
}

const INLINE =
  /([\d,]+)|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)|`([^`]+)`/gs;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") prev.value += value;
    else out.push({ type: "text", value });
  };
  for (const m of text.matchAll(INLINE)) {
    push(text.slice(last, m.index));
    if (m[1] !== undefined)
      out.push({ type: "cite", sources: m[1].split(",").map(Number) });
    else if (m[2] !== undefined || m[3] !== undefined)
      out.push({ type: "strong", children: parseInline(m[2] ?? m[3]) });
    else if (m[4] !== undefined || m[5] !== undefined)
      out.push({ type: "em", children: parseInline(m[4] ?? m[5]) });
    else if (m[6] !== undefined) out.push({ type: "code", value: m[6] });
    last = m.index! + m[0].length;
  }
  push(text.slice(last));
  return out;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { block: Extract<Block, { type: "list" }>; indent: number } | null = null;
  let item: { text: string[]; target: ListItem } | null = null;

  const flushItem = () => {
    if (!item) return;
    item.target.inline = parseInline(item.text.join(" "));
    item = null;
  };
  const flushList = () => {
    flushItem();
    list = null;
  };
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushParagraph();
      // A blank line ends a list item's text but keeps the list open for more items.
      flushItem();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: Math.min(3, heading[1].length) as 1 | 2 | 3, inline: parseInline(heading[2]) });
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "rule" });
      continue;
    }
    const bullet = line.match(BULLET);
    const ordered = bullet ? null : line.match(ORDERED);
    if (bullet || ordered) {
      flushParagraph();
      const indent = (bullet ? bullet[1] : ordered![1]).length;
      const text = bullet ? bullet[2] : ordered![3];
      const isOrdered = !!ordered;
      const start = ordered ? Number(ordered[2]) : 1;
      if (list && indent >= list.indent + 2 && (item || list.block.items.length)) {
        // Nested list under the current (or last) item.
        const parent = item?.target ?? list.block.items[list.block.items.length - 1];
        if (item) item.target.inline = parseInline(item.text.join(" "));
        let nested = parent.children[parent.children.length - 1];
        if (!nested || nested.type !== "list" || nested.ordered !== isOrdered) {
          nested = { type: "list", ordered: isOrdered, start, items: [] };
          parent.children.push(nested);
        }
        (nested as Extract<Block, { type: "list" }>).items.push({ inline: parseInline(text), children: [] });
        item = null; // parent text is final; nested items are single-line
        continue;
      }
      if (!list || list.block.ordered !== isOrdered || indent < list.indent) {
        flushList();
        const block: Extract<Block, { type: "list" }> = { type: "list", ordered: isOrdered, start, items: [] };
        blocks.push(block);
        list = { block, indent };
      } else flushItem();
      const target: ListItem = { inline: [], children: [] };
      list.block.items.push(target);
      item = { text: [text], target };
      continue;
    }
    // Continuation of a list item (indented or directly following it).
    if (item && (/^\s+/.test(raw) || paragraph.length === 0)) {
      item.text.push(line.trim());
      continue;
    }
    if (list && !item && /^\s{2,}/.test(raw)) {
      const lastItem = list.block.items[list.block.items.length - 1];
      lastItem.children.push({ type: "paragraph", inline: parseInline(line.trim()) });
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Plain text of inline nodes (citations omitted); used for accessible labels and tests. */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === "text" || n.type === "code" ? n.value : n.type === "cite" ? "" : inlineText(n.children)))
    .join("");
}

/** Number of distinct sources actually cited in the answer. */
export function citedSourceCount(answer: Pick<GroundedAnswer, "citations">) {
  return new Set(answer.citations.flatMap((c) => c.source_indices)).size;
}
