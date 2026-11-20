"""Structured, brand-aware image briefs (prompt architecture v2).

The brief is assembled from ten separate sections so that each concern is stated once and
explicit user choices replace (rather than contradict) defaults:

 1 core subject          2 industry context      3 marketing objective
 4 brand visual direction 5 composition/framing   6 lighting and aesthetic
 7 colour guidance       8 output format          9 content restrictions
10 user customization

Only confirmed brand data and the post itself are used. Industry directions describe *how*
to photograph or illustrate; the subject always comes from the confirmed offerings and topic.
All values are untrusted data for the image model, never instructions that can lift the
restrictions in section 9.
"""
import colorsys
import re

PROMPT_VERSION = "image-brief-v2.1"
MAX_BRIEF_CHARS = 3200
HEX = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])")

# key -> (label, direction). "auto" and "custom" are resolved at build time.
STYLES = {
    "auto": ("Auto / Brand recommended", ""),
    "premium_minimal": ("Premium Minimal", "Refined minimal composition: one hero subject, restrained palette, soft directional light and a high-end editorial finish."),
    "photorealistic": ("Photorealistic", "Photorealistic scene with natural materials, believable light and shallow depth of field. It should read as a considered photograph, not a 3D render."),
    "editorial": ("Editorial", "Magazine-style editorial image: purposeful styling, layered depth, natural light and a moment that tells a small story."),
    "corporate": ("Professional Corporate", "Polished professional setting with clean lines, a credible working context and a calm, confident mood. No staged stock-photo poses."),
    "product_render_3d": ("3D Product Render", "Clean stylised 3D render of a product-category object on a simple studio set with soft global illumination. Clearly a render, not a photograph."),
    "modern_illustration": ("Modern Illustration", "Contemporary illustration with considered shapes, a limited palette and subtle texture. Purposeful and specific, not clip-art or icon collections."),
    "cinematic": ("Cinematic", "Cinematic frame with dramatic directional light, depth, atmosphere and film-like colour grading."),
    "lifestyle": ("Lifestyle", "Authentic lifestyle moment showing the offering in real use, natural light and a candid composition."),
    "abstract_technology": ("Abstract Technology", "Sophisticated abstract visual built from light, depth and material (glass, light trails, layered translucent planes) with one clear focal form."),
    "custom": ("Custom", ""),
}

LIGHTING = {
    "premium_minimal": "Soft, diffused directional light with gentle shadows; calm and refined.",
    "photorealistic": "Natural, believable light consistent with the setting.",
    "editorial": "Natural window or ambient light with gentle contrast.",
    "corporate": "Bright, even daylight with clean highlights.",
    "product_render_3d": "Soft studio key light with subtle rim light and soft contact shadows.",
    "modern_illustration": "Flat or softly shaded lighting with clear value separation.",
    "cinematic": "Dramatic directional light with atmospheric depth.",
    "lifestyle": "Warm natural light; relaxed and inviting.",
    "abstract_technology": "Luminous glow on dark or deep-toned depth with controlled highlights.",
}

