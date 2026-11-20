/** Creative brief and image controls. Mirrors backend ImageOptions / ImageRequest validation. */
import type { Asset } from "@/lib/content-api";

export const VISUAL_STYLES = [
  { id: "auto", label: "Auto / Brand recommended" },
  { id: "premium_minimal", label: "Premium Minimal" },
  { id: "photorealistic", label: "Photorealistic" },
  { id: "editorial", label: "Editorial" },
  { id: "corporate", label: "Professional Corporate" },
  { id: "product_render_3d", label: "3D Product Render" },
  { id: "modern_illustration", label: "Modern Illustration" },
  { id: "cinematic", label: "Cinematic" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "abstract_technology", label: "Abstract Technology" },
  { id: "custom", label: "Custom" },
] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number]["id"];

export const OBJECTIVES = [
  { id: "", label: "From saved goals" },
  { id: "educational", label: "Educational" },
  { id: "brand_awareness", label: "Brand awareness" },
  { id: "promotion", label: "Product / service promotion" },
  { id: "thought_leadership", label: "Thought leadership" },
  { id: "engagement", label: "Engagement" },
  { id: "announcement", label: "Announcement" },
  { id: "case_study", label: "Case study (needs evidence)" },
  { id: "promotional_campaign", label: "Promotional campaign" },
] as const;

export const TONES = ["Professional", "Friendly", "Warm", "Confident", "Playful", "Inspiring", "Educational", "Bold", "Calm"];

export const OPTION_CHOICES = {
  color_intensity: [
    ["auto", "Auto"],
    ["muted", "Muted"],
    ["balanced", "Balanced accents"],
    ["vibrant", "Vibrant"],
  ],
  background: [
    ["auto", "Auto"],
    ["clean_studio", "Clean studio"],
    ["natural_setting", "Natural setting"],
    ["textured", "Textured surface"],
    ["gradient", "Soft gradient"],
    ["light", "Light and airy"],
    ["dark", "Dark / low-key"],
  ],
  subject_emphasis: [
    ["auto", "Auto"],
    ["product", "Product or offering"],
    ["environment", "Setting / environment"],
    ["people_in_context", "In use (no identifiable people)"],
    ["concept", "Visual metaphor"],
  ],
  negative_space: [
    ["auto", "Auto"],
    ["minimal", "Minimal (fill the frame)"],
    ["balanced", "Balanced"],
    ["generous", "Generous (room for text later)"],
  ],
  detail_level: [
    ["auto", "Auto"],
    ["minimal", "Minimal"],
    ["balanced", "Balanced"],
    ["detailed", "Detailed"],
  ],
  product_imagery: [
    ["auto", "Auto"],
    ["category_illustration", "Illustrative product category"],
    ["no_product", "No product shown"],
  ],
} as const;

export type ImageOptions = {
  visual_style: VisualStyle;
  custom_style: string;
  color_intensity: string;
  background: string;
  subject_emphasis: string;
  negative_space: string;
  detail_level: string;
  text_in_image: boolean;
  overlay_text: string;
  product_imagery: string;
  negative_instructions: string;
};

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  visual_style: "auto",
  custom_style: "",
  color_intensity: "auto",
  background: "auto",
  subject_emphasis: "auto",
  negative_space: "auto",
  detail_level: "auto",
  text_in_image: false,
  overlay_text: "",
  product_imagery: "auto",
  negative_instructions: "",
};

/** Only the choices the user changed; null keeps the server's brand-recommended defaults. */
export function imageOptionsPayload(options: ImageOptions): Partial<ImageOptions> | null {
  const changed: Partial<ImageOptions> = {};
  for (const key of Object.keys(DEFAULT_IMAGE_OPTIONS) as (keyof ImageOptions)[]) {
    const value = typeof options[key] === "string" ? (options[key] as string).trim() : options[key];
    if (value !== DEFAULT_IMAGE_OPTIONS[key]) (changed as Record<string, unknown>)[key] = value;
  }
  if (!changed.text_in_image) delete changed.overlay_text;
  if (options.visual_style !== "custom") delete changed.custom_style;
  return Object.keys(changed).length ? changed : null;
}

