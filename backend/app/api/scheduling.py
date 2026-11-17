from datetime import datetime,date,timedelta
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException,Query
from sqlalchemy import select
from app.api.auth import current_user
from app.api.onboarding import storage,request_policy
from app.core.permissions import company_access
from app.core.timezones import as_utc,local_date_range
from app.schemas.content import Platform
from app.schemas.scheduling import (ScheduleCreate,ScheduleUpdate,CancelRequest,ScheduleResponse,
    CalendarEvent,EventResponse,TimezoneResponse,TimezoneUpdate)
from app.services.scheduling_policy import ScheduleState
from app.services import scheduling as service
from app.services.onboarding import transaction,check_revision
from app.models.schedule_events import ScheduleEvent

router=APIRouter(prefix='/companies/{company_id}',tags=['Scheduling'],dependencies=[Depends(request_policy)])


@router.get('/scheduling-preferences',response_model=TimezoneResponse)
def preferences(company_id:UUID,user=Depends(current_user),db=Depends(storage)):
    c=company_access(db,user,company_id)
    return {'timezone':c.timezone,'effective_timezone':service.zone_for(c),'revision':c.revision}


@router.patch('/scheduling-preferences',response_model=TimezoneResponse)
def set_timezone(company_id:UUID,data:TimezoneUpdate,user=Depends(current_user),db=Depends(storage)):
    c=company_access(db,user,company_id,True);check_revision(c,data.revision)
    with transaction(db):c.timezone=data.timezone
    return {'timezone':c.timezone,'effective_timezone':service.zone_for(c),'revision':c.revision}


@router.post('/schedules',response_model=ScheduleResponse,status_code=201)
def create(company_id:UUID,data:ScheduleCreate,user=Depends(current_user),db=Depends(storage)):
    return service.create(db,company_access(db,user,company_id,True),user,data)


@router.get('/schedules',response_model=list[CalendarEvent])
def listing(company_id:UUID,start:datetime|None=None,end:datetime|None=None,platform:Platform|None=None,status:ScheduleState|None=None,
    limit:int=Query(50,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    try:
        start=as_utc(start) if start else None;end=as_utc(end) if end else None
        if start and end and start>=end:raise ValueError('Range end must follow its start')
    except ValueError as exc:raise HTTPException(422,str(exc)) from None
    return service.calendar_rows(db,company_id,start,end,platform,status,limit,offset)


@router.get('/calendar',response_model=list[CalendarEvent])
def calendar(company_id:UUID,start_date:date,end_date:date,platform:Platform|None=None,status:ScheduleState|None=None,
    limit:int=Query(100,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(current_user),db=Depends(storage)):
    c=company_access(db,user,company_id)
    try:
        if end_date-start_date>timedelta(days=62):raise ValueError('Calendar ranges must be at most 62 days')
        start,end=local_date_range(start_date,end_date,service.zone_for(c))
    except ValueError as exc:raise HTTPException(422,str(exc)) from None
    return service.calendar_rows(db,company_id,start,end,platform,status,limit,offset)


@router.get('/schedules/{schedule_id}',response_model=CalendarEvent)
def detail(company_id:UUID,schedule_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);row=service.schedule_access(db,company_id,schedule_id)
    # Bound the projection to this row rather than loading an unbounded company list.
    return service.calendar_rows(db,company_id,None,None,None,None,1,0,schedule_id)[0]


@router.patch('/schedules/{schedule_id}',response_model=ScheduleResponse)
def reschedule(company_id:UUID,schedule_id:UUID,data:ScheduleUpdate,user=Depends(current_user),db=Depends(storage)):
    return service.change(db,company_access(db,user,company_id,True),user,schedule_id,data)


@router.post('/schedules/{schedule_id}/cancel',response_model=ScheduleResponse)
def cancel(company_id:UUID,schedule_id:UUID,data:CancelRequest,user=Depends(current_user),db=Depends(storage)):
    return service.change(db,company_access(db,user,company_id,True),user,schedule_id,data,True)


@router.get('/schedules/{schedule_id}/events',response_model=list[EventResponse])
def events(company_id:UUID,schedule_id:UUID,limit:int=Query(50,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);service.schedule_access(db,company_id,schedule_id)
    return db.scalars(select(ScheduleEvent).where(ScheduleEvent.schedule_id==schedule_id).order_by(ScheduleEvent.schedule_revision).limit(limit).offset(offset)).all()