# (category, word stems matched against industry/business type, recommended styles, direction, avoid)
INDUSTRIES = [
    ("technology", ("software", "saas", "technolog", "tech", "ai", "artificial intelligence", "it services", "digital", "cloud", "cyber", "data", "app development", "automation"),
     ("editorial", "corporate", "abstract_technology", "premium_minimal", "modern_illustration"),
     "Show the outcome or the working context of the specific service (a focused workspace, a tangible metaphor for what the service does, or an interface abstracted with no readable text) rather than generic technology symbols.",
     "glowing brains, robot faces, binary-code rain, circuit-board clip-art, clusters of hexagon icons, gears, readable UI text"),
    ("healthcare", ("health", "healthcare", "medical", "clinic", "hospital", "dental", "dentist", "pharma", "wellness", "therapy", "physio", "care home"),
     ("photorealistic", "premium_minimal", "lifestyle", "editorial"),
     "Calm, clean and trustworthy care environments and supportive gestures; focus on comfort and the setting of the service.",
     "identifiable patients, graphic procedures, needles or blood, before-and-after imagery, implied clinical outcomes"),
    ("food", ("restaurant", "cafe", "cafes", "café", "coffee", "food", "beverage", "bakery", "bakeries", "cake", "cakes", "catering", "bistro", "bar", "dining", "kitchen"),
     ("photorealistic", "editorial", "lifestyle", "premium_minimal"),
     "Appetising close-ups of the actual menu category with real texture (steam, crumb, gloss, garnish) styled on surfaces that suit the venue.",
     "plastic-looking food, impossible portions, cartoon food unless an illustration style is chosen"),
    ("fashion", ("fashion", "apparel", "clothing", "textile", "textiles", "beauty", "cosmetic", "cosmetics", "skincare", "salon", "jewellery", "jewelry", "accessories", "scarves"),
     ("editorial", "premium_minimal", "lifestyle", "photorealistic"),
     "Material detail, drape and finish: fabric texture, styled still life or flat-lays of the product category, editorial lighting.",
     "identifiable faces of models, distorted hands, invented brand labels or tags"),
    ("ecommerce", ("e-commerce", "ecommerce", "online store", "retail", "shop", "marketplace", "d2c"),
     ("product_render_3d", "photorealistic", "lifestyle", "premium_minimal"),
     "Product-category hero shots or the product in use, with a clean set that keeps the item readable at thumbnail size.",
     "fake packaging labels, price tags, discount badges"),
    ("real_estate", ("real estate", "property", "properties", "realty", "architecture", "interior", "interiors", "construction", "homes"),
     ("photorealistic", "cinematic", "premium_minimal", "lifestyle"),
     "Architectural and interior scenes with natural light, clean lines and believable proportions.",
     "warped perspective, impossible architecture, implying a specific listed property"),
    ("education", ("education", "school", "training", "course", "courses", "academy", "learning", "tutor", "tutoring", "university", "edtech", "coaching"),
     ("modern_illustration", "lifestyle", "editorial", "photorealistic"),
     "Learning moments and study environments, using the tools and materials of the subject being taught.",
     "identifiable students, readable exam or certificate text"),
    ("travel", ("travel", "tourism", "hotel", "hotels", "hospitality", "resort", "airline", "tour", "tours", "holiday", "holidays"),
     ("cinematic", "photorealistic", "lifestyle", "editorial"),
     "A sense of place and experience: landscapes, rooms and journeys with atmospheric light.",
     "real landmarks presented as the brand's own property, identifiable people"),
    ("finance", ("finance", "financial", "bank", "banking", "insurance", "accounting", "investment", "investing", "fintech", "tax", "wealth", "loan", "loans"),
     ("corporate", "premium_minimal", "abstract_technology", "modern_illustration"),
     "Clarity, security and planning metaphors in calm professional settings.",
     "piles of cash, charts with numbers, upward arrows implying returns, currency symbols as claims"),
]
OTHER = ("other", (), ("editorial", "photorealistic", "premium_minimal", "modern_illustration"),
         "Depict the specific offering, or the situation it improves, in a concrete and believable setting.",
         "generic stock clichés and unrelated props")

OBJECTIVES = {
    "educational": "Educational: make the idea easy to grasp at a glance by showing the subject clearly, as if explaining it.",
    "brand_awareness": "Brand awareness: a memorable, distinctive image whose mood fits the brand.",
    "promotion": "Product/service promotion: make the offering desirable and clearly visible as the hero.",
    "thought_leadership": "Thought leadership: a considered, intelligent visual metaphor that invites reflection.",
    "engagement": "Engagement: an inviting, relatable moment that prompts a reaction or comment.",
    "announcement": "Announcement: a clean hero composition with a sense of something new arriving.",
    "case_study": "Case study: show the context of the work (setting, process, materials) without depicting a specific client.",
    "promotional_campaign": "Promotional campaign: a bold campaign-ready hero image with a single strong focal point.",
}
CONTENT_TYPE_OBJECTIVE = {"educational": "educational", "promotional": "promotion", "thought_leadership": "thought_leadership",
                          "storytelling": "brand_awareness", "meme": "engagement"}

