"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useStore } from "@/store/provider";
import {
  Button,
  Badge,
  Input,
  Textarea,
  Select,
  Empty,
  Modal,
  PageHeading,
} from "@/components/ui";
import { companyRequest, startOperation } from "@/lib/intelligence-api";
import {
  postSchema,
  resultSchema,
  editable,
  Draft,
  SavedPost,
  ASPECT_RATIOS,
  ASPECT_HINT,
  PLATFORM_ASPECT,
} from "@/lib/content-api";
import { useAIJob } from "@/store/use-ai-job";
import { ScheduleForm } from "./schedule-form";
import { PostImages, ResultImage } from "./post-media";
import { CaptionRegenerator, VersionHistory } from "./post-revisions";
const platforms = ["Instagram", "LinkedIn", "Facebook", "X"] as const;

export function DraftFields({
  value,
  onChange,
}: {
  value: Draft;
  onChange: (v: Draft) => void;
}) {
  return (
    <>
      <Input
        label="Post title"
        value={value.title}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
      />
      <Select
        label="Platform"
        value={value.platform}
        onChange={(e) =>
          onChange({ ...value, platform: e.target.value as Draft["platform"] })
        }
      >
        {platforms.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </Select>
      <Textarea
        label="Caption"
        value={value.caption}
        rows={7}
        onChange={(e) => onChange({ ...value, caption: e.target.value })}
      />
      <Input
        label="Hashtags"
        value={value.hashtags.join(" ")}
        onChange={(e) =>
          onChange({
            ...value,
            hashtags: e.target.value.split(/\s+/).filter(Boolean),
          })
        }
      />
      <Textarea
        label="Visual concept"
        value={value.image_prompt}
        onChange={(e) => onChange({ ...value, image_prompt: e.target.value })}
      />
      {value.slides.map((s, i) => (
        <div className="panel" key={i}>
          <Input
            label={`Slide ${i + 1} heading`}
            value={s.heading}
            onChange={(e) =>
              onChange({
                ...value,
                slides: value.slides.map((v, j) =>
                  i === j ? { ...v, heading: e.target.value } : v,
                ),
              })
            }
          />
          <Textarea
            label={`Slide ${i + 1} body`}
            value={s.body}
            onChange={(e) =>
              onChange({
                ...value,
                slides: value.slides.map((v, j) =>
                  i === j ? { ...v, body: e.target.value } : v,
                ),
              })
            }
          />
          <p className="muted">Visual direction: {s.visual}</p>
        </div>
      ))}
    </>
  );
}

export function RealStudio() {
  const { companyId } = useStore();
  const operation = useAIJob(companyId, "content_generation");
  const [platform, setPlatform] = useState<Draft["platform"]>("Instagram"),
    [type, setType] = useState("educational"),
    [topic, setTopic] = useState(""),
    [instructions, setInstructions] = useState(""),
    [rows, setRows] = useState<Draft[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [active, setActive] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<SavedPost | null>(null),
    [reviewingSaved, setReviewingSaved] = useState(false),
    [copy, setCopy] = useState("Copy caption"),
    [imagesAvailable, setImagesAvailable] = useState(false),
    [includeImages, setIncludeImages] = useState(true),
    [ratio, setRatio] = useState(PLATFORM_ASPECT.Instagram);
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    companyRequest(companyId, "/ai-capabilities", z.object({ image_available: z.boolean() }).passthrough())
      .then((c) => live && setImagesAvailable(c.image_available))
      .catch(() => live && setImagesAvailable(false));
    return () => {
      live = false;
    };
  }, [companyId]);
  useEffect(() => {
    if (!companyId || operation.job?.status !== "completed") return;
    let live = true;
    companyRequest(
      companyId,
      `/content-generations/${operation.job.id}/result`,
      resultSchema,
    )
      .then((r) => {
        if (live) {
          setRows(r.posts);
          setWarnings(r.warnings);
          setActive(0);
          setSaved(null);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [companyId, operation.job?.id, operation.job?.status]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  const current = rows[active];
  return (
    <>
      <div className="notice">
        Real Gemini drafts use your confirmed brand, preferences and approved
        competitor insights.{" "}
        {imagesAvailable
          ? "Captions, hashtags, CTAs and on-brand images are generated together; images never block text."
          : "Image generation is not configured, so drafts are text-only."}{" "}
        Review all claims before approving.
      </div>
      <div className="studio-layout">
        <section className="panel studio-config">
          <div className="section-title">
            <h2>Create something worth sharing.</h2>
            <Badge tone="pink">Gemini</Badge>
          </div>
          <Select
            label="Social platform"
            value={platform}
            onChange={(e) => {
              const next = e.target.value as Draft["platform"];
              setPlatform(next);
              setRatio(PLATFORM_ASPECT[next]);
            }}
          >
            {platforms.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
          <Select
            label="Content type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {[
              "text",
              "image",
              "educational",
              "promotional",
              "thought_leadership",
              "storytelling",
              "carousel",
              "meme",
            ].map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
          <Input
            label="What's the story?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <Textarea
            label="Additional instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          {imagesAvailable && (
            <div className="studio-image-options">
              <label className="ci-checkbox">
                <input
                  type="checkbox"
                  checked={includeImages}
                  onChange={(e) => setIncludeImages(e.target.checked)}
                />
                Generate images with posts
              </label>
              {includeImages && (
                <Select
                  label={`Image size for ${platform}`}
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                >
                  {ASPECT_RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r} · {ASPECT_HINT[r]}
                      {r === PLATFORM_ASPECT[platform] ? " (recommended)" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
          <Button
            disabled={
              !companyId || busy || operation.running || topic.trim().length < 2
            }
            onClick={() =>
              act(async () => {
                await startOperation(companyId!, "/content-generations", {
                  platforms: [platform],
                  content_type: type,
                  topic,
                  instructions,
                  include_images: imagesAvailable && includeImages,
                  aspect_ratios:
                    imagesAvailable && includeImages
                      ? { [platform]: ratio }
                      : null,
                });
                operation.reload();
              })
            }
          >
            {busy || operation.running
              ? "Generating…"
              : operation.job?.status === "failed"
                ? "Retry generation"
                : "Generate content"}
          </Button>
          {operation.job && (
            <p role="status">
              {operation.job.status} · {operation.job.stage}
            </p>
          )}
          <Button variant="ghost" onClick={operation.reload}>
            Reload job status
          </Button>
          {(error || operation.error || operation.job?.error_message) && (
            <p role="alert">
              {error || operation.error || operation.job?.error_message}
            </p>
          )}
        </section>
        <section className="panel">
          {current ? (
            <>
              <div className="tabs">
                {rows.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setActive(i);
                      setSaved(null);
                    }}
                  >
                    {r.platform}
                  </button>
                ))}
              </div>
              <DraftFields
                value={current}
                onChange={(value) => {
                  setRows(rows.map((r, i) => (i === active ? value : r)));
                  setSaved(null);
                }}
              />
              {operation.job && companyId && (
                <ResultImage
                  key={`${operation.job.id}:${active}`}
                  companyId={companyId}
                  generationId={operation.job.id}
                  index={active}
                  platform={current.platform}
                  imagesAvailable={imagesAvailable}
                />
              )}
              {warnings.map((w) => (
                <p className="muted" key={w}>
                  {w}
                </p>
              ))}
              <div className="wrap-actions">
                <Button
                  disabled={busy || !!saved}
                  onClick={() =>
                    act(async () => {
                      if (!companyId || !operation.job) return;
                      const key = `socialai-save:${companyId}:${operation.job.id}:${active}`;
                      let id = localStorage.getItem(key);
                      if (!id) {
                        id = crypto.randomUUID();
                        localStorage.setItem(key, id);
                      }
                      setSaved(
                        await companyRequest(companyId, "/posts", postSchema, {
                          ...current,
                          creation_key: id,
                          generation_job_id: operation.job.id,
                          result_index: active,
                        }),
                      );
                    })
                  }
                >
                  {saved ? "Saved" : "Save draft"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    act(async () => {
                      await navigator.clipboard.writeText(
                        current.caption + "\n" + current.hashtags.join(" "),
                      );
                      setCopy("Copied");
                    })
                  }
                >
                  {copy}
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/dashboard/posts">View saved posts</Link>
                </Button>
              </div>
              {saved && (
                <p role="status">
                  Draft saved to your company. Edit this draft in My Posts.
                  Saving this result again returns the existing draft.
                </p>
              )}
              {saved && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      if (!companyId) return;
                      setSaved(
                        await companyRequest(
                          companyId,
                          `/posts/${saved.id}`,
                          postSchema,
                        ),
                      );
                      setReviewingSaved(true);
                    })
                  }
                >
                  Review &amp; schedule saved draft
                </Button>
              )}
              {saved && reviewingSaved && companyId && (
                <SavedEditor
                  key={saved.id}
                  post={saved}
                  companyId={companyId}
                  onClose={() => setReviewingSaved(false)}
                  onSaved={() => {}}
                />
              )}
              <p className="muted">
                Saving keeps the text and any generated images together.
                Carousel slides and meme concepts require design review.
              </p>
            </>
          ) : (
            <Empty
              title="Your next idea starts here"
              description="Choose a topic and generate a real draft. Saved job results return after refresh."
            />
          )}
        </section>
      </div>
    </>
  );
}

