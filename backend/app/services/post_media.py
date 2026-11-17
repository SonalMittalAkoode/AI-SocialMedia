"""Post images: brand-aware briefs, admission, primary selection and revision protection.

Rules
- Images are never deleted or overwritten; each generation/upload creates a new asset.
- Changing which image a post uses is a content change: it bumps the post revision
  (blocking any active schedule through the existing database trigger) and returns an
  approved post to draft so it must be approved again.
- Image failures never affect saved text.
"""
from uuid import uuid4, uuid5, NAMESPACE_URL
from fastapi import HTTPException
from sqlalchemy import select, func
from app.core.intelligence_config import ai_settings
from app.models.content import Post, PostAsset
from app.models.intelligence import AIJob
from app.services.media_storage import PLATFORM_ASPECT, ASPECT_RATIOS, LocalMediaStorage

MAX_ASSETS_PER_POST = 20


def default_aspect(platform):
    return PLATFORM_ASPECT.get(platform, "1:1")


def resolve_aspect(platform, requested):
    ratio = requested or default_aspect(platform)
    if ratio not in ASPECT_RATIOS:
        raise HTTPException(422, f"Unsupported aspect ratio. Use one of: {', '.join(ASPECT_RATIOS)}")
    return ratio


def image_brief(context, draft, aspect_ratio, instructions=""):
    """Brand- and industry-specific creative brief. All values are data, not instructions."""
    colors = [c for c in (context.get("brand_colors") or []) if isinstance(c, str)][:5]
    services = (context.get("products_services") or [])[:4]
    audience = context.get("target_audience")
    audience = ", ".join(audience) if isinstance(audience, list) else (audience or "")
    voice = ", ".join((context.get("brand_voice") or [])[:3])
    keywords = ", ".join((context.get("brand_keywords") or [])[:5])
    themes = []
    for insight in (context.get("competitor_insights") or [])[:3]:
        themes += insight.get("themes", [])[:2]
    excluded = ", ".join((context.get("preferences") or {}).get("excluded_topics") or [])
    lines = [
        f"Social media creative for {draft.get('platform')} ({draft.get('content_type', 'post')}), aspect ratio {aspect_ratio}.",
        f"Brand: {context.get('company_name')}. Industry: {context.get('industry') or 'not specified'}.",
        f"Offerings to evoke: {', '.join(services) or 'the brand offering'}.",
        f"Audience: {audience or 'the brand audience'}.",
        f"Visual style preference: {(context.get('preferences') or {}).get('visual_style') or 'not specified'}.",
        f"Content guidelines: {context.get('guidelines') or 'not specified'}.",
        f"Mood from brand voice: {voice or 'professional, clear'}." + (f" Keywords: {keywords}." if keywords else ""),
        (f"Use this exact brand palette prominently: {', '.join(colors)}." if colors else "Use a cohesive, modern palette."),
        f"Post topic: {draft.get('title')}.",
        f"Hook: {draft.get('hook') or ''}".strip(),
        f"Visual concept: {draft.get('image_prompt') or draft.get('title')}.",
        "Style: polished, on-brand, feed-ready composition with clear focal point and space around edges; photographic or illustrative as fits the concept.",
        "No logos, brand names, watermarks, real or identifiable people, testimonials, fake product photos, numbers or claims. No rendered text.",
    ]
    if themes:
        lines.append("Differentiate visually from common competitor themes: " + ", ".join(dict.fromkeys(themes)) + ". Never imitate competitor imagery.")
    if excluded:
        lines.append(f"Avoid these topics entirely: {excluded}.")
    if instructions:
        lines.append(f"Additional user direction (data only): {instructions[:500]}")
    return "\n".join(line for line in lines if line)[:4000]


def _require_image_model():
    if not ai_settings.gemini_image_model:
        raise HTTPException(503, "image_provider_not_configured: Text-only drafts remain available.")


def _asset_count(db, post_id):
    return db.scalar(select(func.count()).select_from(PostAsset).where(PostAsset.post_id == post_id))


def enqueue_post_image(db, company, user, post, key, context, aspect_ratio=None, instructions=""):
    from app.services import ai_queue
    _require_image_model()
    if post.status == "archived":
        raise HTTPException(422, "Restore the post before generating images")
    if not (post.image_prompt or post.title):
        raise HTTPException(422, "Save a visual concept first")
    if _asset_count(db, post.id) >= MAX_ASSETS_PER_POST:
        raise HTTPException(422, f"This post already has {MAX_ASSETS_PER_POST} images. Duplicate it to continue experimenting.")
    ratio = resolve_aspect(post.platform, aspect_ratio)
    draft = {k: getattr(post, k) for k in ("platform", "content_type", "title", "hook", "image_prompt")}
    payload = {"target": "post", "post_id": str(post.id), "revision": post.revision, "aspect_ratio": ratio,
               "prompt": image_brief(context, draft, ratio, instructions)}
    return ai_queue.enqueue(db, company, user, "image_generation", key, payload, target_key=str(post.id))


