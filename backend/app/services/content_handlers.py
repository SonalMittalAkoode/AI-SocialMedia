import uuid
from sqlalchemy import select
from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.services import ai_queue, brand_social
from app.services.content_generation import generate
from app.services.extraction_errors import ExtractionError


async def handle_content_job(claimed,analyzer,session_factory):
    from app.workers.intelligence import complete
    job_id,token=claimed
    with session_factory() as db:
        job=ai_queue.leased(db,job_id,token)
        if not job:return
        payload,kind,company_id,requested_by=job.payload,job.kind,job.company_id,job.requested_by
    if kind=='content_generation':
        social_warnings = []
        if payload['request'].get('use_recent_social_posts') and brand_social.sources_for(company_id):
            with session_factory() as db:
                ai_queue.stage(db, job_id, token, 'reading_social_posts')
            profiles, social_warnings = await brand_social.read_company_style(company_id)
            with session_factory() as db:
                if not ai_queue.leased(db, job_id, token):
                    return
                ai_queue.stage(db, job_id, token, 'generating')
            if profiles:
                context = payload['context']
                payload = {**payload, 'context': {**context, 'published_social_style': profiles + context.get('published_social_style', [])}}
        result,usage=await generate(analyzer.client,payload)
        if social_warnings:
            result = {**result, 'warnings': [*result.get('warnings', []), *social_warnings]}
        with session_factory() as db:
            job=ai_queue.leased(db,job_id,token)
            if not job:return
            job.model_identifier=(result.get('generation_meta') or {}).get('model') or settings.GEMINI_MODEL;job.token_usage=usage
            job.result=result
            # Text is complete and saved regardless of what happens to the images.
            from app.services.post_media import queue_images_for_results
            images=queue_images_for_results(db,job)
            if images:result={**result,'image_jobs':images}
            elif payload.get('request',{}).get('include_images'):
                result={**result,'warnings':[*result.get('warnings',[]),'Images were requested but no image model is configured; text drafts are complete.']}
            complete(job,result);db.commit()
    elif kind=='image_generation':
        await generate_image(job_id,token,payload,company_id,requested_by,session_factory,complete)


def _sibling_filter(PostAsset,company_id,payload):
    if payload.get('target','post')=='post':
        return [PostAsset.company_id==company_id,PostAsset.post_id==uuid.UUID(payload['post_id'])]
    return [PostAsset.company_id==company_id,PostAsset.generation_job_id==uuid.UUID(payload['generation_job_id']),PostAsset.result_index==payload['result_index']]


