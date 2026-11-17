import { describe, expect, it } from "vitest";
import {
  citedSourceCount,
  inlineText,
  parseInline,
  parseMarkdown,
  withCitationMarkers,
  type Block,
} from "../../src/lib/grounded-markdown";

const text = (b: Block) => (b.type === "rule" ? "" : b.type === "list" ? b.items.map((i) => inlineText(i.inline)).join("|") : inlineText(b.inline));

describe("grounded markdown parsing", () => {
  it("renders headings, numbered lists, bold and paragraphs without raw syntax", () => {
    const blocks = parseMarkdown(
      "## Local competitors\n\nHere are businesses:\n\n1. **Acme Roasters** – specialty coffee in Pune.\n2. **Bean Co**\n   Wholesale beans.\n\n- *Note*: unverified\n\n---\nFinal paragraph.",
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "rule", "paragraph"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    const ordered = blocks[2] as Extract<Block, { type: "list" }>;
    expect(ordered.ordered).toBe(true);
    expect(ordered.items[0].inline[0]).toEqual({ type: "strong", children: [{ type: "text", value: "Acme Roasters" }] });
    expect(text(ordered)).toBe("Acme Roasters – specialty coffee in Pune.|Bean Co Wholesale beans.");
    expect(blocks.map(text).join(" ")).not.toMatch(/\*\*|##|^-/);
  });

  it("keeps ordered list numbering and nested bullets", () => {
    const [list] = parseMarkdown("3. Third\n   - detail a\n   - detail b\n4. Fourth") as Extract<Block, { type: "list" }>[];
    expect(list.start).toBe(3);
    expect(list.items).toHaveLength(2);
    const nested = list.items[0].children[0] as Extract<Block, { type: "list" }>;
    expect(nested.ordered).toBe(false);
    expect(nested.items.map((i) => inlineText(i.inline))).toEqual(["detail a", "detail b"]);
  });

  it("does not treat intra-word underscores or lone asterisks as emphasis", () => {
    expect(parseInline("snake_case_name and 5 * 3")).toEqual([{ type: "text", value: "snake_case_name and 5 * 3" }]);
    expect(parseInline("an *emphasis* and `code`")).toEqual([
      { type: "text", value: "an " },
      { type: "em", children: [{ type: "text", value: "emphasis" }] },
      { type: "text", value: " and " },
      { type: "code", value: "code" },
    ]);
  });

  it("treats any HTML in the answer as plain text", () => {
    const [p] = parseMarkdown("<script>alert(1)</script> <b>x</b>");
    expect(p).toEqual({ type: "paragraph", inline: [{ type: "text", value: "<script>alert(1)</script> <b>x</b>" }] });
  });
});

describe("citations", () => {
  const answer = {
    text: "**Acme** sells beans. Bean Co roasts.",
    citations: [
      { start: 0, end: 21, source_indices: [1, 0] },
      { start: 0, end: 21, source_indices: [2] },
      { start: 22, end: 37, source_indices: [0] },
    ],
  };
  it("inserts merged, sorted markers at original offsets and parses them as references", () => {
    const marked = withCitationMarkers(answer);
    expect(marked).toBe("**Acme** sells beans.0,1,2 Bean Co roasts.0");
    const [p] = parseMarkdown(marked) as Extract<Block, { type: "paragraph" }>[];
    expect(p.inline.filter((n) => n.type === "cite")).toEqual([
      { type: "cite", sources: [0, 1, 2] },
      { type: "cite", sources: [0] },
    ]);
    // The original words are preserved; only Markdown syntax is removed.
    expect(inlineText(p.inline)).toBe("Acme sells beans. Bean Co roasts.");
  });
  it("counts distinct cited sources", () => {
    expect(citedSourceCount(answer)).toBe(3);
  });
  it("keeps references inside bold text", () => {
    const [p] = parseMarkdown(withCitationMarkers({ text: "**Acme Studio** is local.", citations: [{ start: 2, end: 13, source_indices: [0] }] })) as Extract<Block, { type: "paragraph" }>[];
    expect(p.inline[0]).toEqual({ type: "strong", children: [{ type: "text", value: "Acme Studio" }, { type: "cite", sources: [0] }] });
  });
});
