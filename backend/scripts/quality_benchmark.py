"""Repeatable before/after quality benchmark for captions and images.

From backend/:

  Offline (default, no API calls): build the legacy and current prompts for every category
  and write prompt comparisons plus deterministic prompt metrics.
      python scripts/quality_benchmark.py

  Live (paid, explicit and capped): run the same creative briefs through the legacy and the
  current pipeline, save the images, and write an automated scorecard.
      python scripts/quality_benchmark.py --run-live --max-images 10 --max-text 8 [--ai-review]

Brand data is read-only: saved profiles are read from PostgreSQL when present, otherwise the
synthetic fixture is used. Nothing is written to the database. Outputs go to
frontend/artifacts/quality-benchmark/. Secrets and user data are never printed.
The scorecard contains automated measurements and, with --ai-review, model opinions. It
contains no human ratings.
"""
import argparse
import asyncio
import io
import json
import sys
import time
from pathlib import Path
from uuid import UUID
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PIL import Image, ImageDraw
from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.schemas.content import CAPS, GeneratedContent
from app.services import image_prompt, image_quality
from app.services.content_generation import generate, quality_report, validate_quality, wire_schema, cliches_in, similarity
from benchmark_baseline import LEGACY_IMAGE_SYSTEM, LEGACY_TEXT_SYSTEM, legacy_image_brief, legacy_strategy

OUT = Path(__file__).resolve().parents[2] / "frontend" / "artifacts" / "quality-benchmark"

# Each category: a saved brand record (read-only) when available, else a synthetic fixture.
CATEGORIES = [
    {"key": "technology", "label": "Technology / AI services", "company_id": "ab8d98e6-eebd-45d2-9fcf-563a3afd947c",
     "brief": {"topic": "How a custom AI assistant can sort incoming support tickets", "platforms": ["LinkedIn", "Instagram"], "content_type": "educational", "objective": "educational"},
     "image_platform": "LinkedIn", "extra_ratio": "16:9"},
    {"key": "cafe", "label": "Cafe / specialty coffee", "company_id": "947010f8-0616-4667-8662-6b7c6171fd6c",
     "brief": {"topic": "Our weekend pour-over brewing workshop", "platforms": ["Instagram", "LinkedIn"], "content_type": "promotional", "objective": "promotion"},
     "image_platform": "Instagram", "extra_ratio": "9:16"},
    {"key": "fashion", "label": "Fashion / custom textiles", "company_id": "efd1fc8a-feb7-4edd-9f02-8ba23db9af3c",
     "brief": {"topic": "How a custom scarf goes from sketch to finished print", "platforms": ["Instagram", "LinkedIn"], "content_type": "educational", "objective": "educational"},
     "image_platform": "Instagram", "extra_ratio": None},
    {"key": "healthcare", "label": "Healthcare / family dental (synthetic)", "company_id": None,
     "fixture": {"company_name": "Northside Family Dental", "industry": "Dental clinic", "business_type": "Healthcare provider",
                 "description": "A family dental practice offering check-ups, cleaning and gentle children's dentistry.",
                 "products_services": ["Family check-ups", "Children's dentistry", "Teeth cleaning"], "target_audience": "Parents of young children",
                 "brand_voice": ["Calm", "Reassuring"], "brand_keywords": ["gentle", "family"], "brand_colors": ["#2a9d8f", "#e9f5f2", "#264653"],
                 "guidelines": "No medical advice or outcome claims.", "preferences": {"language": "English", "excluded_topics": ["Pricing"]},
                 "competitor_insights": [], "recent_posts": []},
     "brief": {"topic": "What to expect at a child's first dental check-up", "platforms": ["Instagram", "LinkedIn"], "content_type": "educational", "objective": "educational"},
     "image_platform": "Instagram", "extra_ratio": None},
]


def load_context(category):
    if not category["company_id"]:
        return dict(category["fixture"]), "synthetic fixture"
    from app.db.database import SessionLocal
    from app.models import user, content, brand_extraction, intelligence, onboarding  # noqa: F401
    from app.models.onboarding import Company
    from app.services.content_generation import context_for
    with SessionLocal() as db:
        company = db.get(Company, UUID(category["company_id"]))
        if not company or not company.brand.is_confirmed:
            raise SystemExit(f"Saved brand for {category['key']} is unavailable; use the synthetic fixture.")
        context = context_for(db, company)
        db.rollback()  # read-only
    return context, "saved brand profile (read-only)"


