"""Private logos obtained from independent website metadata or explicit uploads."""
import asyncio,io,os,re
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
from app.models.brand_extraction import BrandExtractionJob, BrandExtractionResult
from app.services.website_fetcher import WebsiteFetcher,origin
from app.services.html_extractor import css_brand_tokens, inline_logo, normalize_hex, parse_html
from app.services.media_storage import validate_image
from app.services.extraction_errors import ExtractionError
from app.services.onboarding import check_revision,invalidate
from app.services.brand_provenance import belongs_to_prior_website, prior_website_research, website_host, without_prior_website_guidelines

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
                    if name in {'fill','stroke','stop-color','color'}:
                        if re.fullmatch(r'#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?', value):
                            colors.append(normalize_hex(value))
                        elif value.lower() in {'black', 'white'}:
                            colors.append('#000000' if value.lower() == 'black' else '#ffffff')
            view=tree.attrib.get('viewBox','0 0 512 128').replace(',',' ').split()
            width,height=int(float(view[-2])),int(float(view[-1]))
            if not (0<width<=4096 and 0<height<=4096):raise ValueError()
            data=ET.tostring(tree,encoding='utf-8')
        except (ET.ParseError,ValueError,IndexError,OverflowError):raise ExtractionError("invalid_logo","SVG contains unsupported or active content. Upload a PNG instead.") from None
        return data,{'mime_type':mime,'width':width,'height':height,'size_bytes':len(data)},list(dict.fromkeys(colors))[:8]
    data,metadata=validate_image(data,mime,minimum=1,preserve_alpha=True)
    with Image.open(io.BytesIO(data)) as image:
        pixels = [pixel[:3] for pixel in image.resize((96,96)).get_flattened_data() if pixel[3] >= 160]
        if not pixels:
            raise ExtractionError('invalid_logo', 'The logo contains no visible pixels.')
        opaque = Image.new('RGB', (len(pixels), 1))
        opaque.putdata(pixels)
        quantized=opaque.quantize(colors=8)
        palette=quantized.getpalette()
        for count,index in sorted(quantized.getcolors(),reverse=True):
            if count >= len(pixels) * 0.025:
                colors.append('#%02x%02x%02x'%tuple(palette[index*3:index*3+3]))
    return data,metadata,distinct_colors(colors)

def distinct_colors(values, limit=5):
    palette = []
    points = []
    for value in values:
        if not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            continue
        rgb = tuple(bytes.fromhex(value[1:]))
        if any(sum((a-b)**2 for a,b in zip(rgb, existing)) < 28**2 for existing in points):
            continue
        points.append(rgb)
        palette.append(value.lower())
        if len(palette) == limit:
            break
    return palette

def mark_brand_changed(company):
    company.brand.is_confirmed=False;company.brand.confirmed_at=None
    if 'brand' in company.onboarding.completed_steps:invalidate(company,'brand')