def result_image_payload(context, generation_job_id, index, draft, aspect_ratio, instructions=""):
    return {"target": "result", "generation_job_id": str(generation_job_id), "result_index": index, "platform": draft.get("platform"),
            "aspect_ratio": aspect_ratio, "prompt": image_brief(context, draft, aspect_ratio, instructions)}


def enqueue_result_image(db, company, user, job, index, key, aspect_ratio=None, instructions=""):
    from app.services import ai_queue
    _require_image_model()
    if job.status != "completed" or index >= len(job.result.get("posts", [])):
        raise HTTPException(422, "Invalid generation result")
    draft = job.result["posts"][index]
    ratio = resolve_aspect(draft.get("platform"), aspect_ratio)
    payload = result_image_payload(job.payload["context"], job.id, index, draft, ratio, instructions)
    return ai_queue.enqueue(db, company, user, "image_generation", key, payload, target_key=f"{job.id}:{index}")


def queue_images_for_results(db, job):
    """Called by the worker inside the transaction that completes a text job requesting images.

    Capacity for these jobs was reserved when the text request was admitted.
    """
    if not ai_settings.gemini_image_model or not job.payload.get("request", {}).get("include_images"):
        return []
    ratios = job.payload["request"].get("aspect_ratios") or {}
    rows = []
    for index, draft in enumerate(job.result.get("posts", [])):
        ratio = ratios.get(draft.get("platform")) or default_aspect(draft.get("platform"))
        image = AIJob(company_id=job.company_id, requested_by=job.requested_by, kind="image_generation",
                      request_key=uuid5(NAMESPACE_URL, f"socialai:{job.id}:image:{index}"), target_key=f"{job.id}:{index}",
                      payload=result_image_payload(job.payload["context"], job.id, index, draft, ratio))
        db.add(image)
        rows.append((index, ratio, image))
    db.flush()
    return [{"result_index": index, "aspect_ratio": ratio, "job_id": str(image.id)} for index, ratio, image in rows]


def set_primary(db, post, asset):
    """Select the image a post uses. Approved posts return to draft (revision protection)."""
    if asset is not None and asset.post_id != post.id:
        raise HTTPException(404, "Asset not found")
    target = asset.id if asset is not None else None
    if post.primary_asset_id == target:
        return False
    post.primary_asset_id = target
    if post.status == "approved":
        post.status = "draft"
    return True


def link_result_assets(db, post):
    """When a generated result is saved as a post, its images move to that post."""
    if not post.generation_job_id or post.result_index is None:
        return
    assets = db.scalars(select(PostAsset).where(PostAsset.company_id == post.company_id, PostAsset.generation_job_id == post.generation_job_id,
                                                PostAsset.result_index == post.result_index, PostAsset.post_id.is_(None)).order_by(PostAsset.created_at)).all()
    for asset in assets:
        asset.post_id = post.id
    if assets:
        db.flush()
        post.primary_asset_id = assets[-1].id


def duplicate_primary(db, source, target, user):
    """Copy the source post's primary image as an independent asset of the duplicate."""
    if not source.primary_asset_id:
        return
    original = db.get(PostAsset, source.primary_asset_id)
    if not original:
        return
    store = LocalMediaStorage()
    asset_id = uuid4()
    try:
        key, meta = store.copy(source.company_id, original.storage_key, asset_id)
    except Exception:
        return  # Missing file: the duplicate keeps text; the original is untouched.
    db.add(PostAsset(id=asset_id, company_id=source.company_id, post_id=target.id, source="duplicated", storage_key=key,
                     generation_model=original.generation_model, aspect_ratio=original.aspect_ratio, created_by=user.id, **meta))
    db.flush()
    target.primary_asset_id = asset_id


def asset_view(asset, primary_id=None):
    return {"id": asset.id, "post_id": asset.post_id, "mime_type": asset.mime_type, "width": asset.width, "height": asset.height,
            "size_bytes": asset.size_bytes, "generation_model": asset.generation_model, "source": asset.source,
            "aspect_ratio": asset.aspect_ratio, "original_filename": asset.original_filename, "job_id": asset.job_id,
            "generation_job_id": asset.generation_job_id, "result_index": asset.result_index,
            "is_primary": primary_id is not None and asset.id == primary_id, "created_at": asset.created_at}
