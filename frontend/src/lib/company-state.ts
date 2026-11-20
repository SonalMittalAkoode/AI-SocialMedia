import { ContentPreferences, DemoState, SocialPlatform } from "@/types";
import { initialState } from "@/data/fixtures";
import { BrandRecord, CompanyBundle, WorkspaceRecord } from "@/lib/company-api";
export const platformLabels: Record<string, SocialPlatform> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
};
export const goalLabels: Record<string, string> = {
  brand_awareness: "Brand Awareness",
  lead_generation: "Lead Generation",
  audience_engagement: "Audience Engagement",
  website_traffic: "Website Traffic",
  product_promotion: "Product Promotion",
  community_building: "Community Building",
};
export const formatLabels: Record<string, string> = {
  image_post: "Image Posts",
  carousel: "Carousel Posts",
  text_post: "Text Posts",
  promotional: "Promotional Posts",
  educational: "Educational Posts",
  meme: "Meme-Based Content",
};
export const frequencyLabels: Record<string, string> = {
  "2_per_week": "2 posts/week",
  "3_per_week": "3 posts/week",
  "5_per_week": "5 posts/week",
  daily: "Daily",
  custom: "Custom",
};
export const languageLabels: Record<string, string> = {
  english: "English",
  hindi: "Hindi",
  hinglish: "Hinglish",
};
const lookup = (labels: Record<string, string>, value: string) =>
  Object.keys(labels).find((k) => labels[k] === value) || value.toLowerCase();
const text = (value: string) => value.trim() || null;
export const preferenceTones = [
  "Professional",
  "Friendly",
  "Funny",
  "Bold",
  "Inspirational",
  "Educational",
  "Trendy",
  "Premium",
];

function suggestedPreferences(brand: BrandRecord): Partial<ContentPreferences> {
  const guidelines = (brand.content_guidelines || "")
    .split("\n")
    .map((line) => line.trim());
  const recommendation = (label: string) =>
    guidelines
      .findLast((line) => line.toLowerCase().startsWith(`${label}:`))
      ?.slice(label.length + 1)
      .trim();
  const topicList = (value: string) =>
    [...new Set(value.split(",").map((topic) => topic.trim()))]
      .filter((topic) => topic && topic.length <= 100)
      .slice(0, 30)
      .join(", ");
  const topics =
    recommendation("content pillars") || brand.products_services.join(", ");
  const voice = [
    ...(recommendation("suggested content tone") || "").split(","),
    ...brand.brand_voice,
  ].map((tone) => tone.trim().toLowerCase());
  const instructions = guidelines
    .filter(
      (line) =>
        !/^(content pillars|suggested content tone|topics to avoid):/i.test(
          line,
        ),
    )
    .join("\n")
    .trim();
  return {
    targetAudience: brand.target_audience || "",
    topics: topicList(topics),
    excludedTopics: topicList(
      recommendation("topics to avoid") ||
        "Unverified claims, Off-topic promotions",
    ),
    visualStyle: brand.brand_colors.length
      ? `Use the brand palette (${brand.brand_colors.join(", ")}) consistently across imagery and graphics.`
      : "",
    instructions:
      instructions || (brand.tagline ? `Brand tagline: ${brand.tagline}` : ""),
    platforms: Object.keys(brand.social_links).flatMap((platform) =>
      Object.hasOwn(platformLabels, platform) ? [platformLabels[platform]] : [],
    ),
    tones: preferenceTones.filter(
      (tone) =>
        voice.includes(tone.toLowerCase()) ||
        (tone === "Inspirational" && voice.includes("inspiring")),
    ),
  };
}
export function companyCacheKey(user: string, company: string) {
  return `socialai-company-draft:${user}:${company}`;
}
export function selectionKey(user: string) {
  return `socialai-active:${user}`;
}
export function emptyCompanyState(base: DemoState): DemoState {
  const blank = {
    ...initialState().workspace.company,
    name: "",
    website: "",
    industry: "",
    description: "",
    location: "",
    audience: "",
    services: "",
    socialLinks: "",
    guidelines: "",
    identity: { tones: [], colors: [], logo: "" },
  };
  return {
    ...base,
    workspace: { id: "", name: "", company: blank },
    onboarding: { step: 0, currentStep: 0, completed: false },
    preferences: initialState().preferences,
  };
}
export function applyBundle(
  base: DemoState,
  workspace: WorkspaceRecord,
  bundle: CompanyBundle,
): DemoState {
  const { company: c, brand: b, preferences: p, progress: g } = bundle;
  const defaults = initialState().preferences;
  const initial = p.revision === 1;
  const suggested =
    initial && b.is_confirmed && !g.completed_steps.includes("preferences")
      ? suggestedPreferences(b)
      : {};
  return {
    ...base,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      company: {
        name: b.display_name || c.name,
        website: c.website_url || c.source_social_url || "",
        industry: c.industry || "",
        brandSource: b.source,
        ...(b.tagline ? { tagline: b.tagline } : {}),
        businessType: c.business_type || "",
        state: c.state || "",
        city: c.city || "",
        country: c.country || "",
        publicEmail: c.public_email || "",
        publicPhone: c.public_phone || "",
        officeAddress: c.office_address || "",
        keywords: (b.brand_keywords || []).join(", "),
        description: b.description || c.description || "",
        location: [c.city, c.country].filter(Boolean).join(", "),
        audience: b.target_audience || "",
        services: b.products_services.join(", "),
        socialLinks: Object.values(b.social_links).join("\n"),
        guidelines: b.content_guidelines || "",
        identity: {
          tones: b.brand_voice,
          colors: b.brand_colors,
          logo: b.logo_url || "",
        },
      },
    },
    preferences: {
      targetAudience: p.target_audience || suggested.targetAudience || "",
      topics: p.content_topics?.join(", ") || suggested.topics || "",
      excludedTopics:
        p.excluded_topics.join(", ") || suggested.excludedTopics || "",
      visualStyle: p.visual_style || suggested.visualStyle || "",
      platforms: p.platforms.length
        ? p.platforms.map((v) => platformLabels[v])
        : initial
          ? suggested.platforms?.length
            ? suggested.platforms
            : defaults.platforms
          : [],
      goals: p.content_goals.length
        ? p.content_goals.map((v) => goalLabels[v])
        : initial
          ? defaults.goals
          : [],
      tones: p.tone.length
        ? p.tone.map((v) => v[0].toUpperCase() + v.slice(1))
        : initial
          ? suggested.tones?.length
            ? suggested.tones
            : defaults.tones
          : [],
      formats: p.content_formats.length
        ? p.content_formats.map((v) => formatLabels[v])
        : initial
          ? defaults.formats
          : [],
      frequency:
        frequencyLabels[p.posting_frequency || ""] || defaults.frequency,
      customFrequency: p.custom_posts_per_week || 4,
      language: languageLabels[p.language] || "English",
      instructions: p.custom_instructions || suggested.instructions || "",
    },
    onboarding: onboardingState(g, b.is_confirmed),
  };
}