def prompt_metrics(prompt):
    lowered = prompt.casefold()
    return {"chars": len(prompt), "hex_codes": len(image_prompt.HEX.findall(prompt)),
            "lists_all_offerings": lowered.count("offerings to depict"),
            "has_industry_direction": "industry context" in lowered, "has_restriction_section": "restrictions (always apply)" in lowered,
            "conflicting_style_signals": ("visual style preference" in lowered) + ("editorial" in lowered and "illustration" in lowered)}


def sample_draft(context, brief, platform):
    """A neutral draft for offline prompt comparison (live runs use each pipeline's own text)."""
    offering = (context.get("products_services") or ["the offering"])[0]
    return {"platform": platform, "content_type": brief["content_type"], "title": brief["topic"], "hook": brief["topic"],
            "image_prompt": f"A clear, specific scene showing {offering} related to: {brief['topic']}", "objective": brief.get("objective")}


async def legacy_text(client, context, brief):
    from google.genai import types
    request = {k: brief[k] for k in ("topic", "platforms", "content_type")} | {"instructions": ""}
    plan = legacy_strategy(context, request, CAPS)
    legacy_context = {k: v for k, v in context.items() if k != "recent_posts"}
    prompt = json.dumps({"brand": legacy_context, "strategy": plan, "request": request}, ensure_ascii=False)
    started = time.monotonic()
    for attempt in range(2):
        response = await asyncio.wait_for(client.aio.models.generate_content(model=settings.GEMINI_MODEL, contents=prompt,
            config=types.GenerateContentConfig(system_instruction=LEGACY_TEXT_SYSTEM, response_mime_type="application/json", response_json_schema=wire_schema(),
                                               temperature=0.7, max_output_tokens=6500, thinking_config=types.ThinkingConfig(thinking_budget=512))), 30)
        try:
            result = GeneratedContent.model_validate_json(response.text)
            return result, int((time.monotonic() - started) * 1000), attempt + 1
        except Exception:
            if attempt:
                raise
    raise RuntimeError("unreachable")


async def legacy_image(client, prompt, ratio):
    from google.genai import types
    response = await asyncio.wait_for(client.aio.models.generate_content(model=ai_settings.gemini_image_model, contents=prompt[:4000],
        config=types.GenerateContentConfig(system_instruction=LEGACY_IMAGE_SYSTEM, response_modalities=["TEXT", "IMAGE"], image_config=types.ImageConfig(aspect_ratio=ratio))), ai_settings.image_timeout)
    for candidate in response.candidates or []:
        for part in (candidate.content.parts if candidate.content else []) or []:
            if part.inline_data and part.inline_data.data:
                return part.inline_data.data
    raise RuntimeError("no image returned")


def caption_metrics(content, context, request):
    try:
        validate_quality(content, context, request); grounded = "passed"
    except ValueError as exc:
        grounded = f"failed: {exc}"
    report = quality_report(content, context, request)
    posts = []
    for post, checks in zip(content.posts, report):
        status = {c["id"]: c["status"] for c in checks["checks"]}
        posts.append({"platform": post.platform, "title": post.title, "hook": post.hook, "caption": post.caption, "hashtags": post.hashtags,
                      "call_to_action": post.call_to_action, "image_prompt": post.image_prompt,
                      "words": len(post.caption.split()), "generic_phrases": cliches_in(" ".join([post.hook, post.caption, post.call_to_action]), context),
                      "hex_codes_in_visual_concept": len(image_prompt.HEX.findall(post.image_prompt)), "checks": status,
                      "warnings": [c["detail"] for c in checks["checks"] if c["status"] != "pass"]})
    cross = round(similarity(content.posts[0].caption, content.posts[1].caption), 3) if len(content.posts) > 1 else None
    return {"grounding_validation": grounded, "cross_platform_similarity": cross, "posts": posts}


def image_metrics(raw, ratio, context, brief_text):
    report, _ = image_quality.evaluate(raw, "image/png", ratio, image_prompt.palette(context)["colors"])
    with Image.open(io.BytesIO(raw)) as im:
        size = im.size
    return {"width": size[0], "height": size[1], "requested_ratio": ratio, "status": report["status"],
            "checks": {c["id"]: c["status"] for c in report["checks"]}, "palette_share": report.get("palette_share"), "brief_chars": len(brief_text)}