RATIOS = {
    "1:1": "Square 1:1 frame: centred or rule-of-thirds composition that still reads as a small feed thumbnail.",
    "4:5": "Portrait 4:5 feed frame: vertical composition with the subject in the upper two-thirds and nothing essential at the edges.",
    "9:16": "Full-screen vertical 9:16 story or reel cover: keep the subject inside the central safe zone and leave the top and bottom 15% free of important detail for platform controls.",
    "16:9": "Wide 16:9 landscape: horizontal composition with the subject offset and supporting context to one side.",
    "3:4": "Portrait 3:4 frame with a vertical composition.",
    "4:3": "Landscape 4:3 frame with a balanced horizontal composition.",
    "3:2": "Landscape 3:2 frame with a horizontal composition.",
    "2:3": "Tall 2:3 frame with a vertical composition.",
}

BACKGROUNDS = {
    "clean_studio": "Clean seamless studio background.",
    "natural_setting": "A natural, real-world setting appropriate to the offering.",
    "textured": "A tactile textured surface or backdrop (stone, linen, wood, paper) that suits the offering.",
    "gradient": "A soft, smooth colour gradient background.",
    "dark": "A dark, low-key background.",
    "light": "A light, airy background.",
}
EMPHASIS = {
    "product": "The offering itself is the hero and fills roughly half the frame.",
    "environment": "Show the setting where the offering is used or experienced; the subject sits within its environment.",
    "people_in_context": "Show the offering in use by people shown only as non-identifiable figures (hands, over-the-shoulder views, silhouettes or figures from behind).",
    "concept": "Express the idea through a single clear visual metaphor.",
}
SPACE = {
    "minimal": "Fill the frame; keep negative space minimal.",
    "balanced": "Balanced negative space around the subject.",
    "generous": "Leave generous clean negative space (around 40% of the frame) on one side.",
}
DETAIL = {
    "minimal": "Minimal composition: at most three elements and a simple background.",
    "balanced": "Moderate detail with one clear focal point.",
    "detailed": "Rich, layered detail while keeping one clear focal point.",
}
INTENSITY = {
    "muted": "Use the brand colours in muted, tonal form with soft neutrals.",
    "balanced": "Use the brand colours as key accents (roughly a third of the frame) supported by complementary neutrals; do not flood the whole image with one hue.",
    "vibrant": "Use the brand colours boldly and saturated, with one strong contrasting accent.",
}


def stems_match(text, stems):
    words = text.casefold()
    return any(re.search(r"(?<![\w])" + re.escape(stem) + r"(?![\w])", words) for stem in stems)


def industry_profile(context):
    """Category from the confirmed industry/business type; offerings only as a fallback."""
    primary = " ".join(filter(None, [context.get("industry"), context.get("business_type")]))
    fallback = " ".join([*(context.get("products_services") or []), context.get("description") or ""])
    for text in (primary, fallback):
        if not text.strip():
            continue
        for profile in INDUSTRIES:
            if stems_match(text, profile[1]):
                return profile
    return OTHER


def recommended_styles(context):
    return list(industry_profile(context)[2])


# ---------- colour ----------

def hex_rgb(value):
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def color_name(value):
    """Plain-language colour name so the model reads colour, not codes."""
    r, g, b = (c / 255 for c in hex_rgb(value))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    h *= 360
    if l < 0.1:
        return "near-black"
    if l > 0.94 and s < 0.5:
        return "white" if l > 0.98 else "off-white"
    if s < 0.06:
        return "charcoal grey" if l < 0.35 else ("light grey" if l > 0.7 else "grey")
    if s < 0.25 and 0.2 < l < 0.85:
        tint = ("sage grey" if 60 <= h < 170 else "slate grey" if 170 <= h < 260 else
                "taupe" if 15 <= h < 60 else "mauve grey")
        return ("dark " if l < 0.35 else "") + tint
    if 15 <= h < 50 and l < 0.5:
        base = "brown"
    elif 25 <= h < 55 and l >= 0.82:
        base = "cream"
    elif 18 <= h < 48 and 0.5 <= l < 0.82 and s < 0.45:
        base = "tan"
    elif 18 <= h < 45 and 0.5 <= l < 0.75 and s < 0.7:
        base = "caramel"
    elif 195 <= h < 215 and l < 0.55:
        base = "steel blue"
    else:
        names = ((15, "red"), (40, "orange"), (55, "amber"), (68, "yellow"), (90, "lime"), (150, "green"), (175, "teal"),
                 (195, "cyan"), (215, "sky blue"), (245, "blue"), (265, "indigo"), (290, "violet"), (325, "magenta"), (345, "pink"), (361, "red"))
        base = next(name for limit, name in names if h < limit)
        if base == "green" and s < 0.35:
            base = "sage green"
    if base in ("brown", "cream", "sage green", "tan", "caramel", "steel blue"):
        prefix = "deep " if l < 0.25 else ""
    elif l < 0.3:
        prefix = "deep "
    elif l > 0.78:
        prefix = "pale "
    elif s < 0.35:
        prefix = "muted "
    elif s > 0.75 and 0.38 < l < 0.62:
        prefix = "vivid "
    else:
        prefix = ""
    return prefix + base