export function onboardingState(progress: CompanyBundle["progress"], confirmed: boolean): DemoState["onboarding"] {
  const completed = progress.status === "completed";
  const businessReady = progress.completed_steps.includes("business");
  const step = completed || confirmed ? 2 : businessReady ? 1 : 0;
  return { step, currentStep: step, completed };
}
export function companyPayload(state: DemoState) {
  const b = state.workspace.company;
  const location = b.location.split(",").map((v) => v.trim());
  const social =
    /^https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com)(?:\/|$)/i.test(
      b.website,
    );
  return {
    name: b.name.trim(),
    website_url: social ? null : text(b.website),
    source_social_url: social ? text(b.website) : null,
    industry: text(b.industry),
    business_type: text(b.businessType || ""),
    state: text(b.state || ""),
    public_email: text(b.publicEmail || ""),
    public_phone: text(b.publicPhone || ""),
    office_address: text(b.officeAddress || ""),
    description: text(b.description),
    city: text(b.city ?? location[0] ?? ""),
    country: text(b.country ?? location.slice(1).join(", ")),
  };
}
export function brandPayload(state: DemoState) {
  const b = state.workspace.company;
  const social_links: Record<string, string> = {};
  for (const url of b.socialLinks
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean)) {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      throw new Error("Use full URLs for social profile links.");
    }
    const key =
      ["instagram", "facebook", "linkedin", "x"].find(
        (k) => host === `${k}.com` || host.endsWith(`.${k}.com`),
      ) || (host === "twitter.com" ? "x" : null);
    if (!key)
      throw new Error("Use Instagram, Facebook, LinkedIn, or X social links.");
    social_links[key] = url;
  }
  return {
    display_name: b.name.trim(),
    ...(b.tagline !== undefined ? { tagline: text(b.tagline) } : {}),
    description: text(b.description),
    brand_colors: b.identity.colors,
    brand_voice: b.identity.tones,
    brand_keywords: (b.keywords || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    target_audience: text(b.audience),
    products_services: b.services
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    social_links,
    content_guidelines: text(b.guidelines),
    source: "manual",
  };
}
export function preferencePayload(state: DemoState) {
  const p = state.preferences;
  return {
    platforms: p.platforms.map((v) => lookup(platformLabels, v)),
    content_goals: p.goals.map((v) => lookup(goalLabels, v)),
    tone: p.tones.map((v) => v.toLowerCase()),
    content_formats: p.formats.map((v) => lookup(formatLabels, v)),
    posting_frequency: lookup(frequencyLabels, p.frequency),
    custom_posts_per_week: p.frequency === "Custom" ? p.customFrequency : null,
    language: lookup(languageLabels, p.language),
    custom_instructions: text(p.instructions),
    target_audience: text(p.targetAudience || ""),
    content_topics: (p.topics || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    excluded_topics: (p.excludedTopics || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    visual_style: text(p.visualStyle || ""),
  };
}
