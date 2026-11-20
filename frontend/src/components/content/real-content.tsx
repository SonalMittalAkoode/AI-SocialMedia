"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AdvancedImageOptions, QualityChecks, StyleSelect } from "./image-controls";
import {
  DEFAULT_IMAGE_OPTIONS,
  ImageOptions,
  OBJECTIVES,
  TONES,
  imageOptionsPayload,
  imageOptionsProblem,
} from "@/lib/creative-options";
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

const capabilitySchema = z
  .object({
    image_available: z.boolean(),
    image_edit_enabled: z.boolean().optional(),
    image_review_enabled: z.boolean().optional(),
    recommended_styles: z.array(z.string()).optional(),
    industry_category: z.string().optional(),
    published_social_sources: z.array(z.string()).optional(),
    ai_provider_label: z.string().optional(),
  })
  .passthrough();
type Capabilities = z.infer<typeof capabilitySchema>;
const socialStylesSchema = z.array(z.object({
  source: z.string(),
  posts_sampled: z.number(),
  formats: z.record(z.string(), z.number()),
  topics: z.array(z.string()),
  median_caption_words: z.number().optional(),
}));

function captionState(job: { status: string; stage: string } | null | undefined, hasRows: boolean) {
  if (!job) return hasRows ? "Captions ready" : "";
  if (job.status === "queued") return "Captions queued";
  if (job.status === "running") return job.stage === "reading_social_posts" ? "Reading recent published posts…" : `Writing captions (${job.stage})`;
  if (job.status === "failed") return "Caption generation failed";
  if (job.status === "cancelled") return "Generation cancelled";
  return "Captions ready";
}

