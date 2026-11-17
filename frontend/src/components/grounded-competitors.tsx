"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  GroundedAnswer,
  citationSegments,
  searchCompetitors,
  suggestionsDocument,
} from "@/lib/grounded-search";

export function GroundedCompetitors({
  companyId,
  available,
}: {
  companyId: string;
  available: boolean;
}) {
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function search() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setAnswer(null);
    setError("");
    try {
      const result = await searchCompetitors(companyId, controller.signal);
      if (!controller.signal.aborted) setAnswer(result);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Search unavailable. Use independent manual research or try later.",
        );
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section aria-label="Gemini competitor suggestions">
      <div className="notice">
        <div>
          <strong>
            Live competitor suggestions · Gemini with Google Search
          </strong>
          <p>
            Search uses your confirmed business name, industry, services,
            audience, location and positioning. Suggestions are unverified and
            visible only for this search. They are not saved, imported, crawled
            or used to generate content.
          </p>
          <p>
            Saved competitors below must come from independent sources. Gemini
            search is separate from website research and approval.
          </p>
        </div>
      </div>
      <div className="wrap-actions">
        <Button disabled={busy || !available} onClick={() => void search()}>
          {busy ? "Searching Google…" : "Discover competitors"}
        </Button>
        {answer && (
          <Button variant="ghost" onClick={() => setAnswer(null)}>
            Dismiss search results
          </Button>
        )}
      </div>
      {busy && (
        <p role="status">
          Searching with Gemini and Google Search. Results will appear here
          without being saved.
        </p>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {answer && (
        <article aria-label="Google grounded search results" className="panel">
          <h3>Google grounded search results</h3>
          <p className="muted">
            Source-backed suggestions, not independently verified competitors.
          </p>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {citationSegments(answer).map((segment, index) => (
              <Fragment key={index}>
                {segment.text}
                {segment.sources.map((source) => (
                  <sup key={source}>
                    <a
                      href={answer.sources[source].uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Source ${source + 1}: ${answer.sources[source].title}`}
                    >
                      [{source + 1}]
                    </a>
                  </sup>
                ))}
              </Fragment>
            ))}
          </div>
          <h4>Sources</h4>
          <ol>
            {answer.sources.map((source) => (
              <li key={source.uri}>
                <a href={source.uri} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ol>
          <h4>Google Search Suggestions</h4>
          <iframe
            title="Google Search Suggestions"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={suggestionsDocument(answer.search_suggestions_html)}
            style={{
              width: "100%",
              height: 260,
              border: 0,
              background: "white",
            }}
          />
        </article>
      )}
    </section>
  );
}