export function SavedEditor({
  post,
  companyId,
  onClose,
  onSaved,
}: {
  post: SavedPost;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<Draft>(editable(post)),
    [baseline, setBaseline] = useState<Draft>(editable(post)),
    [revision, setRevision] = useState(post.revision),
    [status, setStatus] = useState(post.status),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [primary, setPrimary] = useState(post.primary_asset_id ?? null),
    [message, setMessage] = useState("");
  // Image changes come back from the server with a new revision/status.
  const applyServerPost = useCallback(
    (updated: SavedPost) => {
      setRevision(updated.revision);
      setStatus(updated.status);
      setPrimary(updated.primary_asset_id ?? null);
      onSaved();
    },
    [onSaved],
  );
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  async function save(nextStatus = status === "approved" ? "draft" : status) {
    const updated = await companyRequest(
      companyId,
      `/posts/${post.id}`,
      postSchema,
      { ...value, revision, status: nextStatus },
      "PATCH",
    );
    setRevision(updated.revision);
    setStatus(updated.status);
    setBaseline(editable(updated));
    setMessage("Changes saved");
  }
  return (
    <Modal
      open
      onOpenChange={onClose}
      title="Review saved draft"
      description="Edits use server revisions. Generation creates alternatives and preserves this draft."
    >
      <DraftFields value={value} onChange={setValue} />
      <p>
        <Badge>{status}</Badge> Revision {revision}
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="wrap-actions">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const current = await companyRequest(
                companyId,
                `/posts/${post.id}`,
                postSchema,
              );
              setRevision(current.revision);
              setStatus(current.status);
              setBaseline(editable(current));
              setMessage(
                "Server revision loaded. Your text edits are preserved; review before saving.",
              );
            })
          }
        >
          Reload saved revision
        </Button>
        <Button disabled={busy} onClick={() => act(() => save())}>
          Save changes
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await save("ready_for_review");
              setMessage("Ready for review");
            })
          }
        >
          Ready for review
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await save("draft");
              setMessage(
                "Edits saved. Review them, then approve using the button below.",
              );
            })
          }
        >
          Save before approval
        </Button>
        <Button
          disabled={
            busy ||
            status === "archived" ||
            JSON.stringify(value) !== JSON.stringify(baseline)
          }
          onClick={() =>
            act(async () => {
              const updated = await companyRequest(
                companyId,
                `/posts/${post.id}/approve`,
                postSchema,
                { revision },
              );
              setStatus(updated.status);
              setRevision(updated.revision);
              setMessage("Draft approved");
            })
          }
        >
          Approve saved draft
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await companyRequest(
                companyId,
                `/posts/${post.id}/duplicate`,
                postSchema,
                { request_key: crypto.randomUUID() },
              );
              setMessage("Draft duplicated");
            })
          }
        >
          Duplicate
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            act(() => save(status === "archived" ? "draft" : "archived"))
          }
        >
          {status === "archived" ? "Restore" : "Archive"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await startOperation(companyId, `/posts/${post.id}/regenerate`, {
                mode: "full",
              });
              setMessage(
                "Alternative queued. Open Content Studio to review it; this draft is preserved.",
              );
            })
          }
        >
          Regenerate alternative
        </Button>
        <CaptionRegenerator
          companyId={companyId}
          postId={post.id}
          disabled={busy || status === "archived"}
          onApply={(fields) => {
            setValue({ ...value, ...fields });
            setMessage(
              status === "approved"
                ? "New caption applied to the editor. Saving returns this approved post to draft for re-approval."
                : "New caption applied to the editor. Save changes to keep it.",
            );
          }}
        />
      </div>
      <PostImages
        companyId={companyId}
        post={{ ...post, ...baseline, revision, status, primary_asset_id: primary }}
        onPostChanged={applyServerPost}
      />
      <VersionHistory
        companyId={companyId}
        postId={post.id}
        onRestore={(fields) => {
          setValue({ ...value, ...fields });
          setMessage("Earlier text loaded into the editor. Review, then save changes to restore it.");
        }}
      />
      {status === "approved" &&
        JSON.stringify(value) === JSON.stringify(baseline) && (
          <ScheduleForm
            companyId={companyId}
            post={{ ...post, ...value, revision, status }}
            onSaved={onSaved}
          />
        )}
    </Modal>
  );
}