/** A lightweight feed-style preview. It is a layout aid, not an exact platform rendering. */
function PlatformPreview({ draft, companyName }: { draft: Draft; companyName: string }) {
  return (
    <article className={`cq-platform cq-platform-${draft.platform.toLowerCase()}`} aria-label={`${draft.platform} preview`}>
      <header>
        <span className="cq-avatar" aria-hidden>
          {companyName.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{companyName}</strong>
          <small>{draft.platform} preview · layout approximation</small>
        </span>
      </header>
      {draft.hook && <p className="cq-preview-hook">{draft.hook}</p>}
      <p className="cq-preview-caption">{draft.caption}</p>
      {draft.hashtags.length > 0 && <p className="cq-preview-tags">{draft.hashtags.join(" ")}</p>}
      {draft.call_to_action && (
        <p className="cq-preview-cta">
          <span>CTA</span> {draft.call_to_action}
        </p>
      )}
    </article>
  );
}

export function RealStudio({
  firstPost,
  initialTopic = "",
}: { initialTopic?: string; firstPost?: {
  job_id: string | null;
  error: string | null;
  retrying: boolean;
  retryError: string;
  retry: (textOnly: boolean) => Promise<void>;
} } = {}) {
  const { companyId, state } = useStore();
  const [multi, setMulti] = useState(false);
  const requestedPlatforms = multi ? state.preferences.platforms.slice(0, 3) : null;
  const operation = useAIJob(companyId, "content_generation", firstPost?.job_id || undefined, !firstPost || !!firstPost.job_id);
  const [platform, setPlatform] = useState<Draft["platform"]>("Instagram"),
    [type, setType] = useState("educational"),
    [objective, setObjective] = useState(""),
    [topic, setTopic] = useState(initialTopic),
    [audience, setAudience] = useState(""),
    [tone, setTone] = useState(""),
    [campaign, setCampaign] = useState(""),
    [evidence, setEvidence] = useState(""),
    [publishedCaptions, setPublishedCaptions] = useState(""),
    [useRecentSocialPosts, setUseRecentSocialPosts] = useState(true),
    [socialStyles, setSocialStyles] = useState<z.infer<typeof socialStylesSchema>>([]),
    [instructions, setInstructions] = useState(""),
    [rows, setRows] = useState<Draft[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [quality, setQuality] = useState<z.infer<typeof resultSchema>["quality"]>([]),
    [active, setActive] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<SavedPost | null>(null),
    [reviewingSaved, setReviewingSaved] = useState(false),
    [copy, setCopy] = useState("Copy caption"),
    [capabilities, setCapabilities] = useState<Capabilities>({ image_available: false }),
    [includeImages, setIncludeImages] = useState(true),
    [ratio, setRatio] = useState(PLATFORM_ASPECT.Instagram),
    [imageOptions, setImageOptions] = useState<ImageOptions>(DEFAULT_IMAGE_OPTIONS);
  const imagesAvailable = capabilities.image_available;
  // The server reports the active provider; nothing is assumed before it loads.
  const providerLabel = capabilities.ai_provider_label ?? "AI";
  const previewRef = useRef<HTMLElement>(null);
  const startedHere = useRef(false);
  const companyName = state.workspace.company.name || "Your company";
  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    companyRequest(companyId, "/ai-capabilities", capabilitySchema, undefined, undefined, controller.signal)
      .then((c) => setCapabilities(c))
      .catch(() => !controller.signal.aborted && setCapabilities({ image_available: false }));
    return () => controller.abort();
  }, [companyId]);
  useEffect(() => {
    if (!companyId || operation.job?.status !== "completed") return;
    const controller = new AbortController();
    companyRequest(companyId, `/content-generations/${operation.job.id}/result`, resultSchema, undefined, undefined, controller.signal)
      .then((r) => {
        setRows(r.posts);
        setWarnings(r.warnings);
        setQuality(r.quality ?? []);
        setSocialStyles(socialStylesSchema.safeParse(r.strategy.published_social_style).data ?? []);
        setActive(0);
        setSaved(null);
        // On narrow screens the preview sits below the brief: bring a fresh result into view
        // (only after a generation started here, never when restoring after a refresh).
        if (startedHere.current && window.matchMedia("(max-width: 1180px)").matches)
          previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        startedHere.current = false;
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
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
  const currentQuality = quality?.find((q) => q.platform === current?.platform);
  const needsEvidence = objective === "case_study" || objective === "announcement";
  const captionExamples = publishedCaptions.split(/^[ \t]*---[ \t]*\r?$/m).map((entry) => entry.trim()).filter(Boolean);
  const socialSources = capabilities.published_social_sources ?? [];
  const briefProblem =
    (captionExamples.length > 6 || captionExamples.some((entry) => entry.length > 1200)
      ? "Use up to six captions, with 1,200 characters per caption. Separate posts with --- on its own line."
      : null) || (objective === "case_study" && evidence.trim().length < 20
      ? "Case studies need supplied evidence: what was done and the verified outcome."
      : null) || (imagesAvailable && includeImages ? imageOptionsProblem(imageOptions) : null);
  const status = captionState(operation.job, rows.length > 0);
  const firstFailed = !!firstPost && (!firstPost.job_id || ["failed", "cancelled"].includes(operation.job?.status || ""));
  const tones = Array.from(new Set([...(state.preferences.tones ?? []), ...TONES]));
  return (
    <>
      <div className="notice">
        Real {providerLabel} drafts use your confirmed brand, preferences and approved competitor insights.{" "}
        {imagesAvailable
          ? "Images are generated separately after the captions, so a failed image never blocks your text."
          : "Image generation is not configured, so drafts are text-only."}{" "}
        Review all claims before approving.
      </div>
      <div className="studio-layout cq-studio">
        {firstPost ? <section className="panel first-post-panel" aria-label="First post generation">
          <h2>Your first post</h2>
          <p>{firstFailed ? "Your brand and preferences are saved. You can retry here." : "We’re using your confirmed brand and saved preferences to introduce your business."}</p>
          <p role="status" className="cq-status">{firstFailed ? "First post needs a retry" : rows.length ? "First post ready to review" : operation.job?.status === "running" ? "Writing your first captions" : status || "Checking generation status…"}</p>
          {operation.running && <progress aria-label="First post generation progress" />}
          {(firstPost.retryError || firstPost.error || operation.job?.error_message || operation.error || error) && (
            <p role="alert">{firstPost.retryError || firstPost.error || operation.job?.error_message || operation.error || error}</p>
          )}
          <div className="wrap-actions">
            {firstFailed && <>
              <Button disabled={firstPost.retrying} onClick={() => void firstPost.retry(false)}>{firstPost.retrying ? "Retrying…" : "Retry first post"}</Button>
              <Button variant="secondary" disabled={firstPost.retrying} onClick={() => void firstPost.retry(true)}>Retry as text only</Button>
            </>}
            {(operation.error || (!!error && !rows.length)) && <Button variant="secondary" onClick={operation.reload}>Reload job status</Button>}
            <Button variant="ghost" asChild><Link href="/dashboard/content-studio?new=1">Start a new brief</Link></Button>
          </div>
        </section> : <section className="panel studio-config cq-brief" aria-label="Creative brief">
          <div className="section-title">
            <h2>Creative brief</h2>
            <Badge tone="pink">{providerLabel}</Badge>
          </div>
          <p className="cq-company">
            <span className="cq-avatar" aria-hidden>
              {companyName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <small>Company</small>
              <strong>{companyName}</strong>
            </span>
          </p>
          <div className="form-grid">
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
            <Select label="Content objective" value={objective} onChange={(e) => setObjective(e.target.value)}>
              {OBJECTIVES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <label className="check-label">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            Generate versions for saved platforms (up to 3): {state.preferences.platforms.slice(0, 3).join(", ")}
          </label>
          <Input
            label="What's the story?"
            value={topic}
            placeholder="e.g. How our onboarding workshop helps new customers"
            onChange={(e) => setTopic(e.target.value)}
          />
          {needsEvidence && (
            <Textarea
              label={objective === "case_study" ? "Evidence to cite (required)" : "Facts to announce (optional)"}
              value={evidence}
              maxLength={1500}
              rows={3}
              placeholder="Only verified facts. Numbers and outcomes in the post can come only from here or your brand profile."
              onChange={(e) => setEvidence(e.target.value)}
            />
          )}
          <div className="form-grid">
            <Input
              label="Audience (optional)"
              value={audience}
              maxLength={200}
              placeholder="Uses your saved audience"
              onChange={(e) => setAudience(e.target.value)}
            />
            <Select label="Caption tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="">From brand voice</option>
              {tones.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          {imagesAvailable && (
            <div className="studio-image-options">
              <label className="ci-checkbox">
                <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} />
                Generate images with posts
              </label>
              {includeImages && (
                <>
                  <div className="form-grid">
                    <StyleSelect
                      value={imageOptions.visual_style}
                      recommended={capabilities.recommended_styles}
                      onChange={(v) => setImageOptions({ ...imageOptions, visual_style: v as ImageOptions["visual_style"] })}
                    />
                    <Select label={`Image size for ${platform}`} value={ratio} onChange={(e) => setRatio(e.target.value)}>
                      {ASPECT_RATIOS.map((r) => (
                        <option key={r} value={r}>
                          {r} · {ASPECT_HINT[r]}
                          {r === PLATFORM_ASPECT[platform] ? " (recommended)" : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {imageOptions.visual_style === "custom" && (
                    <Input
                      label="Describe the custom style"
                      value={imageOptions.custom_style}
                      maxLength={300}
                      onChange={(e) => setImageOptions({ ...imageOptions, custom_style: e.target.value })}
                    />
                  )}
                  <AdvancedImageOptions value={imageOptions} onChange={setImageOptions} />
                </>
              )}
            </div>
          )}
          <details className="cq-advanced">
            <summary>More caption options</summary>
            <Select label="Content format" value={type} onChange={(e) => setType(e.target.value)}>
              {["text", "image", "educational", "promotional", "thought_leadership", "storytelling", "carousel", "meme"].map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
            <Input
              label="Campaign context (optional)"
              value={campaign}
              maxLength={300}
              placeholder="e.g. Autumn menu launch"
              onChange={(e) => setCampaign(e.target.value)}
            />
          </details>
          <details className="cq-advanced">
            <summary>Learn from published posts</summary>
            {socialSources.length > 0 ? (
              <label className="check-label">
                <input type="checkbox" checked={useRecentSocialPosts} onChange={(e) => setUseRecentSocialPosts(e.target.checked)} />
                Use recent posts from {socialSources.join(" and ")}
              </label>
            ) : (
              <p className="cq-hint">This company has no authorized social feed. Paste published captions to use its past content as a reference.</p>
            )}
            <Textarea
              label="Published caption examples"
              value={publishedCaptions}
              onChange={(e) => setPublishedCaptions(e.target.value)}
              rows={4}
              maxLength={7240}
            />
            <p className="cq-hint">Paste up to six captions. Put three dashes (---) on their own line between posts.</p>
          </details>
          <Textarea
            label="Additional instructions"
            value={instructions}
            maxLength={1500}
            placeholder="Anything else the writer should know"
            onChange={(e) => setInstructions(e.target.value)}
          />
          {briefProblem && topic.trim().length >= 2 && <p className="cq-hint cq-hint-warn">{briefProblem}</p>}
          <Button
            disabled={!companyId || busy || operation.running || topic.trim().length < 2 || !!briefProblem}
            onClick={() =>
              act(async () => {
                const withImages = imagesAvailable && includeImages;
                const options = withImages ? imageOptionsPayload(imageOptions) : null;
                await startOperation(companyId!, "/content-generations", {
                  platforms: requestedPlatforms?.length ? requestedPlatforms : [platform],
                  content_type: type,
                  topic,
                  instructions,
                  ...(objective ? { objective } : {}),
                  ...(audience.trim() ? { audience: audience.trim() } : {}),
                  ...(tone ? { tone } : {}),
                  ...(campaign.trim() ? { campaign: campaign.trim() } : {}),
                  ...(needsEvidence && evidence.trim() ? { evidence: evidence.trim() } : {}),
                  use_recent_social_posts: useRecentSocialPosts,
                  ...(captionExamples.length ? { published_caption_examples: captionExamples } : {}),
                  include_images: withImages,
                  aspect_ratios: withImages
                    ? requestedPlatforms?.length
                      ? Object.fromEntries(requestedPlatforms.map((p) => [p, PLATFORM_ASPECT[p]]))
                      : { [platform]: ratio }
                    : null,
                  ...(options ? { image_options: options } : {}),
                });
                startedHere.current = true;
                operation.reload();
              })
            }
          >
            {busy || operation.running ? "Generating…" : operation.job?.status === "failed" ? "Retry generation" : "Generate content"}
          </Button>
          <p className="cq-hint">
            Only the topic is required. Everything else uses your saved brand profile and preferences.
          </p>
          {operation.job && (
            <p role="status" className="cq-status">
              {status}
            </p>
          )}
          {(error || operation.error || operation.job?.error_message) && (
            <p role="alert">
              {operation.job?.status === "failed" ? "Caption generation failed: " : ""}
              {error || operation.error || operation.job?.error_message}
            </p>
          )}
          {operation.error && (
            <Button variant="ghost" onClick={operation.reload}>
              Reload job status
            </Button>
          )}
        </section>}
        <section ref={previewRef} className="panel cq-preview-panel" aria-label="Content preview">
          {current ? (
            <>
              <div className="cq-preview-head">
                <h2>Content preview</h2>
                <span className="cq-badge cq-badge-ready">{status}</span>
              </div>
              {rows.length > 1 && (
                <div className="tabs" role="tablist" aria-label="Platform versions">
                  {rows.map((r, i) => (
                    <button
                      key={i}
                      role="tab"
                      aria-selected={i === active}
                      className={i === active ? "active" : ""}
                      onClick={() => {
                        setActive(i);
                        setSaved(null);
                      }}
                    >
                      {r.platform}
                    </button>
                  ))}
                </div>
              )}
              <PlatformPreview draft={current} companyName={companyName} />
              {socialStyles.length > 0 && (
                <details className="cq-advanced">
                  <summary>Published post patterns used</summary>
                  <ul>
                    {socialStyles.map((profile) => (
                      <li key={profile.source}>
                        <strong>{profile.source}</strong> · {profile.posts_sampled} post{profile.posts_sampled === 1 ? "" : "s"} sampled
                        {profile.topics.length > 0 && <p>{profile.topics.join(", ")}</p>}
                        {Object.keys(profile.formats).length > 0 && <p>{Object.entries(profile.formats).map(([format, count]) => `${format} (${count})`).join(", ")}</p>}
                        {profile.median_caption_words !== undefined && <p>Median caption length: {profile.median_caption_words} words</p>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {operation.job && companyId && (
                <ResultImage
                  key={`${operation.job.id}:${active}`}
                  companyId={companyId}
                  generationId={operation.job.id}
                  index={active}
                  platform={current.platform}
                  imagesAvailable={imagesAvailable}
                  recommended={capabilities.recommended_styles}
                  editEnabled={capabilities.image_edit_enabled ?? true}
                />
              )}
              {currentQuality && <QualityChecks checks={currentQuality.checks} title="Caption checks" />}
              <div className="wrap-actions cq-actions">
                <Button
                  disabled={busy || !!saved}
                  onClick={() =>
                    act(async () => {
                      if (!companyId || !operation.job) return;
                      const key = `socialai-save:${companyId}:${operation.job.id}:${active}`;
                      let id: string | null = null;
                      try {
                        id = localStorage.getItem(key);
                      } catch {}
                      if (!id) {
                        id = crypto.randomUUID();
                        try {
                          localStorage.setItem(key, id);
                        } catch {}
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
                {saved && saved.status !== "approved" && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        if (!companyId) return;
                        const latest = await companyRequest(companyId, `/posts/${saved.id}`, postSchema);
                        setSaved(await companyRequest(companyId, `/posts/${saved.id}/approve`, postSchema, { revision: latest.revision }));
                      })
                    }
                  >
                    Approve
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() =>
                    act(async () => {
                      await navigator.clipboard.writeText(current.caption + "\n" + current.hashtags.join(" "));
                      setCopy("Copied");
                    })
                  }
                >
                  {copy}
                </Button>
                {companyId && operation.job && !saved && (
                  <CaptionRegenerator
                    companyId={companyId}
                    path={`/content-generations/${operation.job.id}/results/${active}/caption`}
                    disabled={busy}
                    onApply={(fields) => {
                      setRows(rows.map((r, i) => (i === active ? { ...r, ...fields } : r)));
                      setSaved(null);
                    }}
                  />
                )}
                <Button asChild variant="ghost">
                  <Link href="/dashboard/posts">View saved posts</Link>
                </Button>
              </div>
              {saved && (
                <p role="status">
                  {saved.status === "approved"
                    ? "Approved. Use Review & schedule to choose a time; publishing is not connected yet."
                    : "Draft saved to your company. Edit it in the Post Library. Saving this result again returns the existing draft."}
                </p>
              )}
              {saved && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      if (!companyId) return;
                      setSaved(await companyRequest(companyId, `/posts/${saved.id}`, postSchema));
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
                  recommended={capabilities.recommended_styles}
                />
              )}
              <details className="cq-edit" open>
                <summary>Edit text</summary>
                <DraftFields
                  value={current}
                  onChange={(value) => {
                    setRows(rows.map((r, i) => (i === active ? value : r)));
                    setSaved(null);
                  }}
                />
              </details>
              {warnings.map((w) => (
                <p className="muted" key={w}>
                  {w}
                </p>
              ))}
              <p className="muted">
                Saving keeps the text and any generated images together. Carousel slides and meme concepts require design
                review.
              </p>
            </>
          ) : operation.running ? (
            <div className="cq-loading" role="status">
              <span className="ci-spin" aria-hidden>
                ✳
              </span>
              <h3>{firstPost ? "Your draft will appear here" : status || "Starting…"}</h3>
              <p>Captions arrive first. Images follow separately and never block the text.</p>
            </div>
          ) : firstPost ? (
            <Empty title={firstFailed ? "Your draft will appear here" : "Preparing your first draft"} description={firstFailed ? "Retry generation when the provider is available." : "Drafts appear here automatically when the captions are ready."} />
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
  recommended,
}: {
  post: SavedPost;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
  recommended?: string[];
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
        post={{
          ...post,
          ...baseline,
          revision,
          status,
          primary_asset_id: primary,
        }}
        onPostChanged={applyServerPost}
        recommended={recommended}
      />
      <VersionHistory
        companyId={companyId}
        postId={post.id}
        onRestore={(fields) => {
          setValue({ ...value, ...fields });
          setMessage(
            "Earlier text loaded into the editor. Review, then save changes to restore it.",
          );
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
