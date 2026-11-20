"""Post images: brand-aware briefs, admission, primary selection and revision protection.

Rules
- Images are never deleted or overwritten; each generation/upload creates a new asset.
- Changing which image a post uses is a content change: it bumps the post revision
  (blocking any active schedule through the existing database trigger) and returns an
  approved post to draft so it must be approved again.
- Image failures never affect saved text.
"""
import json
import re
from uuid import uuid4, uuid5, NAMESPACE_URL
from fastapi import HTTPException
from sqlalchemy import select, func
from app.core.intelligence_config import ai_settings
from app.models.content import Post, PostAsset
from app.models.intelligence import AIJob
from app.services.media_storage import PLATFORM_ASPECT, ASPECT_RATIOS, LocalMediaStorage
from app.services.image_prompt import build_brief, apply_operation, edit_instruction, EDIT_OPERATIONS
from app.services.content_generation import PROMOTIONAL

MAX_ASSETS_PER_POST = 20


def default_aspect(platform):
    return PLATFORM_ASPECT.get(platform, "1:1")


def resolve_aspect(platform, requested):
    ratio = requested or default_aspect(platform)
    if ratio not in ASPECT_RATIOS:
        raise HTTPException(422, f"Unsupported aspect ratio. Use one of: {', '.join(ASPECT_RATIOS)}")
    return ratio


def image_brief(context, draft, aspect_ratio, instructions="", options=None):
    """Structured brand-aware brief (see image_prompt). Returns the prompt text only."""
    return build_brief(context, draft, aspect_ratio, options, instructions)[0]


def overlay_problem(text, context):
    """Requested in-image text is published copy: apply the same claim checks as captions."""
    if not text:
        return None
    lowered = text.casefold()
    if PROMOTIONAL.search(lowered):
        return "Image text cannot contain links, awards, guarantees, rankings or testimonial wording."
    facts = json.dumps({k: context.get(k) for k in ("company_name", "description", "products_services", "industry", "guidelines")}, ensure_ascii=False).casefold()
    if any(n.strip() not in facts for n in re.findall(r"\d+(?:[.,]\d+)?\s*%?", lowered)):
        return "Image text cannot include numbers that are not in your confirmed brand profile."
    return None


def image_payload(context, draft, aspect_ratio, *, instructions="", operation="same_brief", options=None, parent=None, variant=0):
    """Brief, provenance and (for edit-capable variations) the edit instruction for one image job."""
    previous = (((parent.generation_options or {}).get("brief") or {}).get("options") if parent is not None else None)
    opts = apply_operation(operation, options, previous, variant)
    if problem := overlay_problem(opts["overlay_text"] if opts["text_in_image"] else "", context):
        raise HTTPException(422, problem)
    if operation == "refine" and parent is None:
        raise HTTPException(422, "Generate or upload an image before refining it")
    mode = "edit" if (operation in EDIT_OPERATIONS and parent is not None and ai_settings.image_edit_enabled) else "fresh"
    prompt, meta = build_brief(context, draft, aspect_ratio, opts, instructions)
    payload = {"aspect_ratio": aspect_ratio, "prompt": prompt, "brief": meta, "operation": operation, "mode": mode,
               "parent_asset_id": str(parent.id) if parent is not None else None}
    if mode == "edit":
        payload["edit_instruction"] = edit_instruction(operation, opts, instructions)
    return payload


def _require_image_model():
    from app.services import ai_provider
    if not ai_provider.image_configured():
        raise HTTPException(503, "image_provider_not_configured: Text-only drafts remain available.")


def _asset_count(db, post_id):
    return db.scalar(select(func.count()).select_from(PostAsset).where(PostAsset.post_id == post_id))


def _owned(company_id, owner):
    return [PostAsset.company_id == company_id, *[getattr(PostAsset, k) == v for k, v in owner.items()]]


def _parent(db, company_id, parent_asset_id, **owner):
    if not parent_asset_id:
        return None
    parent = db.scalar(select(PostAsset).where(*_owned(company_id, owner), PostAsset.id == parent_asset_id))
    if not parent:
        raise HTTPException(404, "Source image not found")
    return parent


def _variation_ratio(platform, aspect_ratio, operation, parent):
    inherited = parent.aspect_ratio if parent is not None and operation != "platform" and parent.aspect_ratio in ASPECT_RATIOS else None
    return resolve_aspect(platform, aspect_ratio or inherited)


