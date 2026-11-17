"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Button, Empty, Modal } from "@/components/ui";
import { useCRMRead } from "@/store/use-crm-read";
import { generationsSchema, displayDate } from "@/lib/crm-api";
import { companyRequest } from "@/lib/intelligence-api";
import { resultSchema, postSchema, Draft } from "@/lib/content-api";
import { DraftFields } from "./real-content";
import {
  Status,
  ReadError,
  Skeleton,
  Pager,
} from "@/components/dashboard/crm-ui";

export function GenerationHistory({
  companyId,
  initialGeneration,
}: {
  companyId: string;
  initialGeneration?: string;
}) {
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string | null>(
      initialGeneration || null,
    ),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [index, setIndex] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<string | null>(null);
  const submitting = useRef(false);
  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useCRMRead(
    companyId,
    `/generation-history?limit=20&offset=${offset}`,
    generationsSchema,
  );
  useEffect(() => {
    if (!selected) return;
    let live = true;
    companyRequest(
      companyId,
      `/content-generations/${selected}/result`,
      resultSchema,
    )
      .then((r) => {
        if (live) {
          setDrafts(r.posts);
          setIndex(0);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [companyId, selected]);
  const existing = data?.items
    .find((j) => j.id === selected)
    ?.saved_results.find((s) => s.result_index === index)?.post_id;
  const current = drafts[index];
  return (
    <>
      <div className="crm-toolbar">
        <p className="muted">
          Generation results are not saved posts until you explicitly save a
          draft. Historical results are retained separately.
        </p>
        <Button variant="ghost" onClick={reload}>
          Refresh generation history
        </Button>
      </div>
      {loadError && <ReadError message={loadError} retry={reload} />}
      {loading && !data && <Skeleton label="Loading generation history" />}
      {data && (
        <>
          <div className="crm-table-scroll">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Generation topic</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Results / saved</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <strong>{j.topic}</strong>
                      {j.error_message && <small>{j.error_message}</small>}
                    </td>
                    <td>
                      <Status value={j.status} />
                    </td>
                    <td>{displayDate(j.created_at)}</td>
                    <td>
                      {j.result_count} / {j.saved_results.length}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        disabled={j.status !== "completed"}
                        onClick={() => {
                          setDrafts([]);
                          setSaved(null);
                          setError("");
                          setSelected(j.id);
                        }}
                      >
                        Review results
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.total && (
            <Empty
              title="No generation history"
              description="Create content in AI Content Studio. Completed results remain available here even before you save a post."
            />
          )}
          <Pager
            total={data.total}
            offset={offset}
            limit={20}
            busy={loading}
            onPage={setOffset}
          />
        </>
      )}
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setDrafts([]);
            setSaved(null);
          }
        }}
        title="Review generated results"
        description="Review a retained AI result and explicitly save an editable draft. No generation is started here."
      >
        {error && <p role="alert">{error}</p>}
        {!current && !error && <Skeleton label="Loading retained results" />}
        {current && (
          <>
            <div className="tabs">
              {drafts.map((d, i) => (
                <button
                  key={i}
                  className={i === index ? "active" : ""}
                  onClick={() => {
                    setIndex(i);
                    setSaved(null);
                  }}
                >
                  {d.platform} · {i + 1}
                </button>
              ))}
            </div>
            <DraftFields
              value={current}
              onChange={(value) =>
                setDrafts((v) => v.map((d, i) => (i === index ? value : d)))
              }
            />
            {existing || saved ? (
              <p role="status">
                This result has a saved post.{" "}
                <Link
                  className="text-button"
                  href={`/dashboard/posts?edit=${saved || existing}`}
                >
                  Open saved draft
                </Link>
              </p>
            ) : (
              <Button
                disabled={busy}
                onClick={async () => {
                  if (submitting.current || !selected) return;
                  submitting.current = true;
                  setBusy(true);
                  setError("");
                  try {
                    const key = `socialai-save:${companyId}:${selected}:${index}`;
                    let id = localStorage.getItem(key);
                    if (!id) {
                      id = crypto.randomUUID();
                      localStorage.setItem(key, id);
                    }
                    const p = await companyRequest(
                      companyId,
                      "/posts",
                      postSchema,
                      {
                        ...current,
                        creation_key: id,
                        generation_job_id: selected,
                        result_index: index,
                      },
                    );
                    setSaved(p.id);
                    reload();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Draft could not be saved",
                    );
                  } finally {
                    submitting.current = false;
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Saving…" : "Save recovered draft"}
              </Button>
            )}
            <p className="muted">
              Existing saved drafts are opened, never overwritten. If the brand
              has changed, the server requires a fresh generation or an
              explicitly reviewed manual draft.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
