"""Authorized callers lock company -> post -> schedule. No external calls."""
import hashlib
import json
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select, func, text
from app.models.content import Post,PostAsset
from app.models.onboarding import Company
from app.models.scheduling import PostSchedule
from app.models.schedule_events import ScheduleEvent
from app.core.scheduling_config import scheduling_settings
from app.core.timezones import effective_timezone,local_to_utc,as_utc
from app.services.scheduling_policy import validate_plan,validate_transition
from app.services.onboarding import transaction,check_revision
from app.schemas.scheduling import ScheduleResponse


def zone_for(company):
    return effective_timezone(company.timezone,scheduling_settings.default_timezone)


def actor(db,user_id,fingerprint=None):
    db.execute(select(func.set_config('socialai.actor_id',str(user_id) if user_id else '',True)))
    db.execute(select(func.set_config('socialai.schedule_request_hash',fingerprint or '',True)))


def post_lock(db,company_id,post_id):
    row=db.scalar(select(Post).where(Post.company_id==company_id,Post.id==post_id).with_for_update())
    if not row:raise HTTPException(404,'Post not found')
    return row


def schedule_access(db,company_id,schedule_id,lock=False):
    query=select(PostSchedule).where(PostSchedule.company_id==company_id,PostSchedule.id==schedule_id)
    row=db.scalar(query.with_for_update() if lock else query)
    if not row:raise HTTPException(404,'Schedule not found')
    return row


def plan_instant(db,company,post,data,platform):
    zone=data.timezone or zone_for(company)
    try:
        instant=local_to_utc(datetime.combine(data.local_date,data.local_time),zone,fold=data.fold)
        validate_plan(post,company_id=company.id,post_revision=data.post_revision,platform=platform,
                      scheduled_at=instant,now=as_utc(db.scalar(select(func.clock_timestamp()))))
    except ValueError as exc:raise HTTPException(422,str(exc)) from None
    return instant,zone


def create(db,company,user,data):
    # Hash the explicit normalized request, not current schedule fields. Replays
    # remain valid after rescheduling/cancellation or changes in company defaults.
    fingerprint=hashlib.sha256(json.dumps(data.model_dump(mode='json',exclude={'idempotency_key'}),sort_keys=True,separators=(',',':')).encode()).hexdigest()
    existing=db.scalar(select(PostSchedule).where(PostSchedule.company_id==company.id,PostSchedule.idempotency_key==data.idempotency_key))
    if existing:
        original=db.scalar(select(ScheduleEvent.request_fingerprint).where(ScheduleEvent.schedule_id==existing.id,ScheduleEvent.event_type=='created'))
        if original!=fingerprint:raise HTTPException(409,'Idempotency key belongs to a different scheduling request')
        return existing
    post=post_lock(db,company.id,data.post_id)
    instant,zone=plan_instant(db,company,post,data,data.target_platform)
    active=db.scalar(select(PostSchedule.id).where(PostSchedule.company_id==company.id,PostSchedule.post_id==post.id,PostSchedule.target_platform==data.target_platform,PostSchedule.status.in_(['scheduled','blocked','awaiting_publisher'])))
    if active:raise HTTPException(409,'This post already has an active schedule. Reschedule or cancel it in Calendar.')
    row=PostSchedule(company_id=company.id,post_id=post.id,created_by=user.id,target_platform=data.target_platform,
        scheduled_at=instant,timezone=zone,post_revision=data.post_revision,idempotency_key=data.idempotency_key)
    with transaction(db):actor(db,user.id,fingerprint);db.add(row);db.flush();db.refresh(row)
    return row


def change(db,company,user,schedule_id,data,cancel=False):
    locator=schedule_access(db,company.id,schedule_id)
    post=post_lock(db,company.id,locator.post_id)
    row=schedule_access(db,company.id,schedule_id,True)
    # Post lookup above is read-only; refresh avoids a stale identity-map version
    # after another transaction or the post-invalidation database trigger.
    db.refresh(row)
    if cancel and row.status=='cancelled':return row
    check_revision(row,data.revision)
    target='cancelled' if cancel else 'scheduled'
    try:validate_transition(row.status,target,explicit_reschedule=not cancel)
    except ValueError as exc:raise HTTPException(422,str(exc)) from None
    values={} if cancel else dict(zip(('scheduled_at','timezone'),plan_instant(db,company,post,data,row.target_platform)))
    with transaction(db):
        actor(db,user.id);row.status=target
        if not cancel:
            row.post_revision=data.post_revision
            for name,value in values.items():setattr(row,name,value)
        db.flush();db.refresh(row)
    return row


def calendar_rows(db,company_id,start,end,platform,status,limit,offset,schedule_id=None):
    # Joined post projection and one correlated asset existence check: no N+1.
    has_asset=select(PostAsset.id).where(PostAsset.post_id==Post.id,PostAsset.company_id==company_id).exists()
    query=select(PostSchedule,Post.title,Post.caption,Post.status,Post.revision,has_asset,Company.timezone).join(Post,(Post.id==PostSchedule.post_id)&(Post.company_id==PostSchedule.company_id)).join(Company,Company.id==PostSchedule.company_id).where(PostSchedule.company_id==company_id)
    if start is not None:query=query.where(PostSchedule.scheduled_at>=start)
    if end is not None:query=query.where(PostSchedule.scheduled_at<end)
    if platform:query=query.where(PostSchedule.target_platform==platform)
    if status:query=query.where(PostSchedule.status==status)
    if schedule_id:query=query.where(PostSchedule.id==schedule_id)
    output=[]
    for row,title,caption,approval,revision,has_media,company_zone in db.execute(query.order_by(PostSchedule.scheduled_at,PostSchedule.id).limit(limit).offset(offset)):
        warnings=['Publishing integration is not connected yet. This post remains saved and awaiting publication.']
        if approval!='approved' or revision!=row.post_revision:warnings.append('Post changed or approval was removed. Approve the current draft and explicitly reschedule.')
        if row.target_platform=='Instagram' and not has_media:warnings.append('Instagram publishing will require a suitable media asset.')
        output.append({**ScheduleResponse.model_validate(row).model_dump(),'company_timezone':effective_timezone(company_zone,scheduling_settings.default_timezone),'title':title,'preview':caption[:200],'approval_status':approval,'current_post_revision':revision,'readiness_warnings':warnings})
    return output
