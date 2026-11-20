import re
from uuid import UUID,uuid4
from fastapi import APIRouter,Depends,HTTPException,Query,Request
from fastapi.responses import FileResponse
from sqlalchemy import select,or_
from app.api.auth import current_user
from app.api.onboarding import storage,request_policy
from app.api.intelligence import job_access
from app.core.permissions import company_access
from app.core.intelligence_config import ai_settings
from app.models.content import Post,PostAsset,PostVersion
from app.models.intelligence import AIJob
from app.schemas.content import (GenerationRequest,PostCreate,PostUpdate,PostResponse,RevisionRequest,ContentDraft,
    RegenerateRequest,ImageRequest,PrimaryAssetRequest,AssetReview)
from app.schemas.intelligence import AIJobResponse,JobRequest
from app.services import ai_queue, brand_social, post_media
from app.services.content_generation import context_for
from app.services.extraction_errors import ExtractionError
from app.services.onboarding import transaction,check_revision
from app.services.extraction_jobs import now

router=APIRouter(prefix='/companies/{company_id}',tags=['Content'],dependencies=[Depends(request_policy)])


def post_access(db,company_id,post_id):
    post=db.scalar(select(Post).where(Post.company_id==company_id,Post.id==post_id))
    if not post:raise HTTPException(404,'Post not found')
    return post


@router.post('/content-generations',response_model=AIJobResponse,status_code=202)
def start(company_id:UUID,data:GenerationRequest,user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True)
    if len(data.platforms)>ai_settings.max_posts:raise HTTPException(422,'Too many posts requested')
    context = context_for(db, company)
    if profile := brand_social.manual_profile(data.published_caption_examples):
        context['published_social_style'] = [profile]
    payload={'context':context,'request':data.model_dump(exclude={'request_key','published_caption_examples'})}
    # Reserve capacity now for the per-result image jobs the worker will queue after the text.
    from app.services import ai_provider
    extra=len(data.platforms) if data.include_images and ai_provider.image_configured() else 0
    return ai_queue.enqueue(db,company,user,'content_generation',data.request_key,payload,extra_capacity=extra)


@router.get('/content-generations/{job_id}',response_model=AIJobResponse)
def status(company_id:UUID,job_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);return job_access(db,company_id,job_id,'content_generation')


@router.get('/content-generations/{job_id}/result')
def result(company_id:UUID,job_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);job=job_access(db,company_id,job_id,'content_generation')
    if job.status!='completed':raise HTTPException(409,'Content is not available yet')
    return job.result


@router.get('/content-generations/{job_id}/media')
def generation_media(company_id:UUID,job_id:UUID,user=Depends(current_user),db=Depends(storage)):
    """Images and image-job states for each result of one generation (saved or not)."""
    company_access(db,user,company_id);job=job_access(db,company_id,job_id,'content_generation')
    prefix=f'{job.id}:'
    jobs=db.scalars(select(AIJob).where(AIJob.company_id==company_id,AIJob.kind=='image_generation',AIJob.target_key.startswith(prefix,autoescape=True)).order_by(AIJob.created_at)).all()
    # The worker commits completion and its asset together. Read job state first so
    # a commit between these reads cannot produce a completed job with no image.
    assets=db.scalars(select(PostAsset).where(PostAsset.company_id==company_id,PostAsset.generation_job_id==job.id).order_by(PostAsset.created_at)).all()
    return {'assets':[post_media.asset_view(a) for a in assets],
            'jobs':[{**AIJobResponse.model_validate(j).model_dump(mode='json'),'result_index':int(j.target_key.split(':')[1]),'aspect_ratio':j.payload.get('aspect_ratio')} for j in jobs]}


@router.post('/content-generations/{job_id}/results/{index}/images',response_model=AIJobResponse,status_code=202)
def result_image(company_id:UUID,job_id:UUID,index:int,data:ImageRequest,user=Depends(current_user),db=Depends(storage)):
    """Generate or regenerate the image for an unsaved result; earlier images are kept."""
    company=company_access(db,user,company_id,True);job=job_access(db,company_id,job_id,'content_generation')
    if not 0<=index<=2:raise HTTPException(422,'Invalid generation result')
    return post_media.enqueue_result_image(db,company,user,job,index,data.request_key,data.aspect_ratio,data.instructions,
                                           data.operation,data.parent_asset_id,data.options.model_dump() if data.options else None)