export function imageOptionsProblem(options: ImageOptions): string | null {
  if (options.visual_style === "custom" && !options.custom_style.trim()) return "Describe the custom visual style.";
  if (options.text_in_image) {
    const text = options.overlay_text.trim();
    if (!text) return "Enter the exact short text to show in the image.";
    if (text.split(/\s+/).length > 6) return "Image text must be 6 words or fewer so it stays legible.";
    if (/https?:\/\/|www\./i.test(text)) return "Image text cannot contain links.";
  }
  return null;
}

/** Auto first, then the industry's recommended styles, then the rest; Custom last. */
export function orderedStyles(recommended: string[] = []) {
  const known = VISUAL_STYLES.filter((s) => s.id !== "auto" && s.id !== "custom");
  const top = recommended.map((id) => known.find((s) => s.id === id)).filter((s): s is (typeof known)[number] => !!s);
  const rest = known.filter((s) => !recommended.includes(s.id));
  return { recommended: top, other: rest };
}

export const OPERATIONS = [
  { id: "same_brief", label: "Regenerate with the same brief", needs: null },
  { id: "custom", label: "Regenerate with custom instructions", needs: "instructions" },
  { id: "refine", label: "Refine this image (AI edit)", needs: "instructions" },
  { id: "style", label: "Change visual style", needs: "style" },
  { id: "background", label: "Change background", needs: "background" },
  { id: "color_emphasis", label: "Adjust brand colour emphasis", needs: "color" },
  { id: "simplify", label: "Simplify composition", needs: null },
  { id: "alternative", label: "Alternative creative direction", needs: null },
  { id: "platform", label: "Generate for another platform format", needs: "ratio" },
] as const;
export type Operation = (typeof OPERATIONS)[number]["id"];
/** Operations that send the previous image to the model when one exists. */
export const EDIT_OPERATIONS: Operation[] = ["refine", "background", "color_emphasis", "simplify"];

export type VariationInput = {
  operation: Operation;
  instructions: string;
  style: string;
  customStyle: string;
  background: string;
  intensity: string;
  ratio: string;
};

export function variationRequest(input: VariationInput, hasImage: boolean) {
  const { operation } = input;
  if (operation === "refine" && !hasImage) return { error: "Generate or upload an image before refining it." };
  if ((operation === "custom" || operation === "refine") && !input.instructions.trim()) return { error: "Describe the change you want." };
  const options: Record<string, unknown> = {};
  if (operation === "style") {
    if (!input.style || input.style === "auto") return { error: "Choose a visual style." };
    if (input.style === "custom" && !input.customStyle.trim()) return { error: "Describe the custom visual style." };
    options.visual_style = input.style;
    if (input.style === "custom") options.custom_style = input.customStyle.trim();
  }
  if (operation === "background") {
    if (!input.background || input.background === "auto") return { error: "Choose a background." };
    options.background = input.background;
  }
  if (operation === "color_emphasis") {
    if (!input.intensity || input.intensity === "auto") return { error: "Choose a colour emphasis." };
    options.color_intensity = input.intensity;
  }
  if (operation === "platform" && !input.ratio) return { error: "Choose the target format." };
  return {
    body: {
      operation,
      ...(input.instructions.trim() && (operation === "custom" || operation === "refine") ? { instructions: input.instructions.trim() } : {}),
      ...(Object.keys(options).length ? { options } : {}),
      ...(operation === "platform" ? { aspect_ratio: input.ratio } : {}),
    },
  };
}

export function qualityLabel(status?: string | null): { label: string; tone: "ready" | "review" | "muted" } {
  if (status === "ready_for_review") return { label: "Ready for review", tone: "ready" };
  if (status === "needs_review") return { label: "Needs review", tone: "review" };
  if (status === "unchecked") return { label: "Not checked (earlier image)", tone: "muted" };
  return { label: "Your upload", tone: "muted" };
}

export function provenanceLabel(asset: Pick<Asset, "source" | "generation_mode" | "operation">) {
  if (asset.source === "uploaded") return "Uploaded";
  if (asset.source === "duplicated") return "Copied";
  const operation = OPERATIONS.find((o) => o.id === asset.operation)?.label;
  if (asset.generation_mode === "edit") return `AI edit of the previous image${operation ? ` · ${operation}` : ""}`;
  if (asset.generation_mode === "fresh") return operation && asset.operation !== "same_brief" ? `New generation · ${operation}` : "New generation";
  return "AI generated";
}

export const styleLabel = (id?: string | null) => VISUAL_STYLES.find((s) => s.id === id)?.label ?? "";