def comparison_sheet(path, label, before, after, notes):
    images = [Image.open(io.BytesIO(b)).convert("RGB") for b in (before, after)]
    for im in images:
        im.thumbnail((520, 650))
    width = sum(im.width for im in images) + 60
    height = max(im.height for im in images) + 110
    sheet = Image.new("RGB", (width, height), (16, 17, 19))
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 12), label, fill=(240, 240, 240))
    x = 20
    for title, im, note in zip(("BEFORE (legacy prompt)", "AFTER (prompt v2)"), images, notes):
        draw.text((x, 40), title, fill=(255, 116, 199) if "AFTER" in title else (170, 170, 170))
        sheet.paste(im, (x, 62))
        draw.text((x, 70 + im.height), note[:90], fill=(160, 165, 175))
        x += im.width + 20
    sheet.save(path)


async def run(args):
    OUT.mkdir(parents=True, exist_ok=True)
    selected = [c for c in CATEGORIES if not args.only or c["key"] in args.only]
    scorecard = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "text_model": settings.GEMINI_MODEL,
                 "image_model": ai_settings.gemini_image_model, "image_prompt_version": image_prompt.PROMPT_VERSION,
                 "mode": "live" if args.run_live else "offline", "categories": []}
    prompts_md = ["# Before/after image prompts\n", "Generated by `scripts/quality_benchmark.py`. Legacy = prompt in use before Phase 8A.1.\n"]
    images_left, text_left = args.max_images, args.max_text
    client = provider = None
    if args.run_live:
        from app.services.gemini_brand_analyzer import GeminiBrandAnalyzer
        from app.services.media_storage import GoogleImageProvider
        client = GeminiBrandAnalyzer().client
        provider = GoogleImageProvider()
    from google.genai import errors as genai_errors
    try:
      try:
        for category in selected:
            context, source = load_context(category)
            brief = category["brief"]
            entry = {"key": category["key"], "label": category["label"], "brand_source": source, "brief": brief}
            platform = category["image_platform"]
            ratio = {"Instagram": "4:5", "LinkedIn": "1:1"}.get(platform, "1:1")
            if not args.run_live:
                draft = sample_draft(context, brief, platform)
                before = legacy_image_brief(context, draft, ratio)
                after, meta = image_prompt.build_brief(context, draft, ratio)
                entry["prompt_metrics"] = {"before": prompt_metrics(before), "after": prompt_metrics(after), "after_meta": {k: meta[k] for k in ("industry_category", "style", "objective", "palette_names", "offering")}}
                prompts_md += [f"\n## {category['label']}\n", "### Before\n", "```text\n" + before + "\n```\n", "### After\n", "```text\n" + after + "\n```\n"]
                scorecard["categories"].append(entry)
                continue
            # ---- live: text (legacy vs current) ----
            if text_left < 2:
                raise SystemExit("Text budget exhausted before " + category["key"])
            legacy, legacy_ms, legacy_attempts = await legacy_text(client, context, brief)
            request = {**brief, "instructions": ""}
            current, usage = await generate(client, {"context": context, "request": request})
            text_left -= 1 + current["generation_meta"]["attempts"]
            current_content = GeneratedContent.model_validate({"posts": current["posts"]})
            legacy_request = {k: brief[k] for k in ("topic", "platforms", "content_type")}
            entry["captions"] = {"before": {**caption_metrics(legacy, context, legacy_request), "duration_ms": legacy_ms, "attempts": legacy_attempts},
                                 "after": {**caption_metrics(current_content, context, request), "duration_ms": current["generation_meta"].get("duration_ms"),
                                           "attempts": current["generation_meta"]["attempts"], "token_usage": usage}}
            # ---- live: images from each pipeline's own draft ----
            if images_left < 2:
                scorecard["categories"].append(entry); continue
            before_draft = next(p for p in legacy.model_dump()["posts"] if p["platform"] == platform)
            after_draft = {**next(p for p in current["posts"] if p["platform"] == platform), "objective": brief.get("objective")}
            before_prompt = legacy_image_brief(context, before_draft, ratio)
            after_prompt, meta = image_prompt.build_brief(context, after_draft, ratio)
            started = time.monotonic(); before_raw = await legacy_image(provider.client, before_prompt, ratio); before_ms = int((time.monotonic() - started) * 1000)
            started = time.monotonic(); after_raw, _ = await provider.generate(after_prompt, ratio); after_ms = int((time.monotonic() - started) * 1000)
            images_left -= 2
            stem = category["key"] + (f"-{args.tag}" if args.tag else "")
            (OUT / f"{stem}-before.png").write_bytes(before_raw)
            (OUT / f"{stem}-after.png").write_bytes(after_raw)
            images = {"before": {**image_metrics(before_raw, ratio, context, before_prompt), "duration_ms": before_ms, "file": f"{stem}-before.png"},
                      "after": {**image_metrics(after_raw, ratio, context, after_prompt), "duration_ms": after_ms, "file": f"{stem}-after.png",
                                "style": meta["style"], "industry_category": meta["industry_category"], "provider_request_id_present": bool(provider.meta.get("response_id"))}}
            if args.ai_review:
                for side, raw, prompt in (("before", before_raw, before_prompt), ("after", after_raw, after_prompt)):
                    review, review_usage, error = await image_quality.ai_review(provider.client, settings.GEMINI_MODEL, raw, prompt)
                    images[side]["ai_review"] = review or {"status": error}
            if category["extra_ratio"] and images_left >= 1 and not args.skip_extra:
                extra = category["extra_ratio"]
                extra_prompt, _ = image_prompt.build_brief(context, {**after_draft, "platform": "Story" if extra == "9:16" else after_draft["platform"]}, extra)
                extra_raw, _ = await provider.generate(extra_prompt, extra)
                images_left -= 1
                name = f"{category['key']}-after-{extra.replace(':', 'x')}.png"
                (OUT / name).write_bytes(extra_raw)
                images["after_extra_ratio"] = {**image_metrics(extra_raw, extra, context, extra_prompt), "file": name}
            entry["images"] = images
            entry["prompts"] = {"before": before_prompt, "after": after_prompt}
            comparison_sheet(OUT / f"{stem}-comparison.png", category["label"], before_raw, after_raw,
                             [f"{images['before']['width']}x{images['before']['height']} · {images['before']['status']}",
                              f"{images['after']['width']}x{images['after']['height']} · {images['after']['status']} · {meta['style']}"])
            prompts_md += [f"\n## {category['label']}\n", "### Before\n", "```text\n" + before_prompt + "\n```\n", "### After\n", "```text\n" + after_prompt + "\n```\n"]
            scorecard["categories"].append(entry)
            print({"category": category["key"], "images_left": images_left, "text_calls_left": text_left}, flush=True)
      except genai_errors.APIError as exc:
        # Quota/spend-cap or provider errors stop the run; completed categories are still written.
        scorecard["stopped"] = {"provider_status": exc.code, "reason": "rate_limited_or_quota" if exc.code == 429 else "provider_error"}
        print({"stopped": scorecard["stopped"]}, flush=True)
    finally:
        if provider:
            await provider.close()
        if client:
            await client.aio.aclose(); client.close()
    suffix = f"-{args.tag}" if args.tag else ""
    name = f"scorecard-live{suffix}.json" if args.run_live else "scorecard-offline.json"
    (OUT / name).write_text(json.dumps(scorecard, indent=1, ensure_ascii=False), encoding="utf-8")
    (OUT / (f"prompts-live{suffix}.md" if args.run_live else "prompts-offline.md")).write_text("\n".join(prompts_md), encoding="utf-8")
    print({"written": str(OUT / name), "categories": len(scorecard["categories"])})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-live", action="store_true")
    parser.add_argument("--max-images", type=int, default=0)
    parser.add_argument("--max-text", type=int, default=0)
    parser.add_argument("--ai-review", action="store_true")
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--tag", default="", help="suffix for output files of a repeat run")
    parser.add_argument("--skip-extra", action="store_true", help="skip the extra-ratio image")
    args = parser.parse_args()
    if args.run_live and (args.max_images <= 0 or args.max_images > 12 or args.max_text <= 0 or args.max_text > 12):
        parser.error("Live mode needs explicit --max-images (1-12) and --max-text (1-12) budgets")
    if args.run_live and not ai_settings.gemini_image_model:
        parser.error("No image model configured")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