def enqueue_post_image(db, company, user, post, key, context, aspect_ratio=None, instructions="", operation="same_brief", parent_asset_id=None, options=None):
    from app.services import ai_queue
    _require_image_model()
    if post.status == "archived":
        raise HTTPException(422, "Restore the post before generating images")
    if not (post.image_prompt or post.title):
        raise HTTPException(422, "Save a visual concept first")
    count = _asset_count(db, post.id)
    if count >= MAX_ASSETS_PER_POST:
        raise HTTPException(422, f"This post already has {MAX_ASSETS_PER_POST} images. Duplicate it to continue experimenting.")
    # Variations derive from the chosen image unless another version is named explicitly.
    parent = _parent(db, company.id, parent_asset_id or (post.primary_asset_id if operation != "same_brief" else None), post_id=post.id)
    ratio = _variation_ratio(post.platform, aspect_ratio, operation, parent)
    draft = {k: getattr(post, k) for k in ("platform", "content_type", "title", "hook", "image_prompt")}
    payload = {"target": "post", "post_id": str(post.id), "revision": post.revision,
               **image_payload(context, draft, ratio, instructions=instructions, operation=operation, options=options, parent=parent, variant=count)}
    return ai_queue.enqueue(db, company, user, "image_generation", key, payload, target_key=str(post.id))


def result_image_payload(context, generation_job_id, index, draft, aspect_ratio, instructions="", **variation):
    return {"target": "result", "generation_job_id": str(generation_job_id), "result_index": index, "platform": draft.get("platform"),
            **image_payload(context, draft, aspect_ratio, instructions=instructions, **variation)}


def result_draft(job, index):
    request = job.payload.get("request", {})
    return {**job.result["posts"][index], "objective": request.get("objective"), "campaign": request.get("campaign")}


def enqueue_result_image(db, company, user, job, index, key, aspect_ratio=None, instructions="", operation="same_brief", parent_asset_id=None, options=None):
    from app.services import ai_queue
    _require_image_model()
    if job.status != "completed" or index >= len(job.result.get("posts", [])):
        raise HTTPException(422, "Invalid generation result")
    draft = result_draft(job, index)
    owner = {"generation_job_id": job.id, "result_index": index}
    count = db.scalar(select(func.count()).select_from(PostAsset).where(*_owned(company.id, owner)))
    if count >= MAX_ASSETS_PER_POST:
        raise HTTPException(422, f"This result already has {MAX_ASSETS_PER_POST} images. Save it and duplicate to keep experimenting.")
    if not parent_asset_id and operation != "same_brief":
        latest = db.scalar(select(PostAsset).where(*_owned(company.id, owner)).order_by(PostAsset.created_at.desc()).limit(1))
        parent_asset_id = latest.id if latest else None
    parent = _parent(db, company.id, parent_asset_id, **owner)
    ratio = _variation_ratio(draft.get("platform"), aspect_ratio, operation, parent)
    if parent is None and options is None:
        options = job.payload.get("request", {}).get("image_options")
    payload = result_image_payload(job.payload["context"], job.id, index, draft, ratio, instructions,
                                   operation=operation, options=options, parent=parent, variant=count)
    return ai_queue.enqueue(db, company, user, "image_generation", key, payload, target_key=f"{job.id}:{index}")


def queue_images_for_results(db, job):
    """Called by the worker inside the transaction that completes a text job requesting images.

    Capacity for these jobs was reserved when the text request was admitted.
    """
    from app.services import ai_provider
    if not ai_provider.image_configured() or not job.payload.get("request", {}).get("include_images"):
        return []
    ratios = job.payload["request"].get("aspect_ratios") or {}
    options = job.payload["request"].get("image_options")
    rows = []
    for index, draft in enumerate(job.result.get("posts", [])):
        ratio = ratios.get(draft.get("platform")) or default_aspect(draft.get("platform"))
        try:
            payload = result_image_payload(job.payload["context"], job.id, index, result_draft(job, index), ratio, options=options)
        except HTTPException:
            # Requested image text failed the claim checks: fall back to the no-text default, never block the text.
            payload = result_image_payload(job.payload["context"], job.id, index, result_draft(job, index), ratio,
                                           options={**(options or {}), "text_in_image": False, "overlay_text": ""})
        image = AIJob(company_id=job.company_id, requested_by=job.requested_by, kind="image_generation",
                      request_key=uuid5(NAMESPACE_URL, f"socialai:{job.id}:image:{index}"), target_key=f"{job.id}:{index}",
                      payload=payload)
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
    options = asset.generation_options or {}
    return {"id": asset.id, "post_id": asset.post_id, "mime_type": asset.mime_type, "width": asset.width, "height": asset.height,
            "size_bytes": asset.size_bytes, "generation_model": asset.generation_model, "source": asset.source,
            "aspect_ratio": asset.aspect_ratio, "original_filename": asset.original_filename, "job_id": asset.job_id,
            "generation_job_id": asset.generation_job_id, "result_index": asset.result_index,
            "is_primary": primary_id is not None and asset.id == primary_id, "created_at": asset.created_at,
            "parent_asset_id": asset.parent_asset_id, "generation_mode": asset.generation_mode, "prompt_version": asset.prompt_version,
            "operation": options.get("operation"), "style": (options.get("brief") or {}).get("style"),
            "options": (options.get("brief") or {}).get("options"), "duration_ms": asset.duration_ms,
            # Assets from before quality checks existed are "unchecked", never an invented result.
            "quality_status": asset.quality_status or ("unchecked" if asset.source == "generated" else "not_applicable"),
            "quality_report": asset.quality_report, "review_decision": asset.review_decision, "reviewed_at": asset.reviewed_at}
