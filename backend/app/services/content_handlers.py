import uuid
from sqlalchemy import select
from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.services import ai_queue
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
        result,usage=await generate(analyzer.client,payload)
        with session_factory() as db:
            job=ai_queue.leased(db,job_id,token)
            if not job:return
            job.model_identifier=settings.GEMINI_MODEL;job.token_usage=usage
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


async def generate_image(job_id,token,payload,company_id,requested_by,session_factory,complete):
    from app.services.media_storage import GoogleImageProvider,LocalMediaStorage
    from app.models.content import PostAsset,Post
    from app.services.post_media import set_primary
    provider=GoogleImageProvider()
    try:
        raw,mime=await provider.generate(payload['prompt'],payload['aspect_ratio'])
    finally:
        await provider.close()
    store=LocalMediaStorage(); asset_id=uuid.uuid4()
    key,metadata=store.save(company_id,asset_id,raw,mime)
    committed=False
    try:
        with session_factory() as db:
            job=ai_queue.leased(db,job_id,token)
            if not job:return
            asset=PostAsset(id=asset_id,company_id=company_id,job_id=job_id,storage_key=key,source='generated',created_by=requested_by,
                            generation_model=ai_settings.gemini_image_model,aspect_ratio=payload['aspect_ratio'],**metadata)
            outcome={'asset_id':str(asset_id)}
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
            job.model_identifier=ai_settings.gemini_image_model
            job.token_usage=provider.usage
            complete(job,outcome);db.commit();committed=True
    finally:
        if not committed:store.remove(key)