def luminance(value):
    def channel(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = hex_rgb(value)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def palette(context):
    colors = [c.lower() for c in (context.get("brand_colors") or []) if isinstance(c, str) and HEX.fullmatch(c)]
    colors = list(dict.fromkeys(colors))[:5]
    best = max((contrast(a, b) for i, a in enumerate(colors) for b in colors[i + 1:]), default=1.0)
    return {"colors": colors, "names": [color_name(c) for c in colors], "max_contrast": round(best, 2),
            "narrow": len(colors) < 2 or best < 2.0}


# ---------- options ----------

DEFAULT_OPTIONS = {"visual_style": "auto", "custom_style": "", "color_intensity": "auto", "background": "auto",
                   "subject_emphasis": "auto", "negative_space": "auto", "detail_level": "auto", "text_in_image": False,
                   "overlay_text": "", "product_imagery": "auto", "negative_instructions": ""}


def normalized_options(options):
    merged = {**DEFAULT_OPTIONS, **{k: v for k, v in (options or {}).items() if k in DEFAULT_OPTIONS and v is not None}}
    return merged


# Saved free-text visual preferences mapped to a style, so "Auto" honours the brand's own choice
# instead of pairing it with a contradictory industry default. First match wins.
PREFERENCE_STYLES = [
    ("illustrat", "modern_illustration"), ("3d", "product_render_3d"), ("render", "product_render_3d"),
    ("cinematic", "cinematic"), ("lifestyle", "lifestyle"), ("minimal", "premium_minimal"), ("editorial", "editorial"),
    ("corporate", "corporate"), ("photo", "photorealistic"), ("realistic", "photorealistic"), ("abstract", "abstract_technology"),
]


def style_from_preference(text):
    lowered = (text or "").casefold()
    return next((style for stem, style in PREFERENCE_STYLES if re.search(r"(?<![a-z])" + re.escape(stem), lowered)), None)


def resolve_style(options, context):
    style = options["visual_style"]
    if style in STYLES and style not in ("auto", "custom"):
        return style, "selected"
    if style == "custom":
        return "custom", "selected"
    saved = style_from_preference((context.get("preferences") or {}).get("visual_style"))
    if saved:
        return saved, "saved_preference"
    return industry_profile(context)[2][0], "recommended"


def pick_offering(context, draft):
    services = [s for s in (context.get("products_services") or []) if isinstance(s, str) and s.strip()]
    if not services:
        return ""
    topic = " ".join(filter(None, [draft.get("title"), draft.get("image_prompt"), draft.get("hook")])).casefold()
    words = set(re.findall(r"[\w]{4,}", topic))
    scored = sorted(services, key=lambda s: -len(words & set(re.findall(r"[\w]{4,}", s.casefold()))))
    return scored[0][:120]


def clip(text, limit):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= limit else text[:limit - 1].rsplit(" ", 1)[0] + "…"


def build_brief(context, draft, aspect_ratio, options=None, instructions=""):
    """Return (prompt, metadata). `draft` holds platform, content_type, title, hook, image_prompt and
    optionally objective/campaign. `options` follows ImageOptions."""
    options = normalized_options(options)
    category, _stems, styles, industry_direction, industry_avoid = industry_profile(context)
    style, style_source = resolve_style(options, context)
    pal = palette(context)
    offering = pick_offering(context, draft)
    objective = draft.get("objective") or CONTENT_TYPE_OBJECTIVE.get(draft.get("content_type") or "", "brand_awareness")
    preferences = context.get("preferences") or {}
    sections = []

    # 1 core subject
    # Colour codes in the concept become names: codes invite swatches and rendered characters.
    concept = clip(HEX.sub(lambda m: color_name(m.group(0)), draft.get("image_prompt") or draft.get("title") or ""), 700)
    subject = f"1. Core subject: {concept}"
    if offering:
        subject += f" The image must clearly relate to this confirmed offering: {offering}."
    if draft.get("title"):
        subject += f" Post topic: {clip(draft['title'], 160)}."
    sections.append(subject)

    # 2 industry context
    industry = clip(context.get("industry") or "not specified", 100)
    sections.append(f"2. Industry context: {clip(context.get('company_name'), 100)} works in {industry}. {industry_direction}"
                    + (f" Audience: {clip(context.get('target_audience'), 160)}." if context.get("target_audience") else ""))

    # 3 marketing objective
    objective_text = OBJECTIVES.get(objective, OBJECTIVES["brand_awareness"])
    if draft.get("campaign"):
        objective_text += f" Campaign context: {clip(draft['campaign'], 200)}."
    sections.append("3. Marketing objective: " + objective_text)

    # 4 brand visual direction (explicit selection replaces saved preference, never both)
    if style == "custom":
        direction = f"Custom style: {clip(options['custom_style'], 300)}"
    else:
        direction = f"{STYLES[style][0]}: {STYLES[style][1]}"
    if style_source != "selected" and preferences.get("visual_style"):
        direction += f" Saved brand visual preference: {clip(preferences['visual_style'], 200)}."
    voice = ", ".join((context.get("brand_voice") or [])[:3])
    if voice:
        direction += f" Brand personality: {clip(voice, 100)}."
    sections.append("4. Brand visual direction: " + direction)

    # 5 composition and framing
    composition = []
    emphasis = options["subject_emphasis"] if options["subject_emphasis"] != "auto" else ("product" if objective == "promotion" else "")
    if emphasis:
        composition.append(EMPHASIS[emphasis])
    composition.append(SPACE[options["negative_space"]] if options["negative_space"] != "auto" else "One clear focal point that reads at thumbnail size, with uncluttered edges.")
    if options["detail_level"] != "auto":
        composition.append(DETAIL[options["detail_level"]])
    if options["background"] != "auto":
        composition.append(BACKGROUNDS[options["background"]])
    sections.append("5. Composition and framing: " + " ".join(composition))

    # 6 lighting and aesthetic
    sections.append("6. Lighting and aesthetic: " + LIGHTING.get(style, "Light that suits the chosen style and setting.")
                    + " Strong figure-ground separation; professional, feed-ready finish.")

    # 7 colour guidance
    intensity = options["color_intensity"] if options["color_intensity"] != "auto" else ("muted" if style == "premium_minimal" else "balanced")
    if pal["colors"]:
        named = ", ".join(f"{name} ({code})" for name, code in zip(pal["names"], pal["colors"]))
        color = f"Brand palette: {named}. {INTENSITY[intensity]}"
        if pal["narrow"]:
            color += " The palette is narrow or low in contrast, so add complementary colors, neutrals or a contrasting accent for depth."
    else:
        color = "No brand palette is saved. Choose an original, cohesive palette suited to the subject, with contrasting hues or values so the subject stands out clearly."
    sections.append("7. Colour guidance: " + color + " Colours are visual cues only; never write colour codes in the image.")

    # 8 output format
    sections.append(f"8. Output: one image for {draft.get('platform') or 'social media'} at aspect ratio {aspect_ratio}. "
                    + RATIOS.get(aspect_ratio, "") + " Compose natively for this frame; do not letterbox or stretch.")

    # 9 restrictions
    restrictions = ["No logos, brand names, watermarks, trademarks, identifiable real people or celebrities, testimonials, prices, numbers or claims."]
    if options["text_in_image"] and options["overlay_text"].strip():
        restrictions.append(f"Render only this exact text once, large, high-contrast and legible: \"{clip(options['overlay_text'], 60)}\". No other text, letters or numbers anywhere.")
    else:
        restrictions.append("No rendered text, letters, numbers or labels anywhere, including on screens, icons, packaging and signage. "
                            "Any paper, notebook, sketch, book cover, screen or package in the scene stays blank or shows only abstract marks.")
    if options["product_imagery"] == "no_product":
        restrictions.append("Do not show products; convey the idea through setting and atmosphere.")
    else:
        restrictions.append("Show product categories as illustrative examples; do not present them as the brand's exact product or imply unverified features.")
    restrictions.append(f"Avoid clichés for this industry: {industry_avoid}.")
    excluded = ", ".join(preferences.get("excluded_topics") or [])
    if excluded:
        restrictions.append(f"Avoid these topics entirely: {clip(excluded, 300)}.")
    themes = []
    for insight in (context.get("competitor_insights") or [])[:3]:
        themes += (insight.get("themes") or [])[:2]
    if themes:
        restrictions.append("Differentiate visually from common competitor themes: " + clip(", ".join(dict.fromkeys(themes)), 200) + ". Never imitate competitor imagery.")
    if options["negative_instructions"].strip():
        restrictions.append(f"Also avoid: {clip(options['negative_instructions'], 300)}.")
    sections.append("9. Restrictions (always apply): " + " ".join(restrictions))

    # 10 user customization
    if instructions and instructions.strip():
        sections.append(f"10. User direction (overrides style defaults above, never the restrictions): {clip(instructions, 500)}")

    prompt = "\n".join(sections)
    if len(prompt) > MAX_BRIEF_CHARS:
        # Trim the longest free-text section (the concept) rather than dropping restrictions.
        overflow = len(prompt) - MAX_BRIEF_CHARS
        sections[0] = clip(sections[0], max(200, len(sections[0]) - overflow - 2))
        prompt = "\n".join(sections)[:MAX_BRIEF_CHARS]
    meta = {"prompt_version": PROMPT_VERSION, "industry_category": category, "style": style, "style_source": style_source,
            "recommended_styles": list(styles), "objective": objective, "color_intensity": intensity,
            "palette": pal["colors"], "palette_names": pal["names"], "palette_narrow": pal["narrow"], "offering": offering,
            "text_in_image": bool(options["text_in_image"] and options["overlay_text"].strip()), "options": options}
    return prompt, meta


# ---------- variations ----------

EDIT_OPERATIONS = {"background", "color_emphasis", "simplify", "refine"}
OPERATIONS = {
    "same_brief": "Regenerate with the same brief",
    "custom": "Regenerate with custom instructions",
    "style": "Change visual style",
    "background": "Change background",
    "color_emphasis": "Adjust brand colour emphasis",
    "simplify": "Simplify composition",
    "refine": "Refine the current image",
    "alternative": "Alternative creative direction",
    "platform": "Generate for another platform",
}
ALTERNATIVE_EMPHASIS = ["environment", "concept", "product", "people_in_context"]


def apply_operation(operation, options, previous_options=None, variant=0):
    """Options for a variation. Unchanged choices come from the previous image's options."""
    base = normalized_options({**(previous_options or {}), **{k: v for k, v in (options or {}).items() if v not in (None, "", "auto")}})
    if operation == "simplify":
        base.update(detail_level="minimal", negative_space="generous")
    if operation == "alternative":
        current = (previous_options or {}).get("subject_emphasis", "auto")
        choices = [e for e in ALTERNATIVE_EMPHASIS if e != current]
        base["subject_emphasis"] = choices[variant % len(choices)]
    return base


def edit_instruction(operation, options, instructions=""):
    """Instruction sent with the previous image for edit-capable operations."""
    changes = {
        "background": BACKGROUNDS.get(options.get("background"), "Replace the background with one that better suits the subject."),
        "color_emphasis": INTENSITY.get(options.get("color_intensity"), INTENSITY["balanced"]),
        "simplify": "Simplify the composition: remove secondary elements and clutter, keep the main subject, and leave generous clean space.",
        "refine": "Apply the user direction below.",
    }[operation]
    text = (f"Edit the supplied image. Keep the main subject, framing and overall concept, and change only what this asks: {changes}"
            " Keep every restriction from the brief, especially: no logos, brand names, identifiable people, or text unless the brief specifies exact text.")
    if instructions and instructions.strip():
        text += f" User direction: {clip(instructions, 500)}"
    return text
