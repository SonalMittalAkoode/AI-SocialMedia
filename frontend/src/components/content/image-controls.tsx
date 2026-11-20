"use client";
import { useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, ThumbsDown, ThumbsUp, WandSparkles } from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { companyRequest, startOperation } from "@/lib/intelligence-api";
import { Asset, assetSchema, QualityCheck } from "@/lib/content-api";
import {
  ImageOptions,
  OPERATIONS,
  OPTION_CHOICES,
  Operation,
  EDIT_OPERATIONS,
  orderedStyles,
  qualityLabel,
  variationRequest,
} from "@/lib/creative-options";
import { PLATFORM_FORMATS } from "@/lib/content-api";

export function StyleSelect({
  label = "Visual style",
  value,
  onChange,
  recommended,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  recommended?: string[];
}) {
  const { recommended: top, other } = orderedStyles(recommended);
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="auto">Auto / Brand recommended</option>
      {top.length > 0 && (
        <optgroup label="Recommended for your industry">
          {top.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={top.length ? "Other styles" : "Styles"}>
        {other.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
        <option value="custom">Custom</option>
      </optgroup>
    </Select>
  );
}

function ChoiceSelect({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: keyof typeof OPTION_CHOICES;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {OPTION_CHOICES[name].map(([id, text]) => (
        <option key={id} value={id}>
          {text}
        </option>
      ))}
    </Select>
  );
}

/** Optional composition controls. Every default is "Auto", which keeps the brand-recommended brief. */
export function AdvancedImageOptions({
  value,
  onChange,
}: {
  value: ImageOptions;
  onChange: (value: ImageOptions) => void;
}) {
  const set = (changes: Partial<ImageOptions>) => onChange({ ...value, ...changes });
  return (
    <details className="cq-advanced">
      <summary>Advanced image settings</summary>
      <div className="cq-advanced-grid">
        <ChoiceSelect label="Colour intensity" name="color_intensity" value={value.color_intensity} onChange={(v) => set({ color_intensity: v })} />
        <ChoiceSelect label="Background" name="background" value={value.background} onChange={(v) => set({ background: v })} />
        <ChoiceSelect label="Subject emphasis" name="subject_emphasis" value={value.subject_emphasis} onChange={(v) => set({ subject_emphasis: v })} />
        <ChoiceSelect label="Negative space" name="negative_space" value={value.negative_space} onChange={(v) => set({ negative_space: v })} />
        <ChoiceSelect label="Composition detail" name="detail_level" value={value.detail_level} onChange={(v) => set({ detail_level: v })} />
        <ChoiceSelect label="Product imagery" name="product_imagery" value={value.product_imagery} onChange={(v) => set({ product_imagery: v })} />
      </div>
      <label className="check-label cq-toggle">
        <input
          type="checkbox"
          checked={value.text_in_image}
          onChange={(e) => set({ text_in_image: e.target.checked, overlay_text: e.target.checked ? value.overlay_text : "" })}
        />
        Text in image
      </label>
      {value.text_in_image && (
        <>
          <Input
            label="Exact image text (up to 6 words)"
            value={value.overlay_text}
            maxLength={60}
            onChange={(e) => set({ overlay_text: e.target.value })}
          />
          <p className="cq-hint">
            AI-rendered text can contain spelling or letter errors. Images with text are always marked
            &ldquo;Needs review&rdquo; so you can check the wording.
          </p>
        </>
      )}
      <Input
        label="Things to avoid (optional)"
        value={value.negative_instructions}
        maxLength={300}
        placeholder="e.g. no smoke, no laptops"
        onChange={(e) => set({ negative_instructions: e.target.value })}
      />
      <p className="cq-hint">
        Images never include logos or identifiable people. Product visuals are illustrative, not photographs of
        your actual products.
      </p>
    </details>
  );
}

const statusIcon = { pass: CheckCircle2, warn: CircleAlert, fail: CircleAlert } as const;

export function QualityBadge({ status }: { status?: string | null }) {
  const { label, tone } = qualityLabel(status);
  return <span className={`cq-badge cq-badge-${tone}`}>{label}</span>;
}

export function QualityChecks({ checks, title = "Quality checks" }: { checks: QualityCheck[]; title?: string }) {
  const attention = checks.filter((c) => c.status !== "pass").length;
  return (
    <details className="cq-checks">
      <summary>
        {title}: {attention ? `${attention} to review` : "no issues found"}
      </summary>
      <ul>
        {checks.map((c) => {
          const Icon = statusIcon[c.status];
          return (
            <li key={c.id} className={`cq-check cq-check-${c.status}`}>
              <Icon size={13} aria-hidden />
              <span>
                <strong>{c.label}</strong> {c.detail}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function ImageQuality({ asset }: { asset: Asset }) {
  const report = asset.quality_report;
  return (
    <div className="cq-quality" aria-label="Image quality">
      <div className="cq-quality-head">
        <QualityBadge status={asset.quality_status} />
        {asset.review_decision && (
          <span className={`cq-badge ${asset.review_decision === "accepted" ? "cq-badge-ready" : "cq-badge-rejected"}`}>
            {asset.review_decision === "accepted" ? "Accepted" : "Rejected"}
          </span>
        )}
      </div>
      {report?.notes?.map((note) => (
        <p className="cq-hint" key={note}>
          {note}
        </p>
      ))}
      {report && report.checks.length > 0 && <QualityChecks checks={report.checks} title="Image checks" />}
      {!report && asset.quality_status === "unchecked" && (
        <p className="cq-hint">
          <CircleDashed size={12} aria-hidden /> This image was created before automated checks existed.
        </p>
      )}
    </div>
  );
}

export function ReviewActions({
  companyId,
  asset,
  disabled,
  onChanged,
}: {
  companyId: string;
  asset: Asset;
  disabled?: boolean;
  onChanged: (asset: Asset) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function decide(decision: "accepted" | "rejected" | null) {
    setBusy(true);
    setError("");
    try {
      onChanged(await companyRequest(companyId, `/media/${asset.id}/review`, assetSchema, { decision }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cq-review">
      <Button
        variant={asset.review_decision === "accepted" ? "primary" : "secondary"}
        disabled={disabled || busy}
        aria-pressed={asset.review_decision === "accepted"}
        onClick={() => void decide(asset.review_decision === "accepted" ? null : "accepted")}
      >
        <ThumbsUp size={13} /> Accept image
      </Button>
      <Button
        variant={asset.review_decision === "rejected" ? "danger" : "ghost"}
        disabled={disabled || busy}
        aria-pressed={asset.review_decision === "rejected"}
        onClick={() => void decide(asset.review_decision === "rejected" ? null : "rejected")}
      >
        <ThumbsDown size={13} /> Reject image
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/** One variation of an image (or of a result's image). Unchanged choices carry over on the server. */
export function VariationPanel({
  companyId,
  path,
  hasImage,
  defaultRatio,
  recommended,
  disabled,
  editEnabled = true,
  confirmMessage,
  onStarted,
}: {
  companyId: string;
  path: string;
  hasImage: boolean;
  defaultRatio: string;
  recommended?: string[];
  disabled?: boolean;
  editEnabled?: boolean;
  /** When set (e.g. an approved post), the user must confirm before the variation starts. */
  confirmMessage?: string;
  onStarted: (jobId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [operation, setOperation] = useState<Operation>("custom"),
    [instructions, setInstructions] = useState(""),
    [style, setStyle] = useState("auto"),
    [customStyle, setCustomStyle] = useState(""),
    [background, setBackground] = useState("auto"),
    [intensity, setIntensity] = useState("auto"),
    [ratio, setRatio] = useState(defaultRatio === "9:16" ? "1:1" : "9:16"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const needs = OPERATIONS.find((o) => o.id === operation)?.needs;
  const willEdit = hasImage && editEnabled && EDIT_OPERATIONS.includes(operation);
  async function start(confirmed = false) {
    const built = variationRequest({ operation, instructions, style, customStyle, background, intensity, ratio }, hasImage);
    if ("error" in built) {
      setError(built.error ?? "");
      return;
    }
    if (confirmMessage && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError("");
    try {
      const job = await startOperation(companyId, path, built.body);
      onStarted(job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the variation");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="cq-variation">
      <summary>
        <WandSparkles size={13} aria-hidden /> Refine image
      </summary>
      <Select label="Variation" value={operation} onChange={(e) => setOperation(e.target.value as Operation)}>
        {OPERATIONS.filter((o) => o.id !== "refine" || hasImage).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      {needs === "instructions" && (
        <Textarea
          label="What should change?"
          value={instructions}
          maxLength={500}
          rows={2}
          placeholder="e.g. warmer morning light, show the pastry closer"
          onChange={(e) => setInstructions(e.target.value)}
        />
      )}
      {needs === "style" && (
        <>
          <StyleSelect label="New visual style" value={style} onChange={setStyle} recommended={recommended} />
          {style === "custom" && <Input label="Describe the style" value={customStyle} maxLength={300} onChange={(e) => setCustomStyle(e.target.value)} />}
        </>
      )}
      {needs === "background" && (
        <Select label="New background" value={background} onChange={(e) => setBackground(e.target.value)}>
          {OPTION_CHOICES.background.map(([id, text]) => (
            <option key={id} value={id} disabled={id === "auto"}>
              {id === "auto" ? "Choose…" : text}
            </option>
          ))}
        </Select>
      )}
      {needs === "color" && (
        <Select label="Brand colour emphasis" value={intensity} onChange={(e) => setIntensity(e.target.value)}>
          {OPTION_CHOICES.color_intensity.map(([id, text]) => (
            <option key={id} value={id} disabled={id === "auto"}>
              {id === "auto" ? "Choose…" : text}
            </option>
          ))}
        </Select>
      )}
      {needs === "ratio" && (
        <Select label="Target format" value={ratio} onChange={(e) => setRatio(e.target.value)}>
          {PLATFORM_FORMATS.map((f) => (
            <option key={f.ratio} value={f.ratio}>
              {f.label}
            </option>
          ))}
        </Select>
      )}
      <p className="cq-hint">
        {willEdit
          ? "The current image is sent to the model as a reference. The model re-renders the whole picture, so other details may also change; this is not a pixel-precise edit."
          : operation === "platform"
            ? "A new image is composed for the new format. Nothing is stretched or cropped."
            : "A new image is generated from the brief. Earlier versions are kept."}
      </p>
      {confirming && (
        <div className="pm-confirm" role="alertdialog" aria-label="Confirm image variation">
          <span>{confirmMessage}</span>
          <Button onClick={() => void start(true)}>Continue</Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
      <Button variant="secondary" disabled={disabled || busy} onClick={() => void start()}>
        <WandSparkles size={14} /> Create variation
      </Button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