export function RealPosts({
  initialQuery = "",
  initialEdit = null,
}: {
  initialQuery?: string;
  initialEdit?: string | null;
}) {
  const { companyId, state } = useStore();
  const [rows, setRows] = useState<SavedPost[]>([]),
    [query, setQuery] = useState(initialQuery),
    [view, setView] = useState("grid"),
    [platform, setPlatform] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [editing, setEditing] = useState<SavedPost | null>(null),
    [importing, setImporting] = useState(false),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!companyId || !initialEdit) return;
    let live = true;
    companyRequest(
      companyId,
      `/posts/${encodeURIComponent(initialEdit)}`,
      postSchema,
    )
      .then((p) => {
        if (live) setEditing(p);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [companyId, initialEdit]);
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    const params = new URLSearchParams({
      q: query,
      platform,
      status,
      limit: "50",
      offset: String(offset),
    });
    if (!platform) params.delete("platform");
    if (!status) params.delete("status");
    companyRequest(companyId, "/posts?" + params, z.array(postSchema))
      .then((v) => {
        if (live) {
          setRows(v);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [companyId, query, platform, status, refresh, offset]);
  async function importDrafts() {
    if (!companyId) return;
    setImporting(true);
    setError("");
    try {
      for (const post of state.posts.filter((p) => p.status === "Draft")) {
        const key = `socialai-import:${companyId}:${post.id}`;
        let id = localStorage.getItem(key);
        if (!id) {
          id = crypto.randomUUID();
          localStorage.setItem(key, id);
        }
        await companyRequest(companyId, "/posts", postSchema, {
          title: post.title,
          platform: post.platform,
          caption: post.caption,
          content_type: "text",
          hashtags: post.hashtags.split(/\s+/).filter(Boolean).slice(0, 5),
          creation_key: id,
        });
      }
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR IDEAS, ALL IN ONE PLACE"
        title="A home for every good idea."
        description="Review and refine saved company drafts."
        action={
          <Button asChild>
            <Link href="/dashboard/content-studio">Create a post</Link>
          </Button>
        }
      />
      <div className="notice">
        Saved drafts stay with your company. Approval records your review;
        approved posts can be scheduled in Calendar. Publishing integration is
        not connected yet.
      </div>
      <div className="posts-toolbar">
        <Input
          label="Search saved posts"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <Select
          label="Filter by platform"
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
        <Select
          label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All statuses</option>
          {["draft", "ready_for_review", "approved", "archived"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Button variant="ghost" onClick={() => setRefresh((n) => n + 1)}>
          Reload drafts
        </Button>
        <Button
          variant="ghost"
          onClick={() => setView((v) => (v === "grid" ? "list" : "grid"))}
        >
          {view === "grid" ? "List view" : "Grid view"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className={view === "grid" ? "posts-grid" : "post-list"}>
        {rows.map((p) => (
          <article className="post-card" key={p.id}>
            <div className="post-card-body">
              <Badge>
                {p.platform} · {p.status}
              </Badge>
              <h3>{p.title}</h3>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {p.caption}
              </p>
              <p className="muted">{p.hashtags.join(" ")}</p>
              <Button
                variant="secondary"
                aria-label={`Edit ${p.title}`}
                onClick={() => setEditing(p)}
              >
                Edit draft
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <Empty
          title="No saved drafts yet"
          description="Generate and save content, or explicitly import browser drafts below."
        />
      )}
      <div className="wrap-actions">
        <Button
          variant="ghost"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          disabled={rows.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </Button>
        <Button variant="secondary" disabled={importing} onClick={importDrafts}>
          {importing ? "Importing…" : "Import browser demo drafts"}
        </Button>
      </div>
      <p className="muted">
        Imports draft text only into the selected company. Existing browser
        drafts are retained; repeated imports reuse the same server records.
        Unsupported captions must be corrected in the demo editor.
      </p>
      {editing && companyId && (
        <SavedEditor
          key={editing.id}
          post={editing}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onSaved={() => setRefresh((n) => n + 1)}
        />
      )}
    </>
  );
}