@router.post('/content-generations/{job_id}/results/{index}/caption',response_model=AIJobResponse,status_code=202)
def result_caption(company_id:UUID,job_id:UUID,index:int,data:RegenerateRequest,user=Depends(current_user),db=Depends(storage)):
    """New caption, hook, CTA and hashtags for an unsaved result. Nothing is overwritten: the
    Studio shows the suggestion and the user decides whether to apply it. No images are generated."""
    company=company_access(db,user,company_id,True);job=job_access(db,company_id,job_id,'content_generation')
    if job.status!='completed' or not 0<=index<len(job.result.get('posts',[])):raise HTTPException(422,'Invalid generation result')
    draft=job.result['posts'][index];original=job.payload.get('request',{})
    instructions=f"{CAPTION_ONLY} Current caption (do not repeat): {draft['caption'][:600]} Visual concept to keep: {draft.get('image_prompt','')[:400]}"
    if data.instructions:instructions+=f' User direction: {data.instructions}'
    request={'platforms':[draft['platform']],'content_type':draft['content_type'],'topic':draft['title'],'instructions':instructions[:1500],
             'regenerate_mode':'caption','source_result':f'{job.id}:{index}'}
    request.update({k:original[k] for k in ('objective','audience','tone','campaign','evidence') if original.get(k)})
    context = context_for(db, company)
    if profiles := job.result.get('strategy', {}).get('published_social_style'):
        context['published_social_style'] = profiles
    return ai_queue.enqueue(db,company,user,'content_generation',data.request_key,{'context':context,'request':request})


