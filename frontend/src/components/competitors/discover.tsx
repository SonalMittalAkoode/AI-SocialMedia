"use client";
import { Fragment, ReactNode, useMemo } from "react";
import { Compass, ExternalLink, Info, Loader2, Plus, RotateCcw, SearchX, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { GroundedAnswer, suggestionsDocument } from "@/lib/grounded-search";
import { Block, Inline, citedSourceCount, parseMarkdown, withCitationMarkers } from "@/lib/grounded-markdown";
import { domainOf, EmptyState } from "./shared";

export type CompanyFacts = { name: string; industry?: string; location?: string; services?: string; audience?: string };

export type Discovery = {
  answer: GroundedAnswer | null;
  busy: boolean;
  error: string;
  run: () => void;
  dismiss: () => void;
};

const INFO =
  "AI-powered discovery helps you explore your competitive landscape. Search suggestions are for reference and are not automatically saved or researched.";

function FactChips({ company }: { company: CompanyFacts }) {
  const facts = (
    [
      ["Industry", company.industry],
      ["Location", company.location],
      ["Key services", company.services],
      ["Target audience", company.audience],
    ] as const
  ).filter(([, v]) => v && v.trim());
  if (!facts.length) return <p className="cx-muted">Add your industry, location, services and audience in Brand Profile for more relevant discovery.</p>;
  return (
    <dl className="cx-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DiscoverPanel({
  company,
  available,
  discovery,
  onAdd,
}: {
  company: CompanyFacts;
  available: boolean;
  discovery: Discovery;
  onAdd: () => void;
}) {
  const { answer, busy, error, run } = discovery;
  return (
    <div className="cx-stack">
      <section className="cx-card cx-discover" aria-label="Competitor discovery">
        <div className="cx-discover-head">
          <span className="cx-discover-icon">
            <Compass size={18} aria-hidden />
          </span>
          <div>
            <h2>Find your competitive landscape</h2>
            <p>Explore businesses that operate in your industry, serve similar audiences, or offer competing products and services.</p>
          </div>
        </div>
        <FactChips company={company} />
        <p className="cx-info">
          <Info size={14} aria-hidden />
          {INFO}
        </p>
        {!available && (
          <p className="cx-info cx-info-warn">
            <Info size={14} aria-hidden />
            Discovery is not configured for this workspace (search_provider_not_configured). You can still add independently sourced competitors.
          </p>
        )}
      </section>

      {busy ? (
        <div className="cx-card cx-discover-loading" role="status">
          <Loader2 size={18} className="ci-spin" aria-hidden />
          <div>
            <strong>Searching with Gemini and Google Search…</strong>
            <p>Results appear here and are not saved.</p>
          </div>
        </div>
      ) : error ? (
        <div className="cx-card">
          <EmptyState icon={SearchX} title="Discovery couldn't be completed." description="The search provider is currently unavailable. Try again or continue with independent competitor research.">
            <Button onClick={run} disabled={!available}>
              <RotateCcw size={14} /> Retry discovery
            </Button>
            <Button variant="secondary" onClick={onAdd}>
              <Plus size={14} /> Add competitor
            </Button>
          </EmptyState>
          <p className="cx-error-detail" role="alert">
            {error}
          </p>
        </div>
      ) : answer ? (
        <GroundedResult answer={answer} onDismiss={discovery.dismiss} />
      ) : (
        <div className="cx-card">
          <EmptyState icon={Sparkles} title="Your competitive landscape awaits." description="Discover businesses in your industry and explore new opportunities for your brand.">
            <Button onClick={run} disabled={!available || busy}>
              Discover competitors
            </Button>
          </EmptyState>
        </div>
      )}
    </div>
  );
}

function Cite({ sources, answer }: { sources: number[]; answer: GroundedAnswer }) {
  return (
    <span className="gm-cites">
      {sources.map((s) => (
        <a
          key={s}
          className="gm-cite"
          href={answer.sources[s].uri}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Source ${s + 1}: ${answer.sources[s].title}`}
          title={answer.sources[s].title}
        >
          {s + 1}
        </a>
      ))}
    </span>
  );
}

function Inlines({ nodes, answer }: { nodes: Inline[]; answer: GroundedAnswer }) {
  return (
    <>
      {nodes.map((n, i) => (
        <Fragment key={i}>
          {n.type === "text" ? (
            n.value
          ) : n.type === "code" ? (
            <code>{n.value}</code>
          ) : n.type === "cite" ? (
            <Cite sources={n.sources} answer={answer} />
          ) : n.type === "strong" ? (
            <strong>
              <Inlines nodes={n.children} answer={answer} />
            </strong>
          ) : (
            <em>
              <Inlines nodes={n.children} answer={answer} />
            </em>
          )}
        </Fragment>
      ))}
    </>
  );
}

function Blocks({ blocks, answer, top = false }: { blocks: Block[]; answer: GroundedAnswer; top?: boolean }): ReactNode {
  return blocks.map((b, i) => {
    if (b.type === "rule") return <hr key={i} />;
    if (b.type === "heading") {
      const Tag = (`h${b.level + 2}` as "h3" | "h4" | "h5");
      return (
        <Tag key={i} className="gm-heading">
          <Inlines nodes={b.inline} answer={answer} />
        </Tag>
      );
    }
    if (b.type === "paragraph")
      return (
        <p key={i}>
          <Inlines nodes={b.inline} answer={answer} />
        </p>
      );
    const List = b.ordered ? "ol" : "ul";
    // Top-level list items are the answer's own sections (often one per business):
    // styled as blocks for readability; their content and order are unchanged.
    return (
      <List key={i} start={b.ordered && b.start !== 1 ? b.start : undefined} className={top ? "gm-sections" : "gm-list"}>
        {b.items.map((item, j) => (
          <li key={j} className={top ? "gm-section" : undefined}>
            <div className="gm-item">
              <Inlines nodes={item.inline} answer={answer} />
            </div>
            {item.children.length > 0 && <Blocks blocks={item.children} answer={answer} />}
          </li>
        ))}
      </List>
    );
  });
}

export function GroundedResult({ answer, onDismiss }: { answer: GroundedAnswer; onDismiss: () => void }) {
  const blocks = useMemo(() => parseMarkdown(withCitationMarkers(answer)), [answer]);
  const cited = citedSourceCount(answer);
  return (
    <article aria-label="Google grounded search results" className="cx-card gm-result">
      <header className="gm-head">
        <div>
          <h3>Google grounded search results</h3>
          <p>
            {answer.sources.length} source{answer.sources.length === 1 ? "" : "s"}
            {cited !== answer.sources.length ? ` · ${cited} cited` : ""} · Grounded with Google Search · Unverified suggestions, shown only for this session
          </p>
        </div>
        <Button variant="ghost" onClick={onDismiss} aria-label="Dismiss search results">
          <X size={14} /> Dismiss
        </Button>
      </header>
      <div className="gm-body">
        <Blocks blocks={blocks} answer={answer} top />
      </div>
      <section className="gm-sources" aria-label="Sources">
        <h4>Sources ({answer.sources.length})</h4>
        <ol>
          {answer.sources.map((s, i) => (
            <li key={s.uri}>
              <span className="gm-source-n">{i + 1}</span>
              <a href={s.uri} target="_blank" rel="noopener noreferrer">
                <span>{s.title || domainOf(s.uri)}</span>
                <small>
                  {/* Grounding links are Google redirect URLs; they are shown as supplied, never resolved. */}
                  {domainOf(s.uri).endsWith("vertexaisearch.cloud.google.com") ? "via Google Search" : domainOf(s.uri)}{" "}
                  <ExternalLink size={11} aria-hidden />
                </small>
              </a>
            </li>
          ))}
        </ol>
      </section>
      <section className="gm-suggestions" aria-label="Google Search Suggestions">
        <h4>Google Search Suggestions</h4>
        {/* Google's required snippet, isolated: no scripts, forms or same-origin access. */}
        <iframe
          title="Google Search Suggestions"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={suggestionsDocument(answer.search_suggestions_html)}
        />
      </section>
    </article>
  );
}
