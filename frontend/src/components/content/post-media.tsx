"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { z } from "zod";
import {
  AlertTriangle,
  Check,
  Download,
  ImagePlus,
  Loader2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import {
  CompanyAPIError,
  aiJobSchema,
  companyRequest,
  startOperation,
} from "@/lib/intelligence-api";
import {
  ASPECT_HINT,
  ASPECT_RATIOS,
  Asset,
  assetSchema,
  GenerationMedia,
  generationMediaSchema,
  mediaUrl,
  PLATFORM_ASPECT,
  postSchema,
  SavedPost,
  uploadProblem,
} from "@/lib/content-api";
import { API_URL } from "@/lib/auth-api";
import { useJobWatch } from "@/store/use-job-watch";
import { ImageQuality, QualityBadge, ReviewActions, VariationPanel } from "./image-controls";
import { provenanceLabel, styleLabel } from "@/lib/creative-options";

const sourceLabel: Record<string, string> = {
  generated: "AI generated",
  uploaded: "Uploaded",
  duplicated: "Copied",
};

export function AssetImage({
  companyId,
  asset,
  alt,
  className,
}: {
  companyId: string;
  asset: Asset;
  alt: string;
  className?: string;
}) {
  return (
    // Authenticated cookie retrieval through the API; never a public static asset.
    <Image
      unoptimized
      className={className}
      width={asset.width}
      height={asset.height}
      src={mediaUrl(API_URL, companyId, asset.id)}
      alt={alt}
    />
  );
}

/** Image for one unsaved generation result (Content Studio / onboarding). */
export function ResultImage({
  companyId,
  generationId,
  index,
  platform,
  imagesAvailable,
  recommended,
  editEnabled = true,
}: {
  companyId: string;
  generationId: string;
  index: number;
  platform: keyof typeof PLATFORM_ASPECT;
  imagesAvailable: boolean;
  recommended?: string[];
  editEnabled?: boolean;
}) {
  const [media, setMedia] = useState<GenerationMedia | null>(null),
    [ratio, setRatio] = useState(PLATFORM_ASPECT[platform]),
    [statusError, setStatusError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [viewing, setViewing] = useState<string | null>(null),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(retry = true) {
      try {
        const next = await companyRequest(companyId, `/content-generations/${generationId}/media`, generationMediaSchema, undefined, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setStatusError("");
        setMedia(next);
        if (next.jobs.some((job) => job.result_index === index && (job.status === "queued" || job.status === "running")))
          timer = setTimeout(() => void load(), 2500);
      } catch (e) {
        if (controller.signal.aborted) return;
        if (retry) timer = setTimeout(() => void load(false), 2500);
        else setStatusError(e instanceof Error ? e.message : "Image status is unavailable.");
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [companyId, generationId, index, tick]);
  const jobs = media?.jobs.filter((j) => j.result_index === index) ?? [];
  const latestJob = jobs[jobs.length - 1];
  const active = jobs.some((j) => ["queued", "running"].includes(j.status));
  const assets = media?.assets.filter((a) => a.result_index === index) ?? [];
  const latest = assets[assets.length - 1];
  const shown = assets.find((a) => a.id === viewing) ?? latest;
  function replaceAsset(next: Asset) {
    setMedia((m) => (m ? { ...m, assets: m.assets.map((a) => (a.id === next.id ? { ...a, ...next } : a)) } : m));
  }
  async function regenerate() {
    setBusy(true);
    setError("");
    try {
      await startOperation(companyId, `/content-generations/${generationId}/results/${index}/images`, { aspect_ratio: ratio });
      setViewing(null);
      setTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start image generation");
    } finally {
      setBusy(false);
    }
  }
  async function cancelImage(jobId: string) {
    setBusy(true);
    setError("");
    try {
      await companyRequest(companyId, `/ai-jobs/${jobId}/cancel`, aiJobSchema, {});
      setTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel image generation.");
    } finally {
      setBusy(false);
    }
  }
  if (!imagesAvailable && !assets.length) return null;
  return (
    <section className="pm pm-result" aria-label={`Image for ${platform} result`}>
      <div className="pm-body">
        <div className="pm-preview">
          {shown ? (
            <AssetImage companyId={companyId} asset={shown} alt={`Generated ${platform} creative`} />
          ) : (
            <div className="pm-empty">
              {active ? <Loader2 size={20} className="ci-spin" aria-hidden /> : <ImagePlus size={20} aria-hidden />}
              <span>{statusError ? "Image status unavailable" : active ? "Generating on-brand image…" : !media ? "Checking image status…" : "No image yet"}</span>
            </div>
          )}
          {shown && active && (
            <div className="pm-progress" role="status">
              <Loader2 size={14} className="ci-spin" aria-hidden /> Generating a new version…
            </div>
          )}
        </div>
        <div className="pm-controls">
          {active && !latest && <p role="status">Image {latestJob?.stage || "queued"}. Your text is ready to edit and save now.</p>}
          {active && latestJob && <Button variant="ghost" disabled={busy} onClick={() => void cancelImage(latestJob.id)}>Skip image</Button>}
          {latestJob?.status === "cancelled" && !latest && <p role="status">Image skipped. You can save the text draft.</p>}
          {latestJob?.status === "failed" && !active && (
            <p role="alert" className="cq-image-error">
              Image generation failed: {latestJob.error_message || latestJob.error_code}. The text draft is unaffected.
            </p>
          )}
          {shown && (
            <>
              <p className="cq-hint">
                {provenanceLabel(shown)}
                {shown.style ? ` · ${styleLabel(shown.style)}` : ""} · {shown.width}×{shown.height}
              </p>
              <ImageQuality asset={shown} />
              <ReviewActions companyId={companyId} asset={shown} onChanged={replaceAsset} />
            </>
          )}
          {imagesAvailable && (
            <>
              <Select label="Image aspect ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
                {ASPECT_RATIOS.map((r) => (
                  <option key={r} value={r}>
                    {r} · {ASPECT_HINT[r]}
                    {r === PLATFORM_ASPECT[platform] ? " (recommended)" : ""}
                  </option>
                ))}
              </Select>
              <div className="wrap-actions">
                <Button variant="secondary" disabled={busy || active || !media || !!statusError} onClick={() => void regenerate()}>
                  <WandSparkles size={14} /> {latest ? "Regenerate image" : "Generate image"}
                </Button>
                {shown && (
                  <Button variant="ghost" asChild>
                    <a href={mediaUrl(API_URL, companyId, shown.id, true)} download>
                      <Download size={14} /> Download
                    </a>
                  </Button>
                )}
              </div>
              <VariationPanel
                companyId={companyId}
                path={`/content-generations/${generationId}/results/${index}/images`}
                hasImage={!!latest}
                defaultRatio={PLATFORM_ASPECT[platform]}
                recommended={recommended}
                editEnabled={editEnabled}
                disabled={active || !media || !!statusError}
                onStarted={() => {
                  setViewing(null);
                  setTick((n) => n + 1);
                }}
              />
            </>
          )}
          {statusError && (
            <div>
              <p role="alert">{statusError}</p>
              <Button variant="ghost" onClick={() => { setStatusError(""); setTick((n) => n + 1); }}>Reload image status</Button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
      {assets.length > 1 && (
        <ul className="pm-gallery cq-versions" aria-label={`Image versions for ${platform} result`}>
          {assets.map((a, i) => (
            <li key={a.id} className={a.id === shown?.id ? "is-primary" : ""}>
              <button type="button" className="cq-version-button" aria-label={`View version ${i + 1}`} onClick={() => setViewing(a.id)}>
                <AssetImage companyId={companyId} asset={a} alt="" />
              </button>
              <div>
                <small>
                  v{i + 1} · {provenanceLabel(a)}
                </small>
                <QualityBadge status={a.quality_status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {latest && (
        <p className="muted cq-footnote">
          {assets.length > 1 ? `${assets.length} versions kept; the newest is used when you save. ` : ""}Saving this draft attaches its
          images. You can upload your own image after saving.
        </p>
      )}
    </section>
  );
}

/**
 * Images for one saved post. Changing the post's image is a content change: the
 * server bumps the revision, returns an approved post to draft and blocks schedules.
 */
export function PostImages({
  companyId,
  post,
  onPostChanged,
  recommended,
  editEnabled = true,
}: {
  companyId: string;
  post: SavedPost;
  onPostChanged: (post: SavedPost) => void;
  recommended?: string[];
  editEnabled?: boolean;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null),
    [ratio, setRatio] = useState(PLATFORM_ASPECT[post.platform]),
    [direction, setDirection] = useState(""),
    [jobId, setJobId] = useState<string | null>(null),
    [confirming, setConfirming] = useState<null | (() => Promise<void>)>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const approved = post.status === "approved";
  const archived = post.status === "archived";
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    companyRequest(companyId, `/posts/${post.id}/assets`, z.array(assetSchema), undefined, undefined, controller.signal)
      .then((rows) => setAssets(rows))
      .catch((e) => !controller.signal.aborted && setError(e instanceof Error ? e.message : "Images unavailable"));
    return () => controller.abort();
  }, [companyId, post.id, reloadKey]);
  const refreshPost = useCallback(async () => {
    onPostChanged(await companyRequest(companyId, `/posts/${post.id}`, postSchema));
  }, [companyId, post.id, onPostChanged]);
  const watch = useJobWatch(
    companyId,
    jobId,
    useCallback(
      (job) => {
        setJobId(null);
        if (job.status === "completed") setNotice("New image ready. Earlier images are kept below.");
        else setError(`Image generation failed: ${job.error_message || "unknown error"}. Your text is unaffected.`);
        load();
        void refreshPost().catch(() => {});
      },
      [load, refreshPost],
    ),
  );
  async function run(op: () => Promise<void>, needsConfirm = true) {
    if (needsConfirm && approved) {
      setConfirming(() => op);
      return;
    }
    setConfirming(null);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await op();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  const generate = () =>
    run(async () => {
      const instructions = direction.trim();
      const job = await startOperation(companyId, `/posts/${post.id}/images`, {
        aspect_ratio: ratio,
        ...(instructions ? { instructions, operation: "custom" } : {}),
      });
      setJobId(job.id);
    });
  const upload = (file: File) =>
    run(async () => {
      const problem = uploadProblem(file);
      if (problem) throw new Error(problem);
      const response = await fetch(
        `${API_URL}/companies/${companyId}/posts/${post.id}/assets/upload?revision=${post.revision}&filename=${encodeURIComponent(file.name.slice(0, 200))}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": file.type },
          body: file,
        },
      ).catch(() => {
        throw new Error("Connection unavailable. Retry the upload.");
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new CompanyAPIError(
          response.status === 409
            ? "This post changed in another session. Reload the saved revision, then upload again."
            : typeof data?.detail === "string"
              ? data.detail
              : "The image could not be uploaded.",
          response.status,
        );
      onPostChanged(postSchema.parse(data.post));
      setNotice("Image uploaded, validated and attached to this post.");
      load();
    });
  const select = (asset: Asset | null) =>
    run(async () => {
      onPostChanged(
        await companyRequest(
          companyId,
          `/posts/${post.id}/primary-asset`,
          postSchema,
          { revision: post.revision, asset_id: asset?.id ?? null },
          "PUT",
        ),
      );
      setNotice(asset ? "Image selected for this post." : "Post set to text-only.");
      load();
    });
  const replaceAsset = (next: Asset) => setAssets((rows) => rows?.map((a) => (a.id === next.id ? { ...a, ...next } : a)) ?? rows);
  const primary = assets?.find((a) => a.id === post.primary_asset_id);
  // Version numbers follow creation order (the list itself shows the chosen image first).
  const chronological = [...(assets ?? [])].sort((x, y) => (x.created_at ?? "").localeCompare(y.created_at ?? ""));
  const versionOf = (id: string) => chronological.findIndex((x) => x.id === id) + 1;
  return (
    <section className="pm" aria-label="Post images">
      <div className="pm-head">
        <h3>Images</h3>
        <span className="muted">
          {assets ? `${assets.length} saved` : "Loading"} · {post.platform} default {PLATFORM_ASPECT[post.platform]}
        </span>
      </div>
      {approved && (
        <p className="pm-warn">
          <AlertTriangle size={14} aria-hidden /> This post is approved. Changing its image returns it to draft and blocks
          any schedule until you approve it again.
        </p>
      )}
      {confirming && (
        <div className="pm-confirm" role="alertdialog" aria-label="Confirm image change">
          <span>Change the image of an approved post?</span>
          <Button onClick={() => void run(confirming, false)}>Continue</Button>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="pm-body">
        <div className="pm-preview">
          {primary ? (
            <AssetImage companyId={companyId} asset={primary} alt={`Image for ${post.title}`} />
          ) : (
            <div className="pm-empty">
              <ImagePlus size={22} aria-hidden />
              <span>Text-only post</span>
            </div>
          )}
          {watch.running && (
            <div className="pm-progress" role="status">
              <Loader2 size={14} className="ci-spin" aria-hidden /> Generating image… {watch.job?.stage && `(${watch.job.stage})`}
            </div>
          )}
        </div>
        <div className="pm-controls">
          {primary && (
            <>
              <p className="cq-hint">
                {provenanceLabel(primary)}
                {primary.style ? ` · ${styleLabel(primary.style)}` : ""} · {primary.width}×{primary.height}
              </p>
              <ImageQuality asset={primary} />
              <ReviewActions companyId={companyId} asset={primary} disabled={archived} onChanged={replaceAsset} />
              {primary.review_decision === "rejected" && (
                <p className="pm-warn">
                  <AlertTriangle size={14} aria-hidden /> This image is rejected. Choose another image or make the post
                  text-only before approving.
                </p>
              )}
            </>
          )}
          <Select label="Image aspect ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r} · {ASPECT_HINT[r]}
                {r === PLATFORM_ASPECT[post.platform] ? " (recommended)" : ""}
              </option>
            ))}
          </Select>
          <Input
            label="Image direction (optional)"
            value={direction}
            maxLength={500}
            placeholder="e.g. overhead flat-lay, warm morning light"
            onChange={(e) => setDirection(e.target.value)}
          />
          <div className="wrap-actions">
            <Button disabled={busy || watch.running || archived} onClick={() => void generate()}>
              <WandSparkles size={14} />
              {primary ? "Regenerate image" : "Generate image"}
            </Button>
            <Button variant="secondary" disabled={busy || watch.running || archived} onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Upload image
            </Button>
            <input
              ref={fileRef}
              type="file"
              hidden
              aria-label="Upload image file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            {primary && (
              <Button variant="secondary" asChild>
                <a href={mediaUrl(API_URL, companyId, primary.id, true)} download>
                  <Download size={14} /> Download image
                </a>
              </Button>
            )}
          </div>
          {!archived && (
            <VariationPanel
              companyId={companyId}
              path={`/posts/${post.id}/images`}
              hasImage={!!primary}
              defaultRatio={PLATFORM_ASPECT[post.platform]}
              recommended={recommended}
              editEnabled={editEnabled}
              disabled={busy || watch.running}
              confirmMessage={approved ? "This approved post will return to draft when the new image is attached. Continue?" : undefined}
              onStarted={(id) => {
                setError("");
                setNotice("");
                setJobId(id);
              }}
            />
          )}
          <p className="muted">
            PNG, JPEG or WEBP up to 8 MB. Files are checked, stripped of metadata and stored privately. Generated images
            use your brand colours, offering and audience; every version is kept.
          </p>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </div>
      </div>
      {assets && assets.length > 0 && (
        <ul className="pm-gallery" aria-label="All images for this post">
          {assets.map((a) => (
            <li key={a.id} className={a.id === post.primary_asset_id ? "is-primary" : ""}>
              <AssetImage companyId={companyId} asset={a} alt={`${sourceLabel[a.source || "generated"]} image`} />
              <div>
                <small>
                  v{versionOf(a.id)} · {provenanceLabel(a)} · {a.aspect_ratio || `${a.width}×${a.height}`}
                </small>
                <div className="cq-gallery-badges">
                  <QualityBadge status={a.quality_status} />
                  {a.review_decision && (
                    <span className={`cq-badge ${a.review_decision === "accepted" ? "cq-badge-ready" : "cq-badge-rejected"}`}>
                      {a.review_decision === "accepted" ? "Accepted" : "Rejected"}
                    </span>
                  )}
                </div>
                <div className="pm-gallery-actions">
                  {a.id === post.primary_asset_id ? (
                    <span className="pm-chosen">
                      <Check size={12} aria-hidden /> In use
                    </span>
                  ) : (
                    <button type="button" disabled={busy || archived || a.review_decision === "rejected"} onClick={() => void select(a)}>
                      Use this image
                    </button>
                  )}
                  <a href={mediaUrl(API_URL, companyId, a.id, true)} download aria-label="Download this image">
                    <Download size={12} />
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {primary && (
        <button type="button" className="text-button pm-textonly" disabled={busy || archived} onClick={() => void select(null)}>
          Use as text-only post (keeps all images)
        </button>
      )}
    </section>
  );
}