@router.get('/posts',response_model=list[PostResponse])
def posts(company_id:UUID,q:str=Query('',max_length=200),platform:str|None=None,status:str|None=None,limit:int=Query(50,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    query=select(Post).where(Post.company_id==company_id)
    if platform:query=query.where(Post.platform==platform)
    if status:query=query.where(Post.status==status)
    if q:query=query.where(or_(Post.title.icontains(q,autoescape=True),Post.caption.icontains(q,autoescape=True)))
    return db.scalars(query.order_by(Post.updated_at.desc(),Post.id).limit(limit).offset(offset)).all()


@router.post('/posts',response_model=PostResponse,status_code=201)
def create(company_id:UUID,data:PostCreate,user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True)
    existing=db.scalar(select(Post).where(Post.company_id==company_id,Post.creation_key==data.creation_key))
    if existing:return existing
    if data.generation_job_id:
        job=job_access(db,company_id,data.generation_job_id,'content_generation')
        if job.status!='completed' or data.result_index is None or data.result_index>=len(job.result['posts']):raise HTTPException(422,'Invalid generation result')
        existing=db.scalar(select(Post).where(Post.company_id==company_id,Post.generation_job_id==job.id,Post.result_index==data.result_index))
        if existing:return existing
        if company.brand.revision!=job.payload['context']['brand_revision']:raise HTTPException(409,'Brand changed. Regenerate or save as a reviewed manual draft.')
    elif data.result_index is not None:raise HTTPException(422,'Result index requires a generation job')
    post=Post(company_id=company_id,created_by=user.id,**data.model_dump())
    with transaction(db):
        db.add(post);db.flush()
        # Images already generated for this result move to the saved post.
        post_media.link_result_assets(db,post)
    return post


@router.get('/posts/{post_id}',response_model=PostResponse)
def detail(company_id:UUID,post_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);return post_access(db,company_id,post_id)


@router.patch('/posts/{post_id}',response_model=PostResponse)
def edit(company_id:UUID,post_id:UUID,data:PostUpdate,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id,True);post=post_access(db,company_id,post_id);check_revision(post,data.revision)
    changes=data.model_dump(exclude={'revision'})
    # Editing approved text requires review again; explicit approval is a separate action.
    text_changed=any(getattr(post,k)!=v for k,v in changes.items() if k!='status')
    if data.status=='approved' and (post.status!='approved' or text_changed):raise HTTPException(422,'Save edits as a draft, then approve explicitly')
    with transaction(db):
        for key,value in changes.items():setattr(post,key,value)
    return post


@router.post('/posts/{post_id}/approve',response_model=PostResponse)
def approve(company_id:UUID,post_id:UUID,data:RevisionRequest,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id,True);post=post_access(db,company_id,post_id);check_revision(post,data.revision)
    if post.status=='archived':raise HTTPException(422,'Restore before approving')
    if post.primary_asset_id:
        primary=db.get(PostAsset,post.primary_asset_id)
        if primary and primary.review_decision=='rejected':raise HTTPException(422,'The chosen image was rejected. Choose another image or make the post text-only before approving.')
    with transaction(db):post.status='approved'
    return post


@router.post('/posts/{post_id}/duplicate',response_model=PostResponse,status_code=201)
def duplicate(company_id:UUID,post_id:UUID,data:JobRequest,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id,True);source=post_access(db,company_id,post_id)
    existing=db.scalar(select(Post).where(Post.company_id==company_id,Post.creation_key==data.request_key))
    if existing:return existing
    post=Post(company_id=company_id,created_by=user.id,creation_key=data.request_key,**ContentDraft.model_validate(source,from_attributes=True).model_dump())
    with transaction(db):
        db.add(post);db.flush()
        # An independent copy of the chosen image; the source post and its media are untouched.
        post_media.duplicate_primary(db,source,post,user)
    return post


CAPTION_ONLY=('Rewrite ONLY the caption, hook, call to action and hashtags for this same post. Keep the same platform, '
              'content type, topic and visual concept so the existing image still fits. Make it clearly different from the current caption.')


@router.post('/posts/{post_id}/regenerate',response_model=AIJobResponse,status_code=202)
def regenerate(company_id:UUID,post_id:UUID,data:RegenerateRequest,user=Depends(current_user),db=Depends(storage)):
    """Creates a separate generation; the saved post and its images are never overwritten here."""
    company=company_access(db,user,company_id,True);post=post_access(db,company_id,post_id)
    if data.mode=='caption':
        instructions=f'{CAPTION_ONLY} Current caption (do not repeat): {post.caption[:600]} Visual concept to keep: {post.image_prompt[:400]}'
    else:
        instructions='Create a fresh alternative. Do not overwrite saved content.'
    if data.instructions:instructions+=f' User direction: {data.instructions}'
    context = context_for(db, company)
    if post.generation_job_id:
        previous = db.scalar(select(AIJob).where(AIJob.id == post.generation_job_id, AIJob.company_id == company_id))
        if previous and previous.result and (profiles := previous.result.get('strategy', {}).get('published_social_style')):
            context['published_social_style'] = profiles
    return ai_queue.enqueue(db,company,user,'content_generation',data.request_key,{'context':context,'request':{'platforms':[post.platform],'content_type':post.content_type,'topic':post.title,'instructions':instructions[:1500],'regenerate_mode':data.mode,'source_post_id':str(post.id)}})


@router.post('/posts/{post_id}/images',response_model=AIJobResponse,status_code=202)
def images(company_id:UUID,post_id:UUID,data:ImageRequest,user=Depends(current_user),db=Depends(storage)):
    """Generate or regenerate a post image. Earlier images are kept; the new one becomes primary.
    For an approved post this returns it to draft when the image is attached (revision protection)."""
    company=company_access(db,user,company_id,True);post=post_access(db,company_id,post_id)
    return post_media.enqueue_post_image(db,company,user,post,data.request_key,context_for(db,company),data.aspect_ratio,data.instructions,
                                         data.operation,data.parent_asset_id,data.options.model_dump() if data.options else None)


@router.get('/posts/{post_id}/assets')
def assets(company_id:UUID,post_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);post=post_access(db,company_id,post_id)
    rows=db.scalars(select(PostAsset).where(PostAsset.company_id==company_id,PostAsset.post_id==post_id).order_by(PostAsset.created_at.desc(),PostAsset.id)).all()
    # Primary image first, then newest first.
    rows=sorted(rows,key=lambda a:a.id!=post.primary_asset_id)
    return [post_media.asset_view(a,post.primary_asset_id) for a in rows]


@router.put('/posts/{post_id}/primary-asset',response_model=PostResponse)
def primary_asset(company_id:UUID,post_id:UUID,data:PrimaryAssetRequest,user=Depends(current_user),db=Depends(storage)):
    """Choose (or clear) the image the post uses. Approved posts return to draft."""
    company_access(db,user,company_id,True);post=post_access(db,company_id,post_id);check_revision(post,data.revision)
    if post.status=='archived':raise HTTPException(422,'Restore before changing images')
    asset=None
    if data.asset_id:
        asset=db.scalar(select(PostAsset).where(PostAsset.company_id==company_id,PostAsset.post_id==post.id,PostAsset.id==data.asset_id))
        if not asset:raise HTTPException(404,'Asset not found')
    with transaction(db):post_media.set_primary(db,post,asset)
    return post


UPLOAD_TYPES={'image/png','image/jpeg','image/webp'}


@router.post('/posts/{post_id}/assets/upload',status_code=201)
async def upload(company_id:UUID,post_id:UUID,request:Request,revision:int=Query(ge=1),filename:str=Query('',max_length=255),user=Depends(current_user),db=Depends(storage)):
    """Raw-body image upload (Content-Type image/png|jpeg|webp, optional ?filename=).

    The file is validated, metadata-stripped and re-encoded before private storage. It becomes
    the post's image; an approved post returns to draft (revision protection).
    """
    from app.services.media_storage import LocalMediaStorage,aspect_label
    company_access(db,user,company_id,True);post=post_access(db,company_id,post_id);check_revision(post,revision)
    if post.status=='archived':raise HTTPException(422,'Restore before changing images')
    mime=request.headers.get('content-type','').split(';')[0].strip().lower()
    if mime not in UPLOAD_TYPES:raise HTTPException(415,'Upload a PNG, JPEG or WEBP image')
    body=bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body)>ai_settings.max_image_bytes:raise HTTPException(413,f'Images must be {ai_settings.max_image_bytes//1_000_000} MB or smaller')
    if post_media._asset_count(db,post.id)>=post_media.MAX_ASSETS_PER_POST:raise HTTPException(422,'This post has reached its image limit')
    raw_name=re.split(r'[\\/]',filename)[-1]
    name=re.sub(r'[^\w.\- ]','',raw_name).lstrip('. ')[:120] or None
    store=LocalMediaStorage();asset_id=uuid4()
    try:key,meta=store.save(company_id,asset_id,bytes(body),mime)
    except ExtractionError as exc:raise HTTPException(422,exc.message) from None
    try:
        with transaction(db):
            asset=PostAsset(id=asset_id,company_id=company_id,post_id=post.id,source='uploaded',storage_key=key,original_filename=name,
                            generation_model='manual-upload',aspect_ratio=aspect_label(meta['width'],meta['height']),created_by=user.id,**meta)
            db.add(asset);db.flush()
            post_media.set_primary(db,post,asset)
    except BaseException:
        store.remove(key);raise
    return {'asset':post_media.asset_view(asset,post.primary_asset_id),'post':PostResponse.model_validate(post).model_dump(mode='json')}


@router.get('/posts/{post_id}/versions')
def versions(company_id:UUID,post_id:UUID,limit:int=Query(20,ge=1,le=100),user=Depends(current_user),db=Depends(storage)):
    """Earlier saved states of a post, newest first (append-only, written by the database)."""
    company_access(db,user,company_id);post_access(db,company_id,post_id)
    rows=db.scalars(select(PostVersion).where(PostVersion.company_id==company_id,PostVersion.post_id==post_id).order_by(PostVersion.revision.desc()).limit(limit)).all()
    return [{'revision':v.revision,'snapshot':v.snapshot,'created_at':v.created_at} for v in rows]


@router.post('/media/{asset_id}/review')
def review_asset(company_id:UUID,asset_id:UUID,data:AssetReview,user=Depends(current_user),db=Depends(storage)):
    """Record the reviewer's accept/reject decision (or clear it). Images are never deleted, and the
    decision does not change which image a post uses; approving a post with a rejected image is blocked."""
    company_access(db,user,company_id,True)
    asset=db.scalar(select(PostAsset).where(PostAsset.company_id==company_id,PostAsset.id==asset_id).with_for_update())
    if not asset:raise HTTPException(404,'Asset not found')
    with transaction(db):
        asset.review_decision=data.decision
        asset.reviewed_by=user.id if data.decision else None
        asset.reviewed_at=now() if data.decision else None
    primary=db.scalar(select(Post.primary_asset_id).where(Post.company_id==company_id,Post.id==asset.post_id)) if asset.post_id else None
    return post_media.asset_view(asset,primary)


@router.get('/media/{asset_id}')
def media(company_id:UUID,asset_id:UUID,download:bool=False,user=Depends(current_user),db=Depends(storage)):
    from app.services.media_storage import LocalMediaStorage
    company_access(db,user,company_id)
    asset=db.scalar(select(PostAsset).where(PostAsset.company_id==company_id,PostAsset.id==asset_id))
    if not asset:raise HTTPException(404,'Asset not found')
    path=LocalMediaStorage().path(asset.storage_key)
    if not path.is_file():raise HTTPException(404,'Asset file is unavailable')
    stem=re.sub(r'[^\w\-]','',(asset.original_filename or '').rsplit('.',1)[0])[:60] or f'socialai-{asset.id}'
    return FileResponse(path,media_type=asset.mime_type,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},filename=f'{stem}.png',content_disposition_type='attachment' if download else 'inline')
