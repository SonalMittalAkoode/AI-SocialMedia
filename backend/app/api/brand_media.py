"""Private logos obtained from independent website metadata or explicit uploads."""
import io,os,re
from uuid import UUID,uuid4
from xml.etree import ElementTree as ET
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
from fastapi import APIRouter,Depends,HTTPException,Request,Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from PIL import Image
from app.api.auth import current_user
from app.api.onboarding import storage,request_policy
from app.core.permissions import company_access
from app.core.intelligence_config import ai_settings
from app.models.brand_logo import BrandLogo
from app.models.brand_extraction import BrandExtractionResult
from app.services.website_fetcher import WebsiteFetcher,origin
from app.services.media_storage import validate_image
from app.services.extraction_errors import ExtractionError
from app.services.onboarding import check_revision,invalidate

router=APIRouter(prefix="/companies/{company_id}/brand/logo",tags=["Brand media"],dependencies=[Depends(request_policy)])

def logo_path(key):
    if not re.fullmatch(r"[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|svg)",key):raise HTTPException(404,"Logo not found")
    root=(ai_settings.media_root/"logos").absolute()
    path=root/key
    if any(p.is_symlink() for p in (root,*root.parents,path.parent,path)) or not path.resolve().is_relative_to(root.resolve()):raise HTTPException(404,"Logo not found")
    return path

def clean_logo(data,mime):
    if len(data)>2_000_000:raise ExtractionError("invalid_logo","Logo exceeds 2 MB")
    colors=[]
    if mime=="image/svg+xml":
        if b"<!" in data:raise ExtractionError("invalid_logo","SVG declarations and external entities are not supported")
        try:
            tree=ET.fromstring(data)
            allowed={'svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','title','desc','clipPath','mask','use','style'}
            if tree.tag.split('}')[-1]!='svg':raise ValueError()
            for node in tree.iter():
                if node.tag.split('}')[-1] not in allowed:raise ValueError()
                if node.tag.split('}')[-1]=='style':
                    css=node.text or ''
                    if re.search(r'@|\\|expression|behavior|javascript|https?:|data:|url\((?!#[\w-]+\))',css,re.I):raise ValueError()
                    remainder=re.sub(r'[^{}]+\{[^{}]*\}', '',css).strip()
                    if remainder:raise ValueError()
                    for selector,body in re.findall(r'([^{}]+)\{([^{}]*)\}',css):
                        if not re.fullmatch(r'[\s.#\w,-]+',selector):raise ValueError()
                        for declaration in body.split(';'):
                            if not declaration.strip():continue
                            key,value=declaration.split(':',1)
                            if key.strip() not in {'fill','fill-rule','clip-path','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','fill-opacity','stroke-opacity','clip-rule'} or not re.fullmatch(r'[#\w().,%\s-]+',value):raise ValueError()
                    colors.extend('#'+''.join(v*2 for v in c[1:]) if len(c)==4 else c for c in re.findall(r'#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])',css))
                for key,value in node.attrib.items():
                    name=key.split('}')[-1].lower()
                    if name.startswith('on') or name in {'style','base'} or (name=='href' and not value.startswith('#')) or re.search(r'url\(\s*[\'"]?(?!#)',value,re.I) or 'javascript:' in value.lower():raise ValueError()
                    colors.extend(re.findall(r'#[0-9a-fA-F]{6}(?![0-9a-fA-F])',value))
            view=tree.attrib.get('viewBox','0 0 512 128').replace(',',' ').split()
            width,height=int(float(view[-2])),int(float(view[-1]))
            if not (0<width<=4096 and 0<height<=4096):raise ValueError()
            data=ET.tostring(tree,encoding='utf-8')
        except (ET.ParseError,ValueError,IndexError):raise ExtractionError("invalid_logo","SVG contains unsupported or active content. Upload a PNG instead.") from None
        return data,{'mime_type':mime,'width':width,'height':height,'size_bytes':len(data)},list(dict.fromkeys(colors))[:8]
    data,metadata=validate_image(data,mime,minimum=1)
    with Image.open(io.BytesIO(data)) as image:
        quantized=image.resize((64,64)).convert('RGB').quantize(colors=6)
        palette=quantized.getpalette()
        for _,index in sorted(quantized.getcolors(),reverse=True):
            colors.append('#%02x%02x%02x'%tuple(palette[index*3:index*3+3]))
    return data,metadata,colors