def save_logo(db,company,prepared,revision,source=None,website_colors=None):
    check_revision(company.brand,revision)
    data,meta,colors=prepared
    key=f"{company.id}/{uuid4()}.{'svg' if meta['mime_type']=='image/svg+xml' else 'png'}"
    path=logo_path(key);path.parent.mkdir(parents=True,exist_ok=True)
    old=db.get(BrandLogo,company.id);old_key=old.storage_key if old else None
    try:
        with path.open('xb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        if not old:old=BrandLogo(company_id=company.id);db.add(old)
        for field,value in dict(storage_key=key,source_url=source,**meta).items():setattr(old,field,value)
        company.brand.logo_url=f"/api/v1/companies/{company.id}/brand/logo?v={key.split('/')[-1]}"
        if website_colors is not None and not company.brand.brand_colors:
            company.brand.brand_colors = distinct_colors([*website_colors, *colors])
        mark_brand_changed(company)
        db.commit()
    except BaseException:
        db.rollback();path.unlink(missing_ok=True);raise
    if old_key:logo_path(old_key).unlink(missing_ok=True)
    return {'logo_url':company.brand.logo_url,'brand_revision':company.brand.revision,'extracted_colors':colors,'brand_colors':company.brand.brand_colors}

@router.get("")
def logo(company_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company = company_access(db,user,company_id)
    if not company.brand.logo_url:
        raise HTTPException(404,"Logo not found")
    row=db.get(BrandLogo,company_id)
    if not row or not logo_path(row.storage_key).is_file():raise HTTPException(404,"Logo not found")
    return FileResponse(logo_path(row.storage_key),media_type=row.mime_type,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"})

@router.post('/upload')
async def upload(company_id:UUID,request:Request,revision:int=Query(ge=1),user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True);body=bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body)>2_000_000:raise HTTPException(413,"Logo exceeds 2 MB")
    try:return save_logo(db,company,clean_logo(bytes(body),request.headers.get('content-type','').split(';')[0]),revision)
    except ExtractionError as e:raise HTTPException(422,e.message) from None

def logo_policy(fetcher):
    policies={}
    async def permitted(url):
        key=origin(url)
        if key not in policies:
            u=urlsplit(url);_,body,code=await fetcher.get(f'{u.scheme}://{u.netloc}/robots.txt',robots=True,allowed_origin=key,allow_canonical=True)
            policy=RobotFileParser();policy.parse(body.splitlines() if code==200 else []);policies[key]=policy
        if not policies[key].can_fetch('SocialAIResearchBot',url):raise ExtractionError('robots_restricted','The website does not permit downloading this logo')
        if (policies[key].crawl_delay('SocialAIResearchBot') or policies[key].crawl_delay('*') or 0)>0:raise ExtractionError('robots_restricted','Logo host requests delayed crawling. Upload a permitted logo instead.')
        rate=policies[key].request_rate('SocialAIResearchBot') or policies[key].request_rate('*')
        if rate:raise ExtractionError('robots_restricted','Logo host requests rate-limited crawling. Upload a permitted logo instead.')
    return permitted

@router.post('/from-website')
async def from_website(company_id:UUID,job_id:UUID,revision:int=Query(ge=1),candidate:int=Query(0,ge=0,le=24),user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True);check_revision(company.brand,revision)
    result, website = current_website_analysis(db, company, job_id)
    found=[v for page in result.source_pages for v in page.get('logo_candidates',[])]
    if candidate>=len(found):raise HTTPException(404,"Website logo candidate not found")
    source=found[candidate]['url'];db.commit() # no row locks during network I/O
    fetcher=WebsiteFetcher()
    try:
        _,(data,mime),_=await fetcher.get(source,media=True,allowed_origin=origin(source),allow_canonical=True,before_request=logo_policy(fetcher))
        prepared = clean_logo(data,mime)
        company=company_access(db,user,company_id,True)
        if website_host(company.website_url) != website_host(website):
            raise HTTPException(409, 'The company website changed during the import.')
        return save_logo(db,company,prepared,revision,source)
    except ExtractionError as e:raise HTTPException(422,e.message) from None
    finally:await fetcher.close()


def current_website_analysis(db, company, job_id):
    research = db.execute(select(BrandExtractionResult, BrandExtractionJob.requested_url).join(BrandExtractionJob, BrandExtractionResult.job_id == BrandExtractionJob.id).where(
        BrandExtractionResult.company_id == company.id, BrandExtractionResult.job_id == job_id, BrandExtractionJob.status == 'completed',
    )).first()
    if not research:
        raise HTTPException(404, 'Completed website analysis not found')
    result, website = research
    if website_host(company.website_url) != website_host(website):
        raise HTTPException(409, 'Analyze the current website before importing brand assets.')
    return result, website


@router.post('/auto')
async def automatic_brand_media(company_id:UUID, job_id:UUID, revision:int=Query(ge=1), user=Depends(current_user), db=Depends(storage), draft_only:bool=False):
    company = company_access(db,user,company_id,True)
    check_revision(company.brand,revision)
    if draft_only and company.brand.is_confirmed:
        return {'logo_url':company.brand.logo_url, 'brand_revision':company.brand.revision, 'brand_colors':company.brand.brand_colors}
    result, website = current_website_analysis(db, company, job_id)
    history = prior_website_research(db, company)
    saved_logo = company.brand.logo_url
    saved_colors = company.brand.brand_colors
    pages = result.source_pages
    guidelines = without_prior_website_guidelines(company.brand.content_guidelines, history, result.extracted_data)
    logo_row = db.get(BrandLogo, company_id) if saved_logo else None
    stale_logo = bool(logo_row and website_host(logo_row.source_url) != website_host(website)
                      and belongs_to_prior_website(logo_row.source_url, history, pages))
    if stale_logo:
        saved_logo = None
    logo_key = (logo_row.storage_key, logo_row.mime_type) if logo_row and not stale_logo and not saved_colors else None
    confirmed_colors = result.extracted_data.get('brand_colors') or []
    db.commit()  # Release the company row before fetching public assets.

    # Prefer the logo visible in the page over generic structured metadata.
    priority = {'website logo link': 0, 'explicit website logo': 1, 'structured organization logo': 2, 'preloaded website logo': 3}
    prepared = source = None
    colors = distinct_colors([*confirmed_colors, *(color for page in pages for color in page.get('style_colors', []))])
    if not saved_logo or not saved_colors:
        candidates = [candidate for page in pages for candidate in page.get('logo_candidates', []) if candidate.get('reason') in priority]
        fetcher = WebsiteFetcher()
        permitted = logo_policy(fetcher)
        html = resolved = None
        try:
            async with asyncio.timeout(20):
                if (not saved_logo and not candidates) or (not saved_colors and not colors and not any(page.get('stylesheet_urls') for page in pages)):
                    try:
                        resolved, html, _ = await fetcher.get(website, allowed_origin=origin(website), allow_canonical=True, before_request=permitted)
                        page, _, _ = parse_html(resolved, html)
                        pages = [page, *pages]
                        colors = distinct_colors([*page['style_colors'], *colors])
                        candidates = [candidate for candidate in page['logo_candidates'] if candidate['reason'] in priority] + candidates
                    except ExtractionError:
                        pass
                seen = set()
                for candidate in sorted(candidates if not saved_logo and not prepared else [], key=lambda item: priority[item['reason']]):
                    url = candidate['url']
                    if url in seen:
                        continue
                    seen.add(url)
                    try:
                        _, (data, mime), _ = await fetcher.get(url, media=True, allowed_origin=origin(url), allow_canonical=True, before_request=permitted)
                        prepared = clean_logo(data, mime)
                        source = url
                        break
                    except ExtractionError:
                        if len(seen) >= 4:
                            break
                if not saved_logo and not prepared and html and (svg := inline_logo(html)):
                    try:
                        prepared = clean_logo(svg, 'image/svg+xml')
                        source = resolved
                    except ExtractionError:
                        pass
                if not saved_colors:
                    stylesheets = dict.fromkeys(url for page in pages for url in page.get('stylesheet_urls', []))
                    for stylesheet in list(stylesheets)[:2]:
                        try:
                            _, css, _ = await fetcher.get(stylesheet, stylesheet=True, allowed_origin=origin(stylesheet), allow_canonical=True, before_request=permitted)
                        except ExtractionError:
                            continue
                        colors = distinct_colors([*colors, *(normalize_hex(color) for color in css_brand_tokens(css))])
        except TimeoutError:
            pass
        finally:
            await fetcher.close()

    if not colors and logo_key:
        key, mime = logo_key
        path = logo_path(key)
        if path.is_file():
            try:
                _, _, colors = clean_logo(path.read_bytes(), mime)
            except (ExtractionError, OSError):
                pass
    company = company_access(db,user,company_id,True)
    check_revision(company.brand, revision)
    if draft_only and company.brand.is_confirmed:
        return {'logo_url':company.brand.logo_url, 'brand_revision':company.brand.revision, 'brand_colors':company.brand.brand_colors}
    if website_host(company.website_url) != website_host(website):
        raise HTTPException(409, 'The company website changed during the import.')
    changed = False
    if guidelines != company.brand.content_guidelines:
        company.brand.content_guidelines = guidelines
        changed = True
    if prepared and (not company.brand.logo_url or stale_logo):
        return save_logo(db, company, prepared, revision, source, website_colors=colors)
    if stale_logo:
        company.brand.logo_url = None
        changed = True
    if not company.brand.brand_colors and (palette := distinct_colors(colors)):
        company.brand.brand_colors = palette
        changed = True
    if changed:
        mark_brand_changed(company)
        db.commit()
    return {'logo_url':company.brand.logo_url, 'brand_revision':company.brand.revision, 'brand_colors':company.brand.brand_colors}

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