async def generate_image(job_id,token,payload,company_id,requested_by,session_factory,complete):
    import time
    from app.services.media_storage import LocalMediaStorage
    from app.services import ai_provider
    from app.services import image_quality
    from app.models.content import PostAsset,Post
    from app.services.post_media import set_primary
    store=LocalMediaStorage()
    mode=payload.get('mode','fresh');reference=None;notes=[]
    brief=payload.get('brief') or {}
    with session_factory() as db:
        # Short read: sibling hashes for duplicate detection and, for edits, the source image.
        siblings=[h for h in db.scalars(select(PostAsset.perceptual_hash).where(*_sibling_filter(PostAsset,company_id,payload)).order_by(PostAsset.created_at.desc()).limit(20)) if h]
        parent=db.scalar(select(PostAsset).where(PostAsset.company_id==company_id,PostAsset.id==uuid.UUID(payload['parent_asset_id']))) if payload.get('parent_asset_id') else None
        parent_key=parent.storage_key if parent else None
    if mode=='edit':
        try:reference=store.path(parent_key).read_bytes() if parent_key else None
        except (OSError,ExtractionError):reference=None
        if reference is None:
            mode='fresh';notes.append('The source image file was unavailable, so a new image was generated from the brief instead of an edit.')
    prompt=payload['prompt'] if mode=='fresh' else payload['edit_instruction']+'\n\nOriginal brief for reference:\n'+payload['prompt']
    provider=ai_provider.create_image_provider()
    started=time.monotonic()
    try:
        raw,mime=await provider.generate(prompt,payload['aspect_ratio'],reference=reference) if reference else await provider.generate(prompt,payload['aspect_ratio'])
        duration=int((time.monotonic()-started)*1000)
        asset_id=uuid.uuid4()
        key,metadata=store.save(company_id,asset_id,raw,mime)
        try:
            stored=store.path(key).read_bytes()
            report,phash=image_quality.evaluate(stored,metadata['mime_type'],payload['aspect_ratio'],brief.get('palette') or [],siblings,bool(brief.get('text_in_image')),edit=mode=='edit')
            if ai_settings.image_review:
                from app.core.config import settings as app_settings
                overlay=(brief.get('options') or {}).get('overlay_text','') if brief.get('text_in_image') else ''
                review,review_usage,review_error=await image_quality.ai_review(provider.client,ai_settings.image_review_model or (ai_provider.text_model() if getattr(provider,'provider',None)=='openai' else app_settings.GEMINI_MODEL),stored,payload['prompt'],overlay,ai_settings.image_review_timeout)
                report=image_quality.merge_review(report,review,overlay,review_error)
                if review_usage:report['ai_review']['token_usage']=review_usage
            else:
                report=image_quality.merge_review(report,None)
        except BaseException:
            store.remove(key);raise
    finally:
        await provider.close()
    if notes:report['notes']=notes
    # The model that actually produced this image (historical Gemini assets keep their own value).
    used_model=getattr(provider,'model',None) or ai_settings.gemini_image_model
    committed=False
    try:
        with session_factory() as db:
            job=ai_queue.leased(db,job_id,token)
            if not job:return
            asset=PostAsset(id=asset_id,company_id=company_id,job_id=job_id,storage_key=key,source='generated',created_by=requested_by,
                            generation_model=used_model,aspect_ratio=payload['aspect_ratio'],
                            parent_asset_id=uuid.UUID(payload['parent_asset_id']) if payload.get('parent_asset_id') else None,
                            generation_mode=mode,prompt_version=brief.get('prompt_version'),
                            generation_options={'operation':payload.get('operation','same_brief'),'brief':brief},
                            provider_request_id=provider.meta.get('response_id'),duration_ms=duration,perceptual_hash=phash,
                            quality_status=report['status'],quality_report=report,**metadata)
            outcome={'asset_id':str(asset_id),'quality_status':report['status'],'mode':mode,'duration_ms':duration,
                     'prompt_version':brief.get('prompt_version'),**({'provider_request_id':provider.meta['response_id']} if provider.meta.get('response_id') else {})}
            if notes:outcome['notes']=notes
            if payload.get('target','post')=='post':
                post=db.scalar(select(Post).where(Post.company_id==company_id,Post.id==payload['post_id']).with_for_update())
                if not post:raise ExtractionError('post_unavailable','The post is no longer available. No image was attached.')
                if post.status=='archived':raise ExtractionError('post_archived','The post was archived while the image was generated. Restore it and request a new image.')
                asset.post_id=post.id;db.add(asset);db.flush()
                if post.revision==payload['revision']:
                    set_primary(db,post,asset);outcome['primary']=True
                else:
                    # Never discard a paid image: keep it as an alternative the user can select.
                    outcome['primary']=False;outcome['note']='The post changed during generation; the image was added as an alternative.'
                outcome['post_id']=str(post.id)
            else:
                asset.generation_job_id=uuid.UUID(payload['generation_job_id']);asset.result_index=payload['result_index']
                saved=db.scalar(select(Post).where(Post.company_id==company_id,Post.generation_job_id==asset.generation_job_id,Post.result_index==asset.result_index).with_for_update())
                if saved:
                    asset.post_id=saved.id;db.add(asset);db.flush()
                    if saved.primary_asset_id is None and saved.status not in ('approved','archived'):set_primary(db,saved,asset)
                    outcome['post_id']=str(saved.id)
                else:db.add(asset)
                outcome.update(generation_job_id=payload['generation_job_id'],result_index=payload['result_index'])
            job.model_identifier=used_model
            job.token_usage=provider.usage
            complete(job,outcome);db.commit();committed=True
    finally:
        if not committed:store.remove(key)