def save_logo(db,company,data,mime,revision,source=None):
    check_revision(company.brand,revision)
    data,meta,colors=clean_logo(data,mime)
    key=f"{company.id}/{uuid4()}.{'svg' if meta['mime_type']=='image/svg+xml' else 'png'}"
    path=logo_path(key);path.parent.mkdir(parents=True,exist_ok=True)
    old=db.get(BrandLogo,company.id);old_key=old.storage_key if old else None
    try:
        with path.open('xb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        if not old:old=BrandLogo(company_id=company.id);db.add(old)
        for field,value in dict(storage_key=key,source_url=source,**meta).items():setattr(old,field,value)
        company.brand.logo_url=f"/api/v1/companies/{company.id}/brand/logo?v={key.split('/')[-1]}"
        company.brand.is_confirmed=False;company.brand.confirmed_at=None
        if 'brand' in company.onboarding.completed_steps:invalidate(company,'brand')
        db.commit()
    except BaseException:
        db.rollback();path.unlink(missing_ok=True);raise
    if old_key:logo_path(old_key).unlink(missing_ok=True)
    return {'logo_url':company.brand.logo_url,'brand_revision':company.brand.revision,'extracted_colors':colors}

@router.get("")
def logo(company_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    row=db.get(BrandLogo,company_id)
    if not row or not logo_path(row.storage_key).is_file():raise HTTPException(404,"Logo not found")
    return FileResponse(logo_path(row.storage_key),media_type=row.mime_type,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"})

@router.post('/upload')
async def upload(company_id:UUID,request:Request,revision:int=Query(ge=1),user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True);body=bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body)>2_000_000:raise HTTPException(413,"Logo exceeds 2 MB")
    try:return save_logo(db,company,bytes(body),request.headers.get('content-type','').split(';')[0],revision)
    except ExtractionError as e:raise HTTPException(422,e.message) from None

@router.post('/from-website')
async def from_website(company_id:UUID,job_id:UUID,revision:int=Query(ge=1),candidate:int=Query(0,ge=0,le=24),user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True);check_revision(company.brand,revision)
    result=db.scalar(select(BrandExtractionResult).where(BrandExtractionResult.company_id==company_id,BrandExtractionResult.job_id==job_id))
    found=[v for page in result.source_pages for v in page.get('logo_candidates',[])] if result else []
    if candidate>=len(found):raise HTTPException(404,"Website logo candidate not found")
    source=found[candidate]['url'];db.commit() # no row locks during network I/O
    fetcher=WebsiteFetcher();policies={}
    async def permitted(url):
        key=origin(url)
        if key not in policies:
            u=urlsplit(url);_,body,code=await fetcher.get(f'{u.scheme}://{u.netloc}/robots.txt',robots=True,allowed_origin=key,allow_canonical=True)
            policy=RobotFileParser();policy.parse(body.splitlines() if code==200 else []);policies[key]=policy
        if not policies[key].can_fetch('SocialAIResearchBot',url):raise ExtractionError('robots_restricted','The website does not permit downloading this logo')
        if (policies[key].crawl_delay('SocialAIResearchBot') or policies[key].crawl_delay('*') or 0)>0:raise ExtractionError('robots_restricted','Logo host requests delayed crawling. Upload a permitted logo instead.')
        rate=policies[key].request_rate('SocialAIResearchBot') or policies[key].request_rate('*')
        if rate:raise ExtractionError('robots_restricted','Logo host requests rate-limited crawling. Upload a permitted logo instead.')
    try:
        _,(data,mime),_=await fetcher.get(source,media=True,allowed_origin=origin(source),allow_canonical=True,before_request=permitted)
        company=company_access(db,user,company_id,True)
        return save_logo(db,company,data,mime,revision,source)
    except ExtractionError as e:raise HTTPException(422,e.message) from None
    finally:await fetcher.close()

@router.delete('')
def remove(company_id:UUID,revision:int=Query(ge=1),user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True);check_revision(company.brand,revision)
    row=db.get(BrandLogo,company_id);key=row.storage_key if row else None
    if row:db.delete(row)
    company.brand.logo_url=None;company.brand.is_confirmed=False;company.brand.confirmed_at=None
    if 'brand' in company.onboarding.completed_steps:invalidate(company,'brand')
    db.commit()
    if key:logo_path(key).unlink(missing_ok=True)
    return {'removed':True}
