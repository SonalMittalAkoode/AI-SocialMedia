"use client";
import { useCallback, useState } from "react";
import { z } from "zod";
import { History, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { companyRequest, startOperation } from "@/lib/intelligence-api";
import {
  Draft,
  PostVersion,
  resultSchema,
  versionSchema,
} from "@/lib/content-api";
import { useJobWatch } from "@/store/use-job-watch";

type CaptionFields = Pick<Draft, "caption" | "hashtags" | "hook" | "call_to_action">;

/** Generates a new caption for the same post and image; the user decides whether to apply it. */
export function CaptionRegenerator({
  companyId,
  postId,
  path,
  disabled,
  onApply,
}: {
  companyId: string;
  postId?: string;
  /** Endpoint that queues the caption job; defaults to the saved post's regenerate route. */
  path?: string;
  disabled?: boolean;
  onApply: (fields: CaptionFields) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null),
    [suggestion, setSuggestion] = useState<CaptionFields | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const watch = useJobWatch(
    companyId,
    jobId,
    useCallback(
      async (job) => {
        setJobId(null);
        if (job.status !== "completed") {
          setError(job.error_message || "Caption regeneration failed. Your saved caption is unchanged.");
          return;
        }
        try {
          const result = await companyRequest(companyId, `/content-generations/${job.id}/result`, resultSchema);
          const next = result.posts[0];
          setSuggestion({ caption: next.caption, hashtags: next.hashtags, hook: next.hook, call_to_action: next.call_to_action });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Result unavailable");
        }
      },
      [companyId],
    ),
  );
  return (
    <div className="pr-caption">
      <Button
        variant="secondary"
        disabled={disabled || busy || watch.running}
        onClick={async () => {
          setBusy(true);
          setError("");
          setSuggestion(null);
          try {
            const job = await startOperation(companyId, path ?? `/posts/${postId}/regenerate`, { mode: "caption" });
            setJobId(job.id);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not start");
          } finally {
            setBusy(false);
          }
        }}
      >
        {watch.running ? <Loader2 size={14} className="ci-spin" /> : <RefreshCw size={14} />}
        {watch.running ? "Writing new caption…" : "Regenerate caption"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {suggestion && (
        <div className="pr-suggestion" aria-label="Suggested caption">
          <strong>Suggested caption</strong>
          {suggestion.hook && <p className="muted">Hook: {suggestion.hook}</p>}
          <p>{suggestion.caption}</p>
          <p className="muted">{suggestion.hashtags.join(" ")}</p>
          {suggestion.call_to_action && <p className="muted">CTA: {suggestion.call_to_action}</p>}
          <div className="wrap-actions">
            <Button
              onClick={() => {
                onApply(suggestion);
                setSuggestion(null);
              }}
            >
              Apply caption to editor
            </Button>
            <Button variant="ghost" onClick={() => setSuggestion(null)}>
              Discard
            </Button>
          </div>
          <p className="muted">
            Applying only changes the editor. Save to keep it; the image and the previous caption (in version history) are preserved.
          </p>
        </div>
      )}
    </div>
  );
}

/** Earlier saved states, written by the database before each change. */
export function VersionHistory({
  companyId,
  postId,
  onRestore,
}: {
  companyId: string;
  postId: string;
  onRestore: (fields: Partial<Draft>) => void;
}) {
  const [versions, setVersions] = useState<PostVersion[] | null>(null),
    [error, setError] = useState("");
  return (
    <details
      className="pr-history"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && versions === null)
          companyRequest(companyId, `/posts/${postId}/versions`, z.array(versionSchema))
            .then(setVersions)
            .catch((err) => setError(err.message));
      }}
    >
      <summary>
        <History size={14} aria-hidden /> Version history
      </summary>
      {error && <p role="alert">{error}</p>}
      {versions === null ? (
        !error && <p className="muted">Loading…</p>
      ) : !versions.length ? (
        <p className="muted">No earlier versions yet. Each saved change keeps the previous state here.</p>
      ) : (
        <ol>
          {versions.map((v) => {
            const s = v.snapshot as Record<string, unknown>;
            return (
              <li key={v.revision}>
                <div>
                  <strong>Revision {v.revision}</strong>{" "}
                  <span className="muted">
                    {String(s.status || "").replaceAll("_", " ")} · replaced {new Date(v.created_at).toLocaleString()}
                  </span>
                  <p>{String(s.caption || "").slice(0, 180)}</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    onRestore({
                      title: String(s.title || ""),
                      caption: String(s.caption || ""),
                      hashtags: Array.isArray(s.hashtags) ? (s.hashtags as string[]) : [],
                      hook: String(s.hook || ""),
                      call_to_action: String(s.call_to_action || ""),
                      image_prompt: String(s.image_prompt || ""),
                    })
                  }
                >
                  Load text into editor
                </Button>
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}
