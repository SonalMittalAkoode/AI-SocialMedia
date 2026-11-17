"""Confirmed-brand context, deterministic relevance, and evidence-preserving research."""
import re
from sqlalchemy import select, func
from fastapi import HTTPException
from app.models.intelligence import Competitor, CompetitorResearch
from app.core.intelligence_config import ai_settings as limits
from app.core.config import settings
from app.services.search_provider import domain, queries_for, BraveSearchProvider
from app.services.website_extraction import extract_website
from app.services.extraction_errors import ExtractionError
from app.services.onboarding import transaction, check_revision


def brand_context(company, require_confirmed=True):
    b, p = company.brand, company.preferences
    if require_confirmed and not b.is_confirmed: raise HTTPException(422,"Confirm the brand profile before starting AI operations")
    return {"company_name": b.display_name or company.name, "industry": company.industry, "business_type":company.business_type,
            "description":b.description, "products_services":b.products_services, "target_audience":b.target_audience,
            "brand_voice":b.brand_voice, "brand_keywords":b.brand_keywords, "brand_colors":b.brand_colors,
            "guidelines":b.content_guidelines, "city":company.city,"country":company.country,"website_url":company.website_url,
            "brand_revision":b.revision,"company_revision":company.revision,
            "preferences":{"platforms":p.platforms,"goals":p.content_goals,"tones":p.tone,"formats":p.content_formats,"language":p.language,"excluded_topics":p.excluded_topics,"instructions":p.custom_instructions}}


def tokens(value):
    text = " ".join(value) if isinstance(value,list) else str(value or "")
    stop={"and","the","for","with","from","your","our","company","business","services","service","in","of","to","a"}
    return {v for v in re.findall(r"[\w]+",text.casefold()) if len(v)>2 and v not in stop}


def relevance(brand, candidate):
    components = [
        ("industry",brand.get("industry"),candidate.get("industry"),limits.industry_weight),
        ("services",brand.get("products_services"),candidate.get("products_services"),limits.services_weight),
        ("audience",brand.get("target_audience"),candidate.get("target_audience"),limits.audience_weight),
        ("geography"," ".join(filter(None,[brand.get("city"),brand.get("country")]))," ".join(filter(None,[candidate.get("city"),candidate.get("country")])),limits.geography_weight),
        ("positioning",brand.get("description"),candidate.get("description"),limits.positioning_weight),
    ]
    total=sum(row[3] for row in components) or 1
    score=0; parts=[]
    for label, left, right, weight in components:
        a,b=tokens(left),tokens(right)
        overlap=len(a & b)/len(a) if a and b else 0
        score+=weight*overlap
        parts.append(f"{label}: {round(overlap*100)}% term coverage" if a and b else f"{label}: not available")
    return round(100*score/total), "; ".join(parts)+". Heuristic relevance, not a probability."


def add_manual(db,company,data):
    key=domain(data.website_url)
    existing=db.scalar(select(Competitor).where(Competitor.company_id==company.id,Competitor.normalized_domain==key))
    if existing:
        if existing.removed_at is not None:
            # Re-adding a removed domain restores the retained record and its research history.
            with transaction(db):existing.removed_at=None
        return existing
    if key==own_domain(company.website_url):raise HTTPException(422,"Use a different business website")
    record=Competitor(company_id=company.id,normalized_domain=key,source_url=data.website_url,**data.model_dump())
    with transaction(db):db.add(record)
    return record


def approved_count(db,company_id):
    return db.scalar(select(func.count()).select_from(Competitor).where(Competitor.company_id==company_id,Competitor.selection_status=="approved",Competitor.removed_at.is_(None)))


def edit_competitor(db,company,record,data):
    check_revision(record,data.revision)
    if record.removed_at is not None:raise HTTPException(422,"Restore the competitor before editing it")
    changes=data.model_dump(exclude_unset=True,exclude={"revision"})
    for required in ("name","selection_status","website_url"):
        if required in changes and changes[required] is None:raise HTTPException(422,"Do not clear required fields")
    if changes.get("selection_status")=="approved" and record.selection_status!="approved":
        if approved_count(db,company.id)>=limits.max_approved_competitors:raise HTTPException(422,"Approved competitor limit reached")
    if "website_url" in changes:
        key=domain(changes["website_url"])
        if key!=record.normalized_domain:
            if key==own_domain(company.website_url):raise HTTPException(422,"Use a different business website")
            if db.scalar(select(Competitor.id).where(Competitor.company_id==company.id,Competitor.normalized_domain==key,Competitor.id!=record.id)):
                raise HTTPException(409,"Another saved competitor already uses this website")
            # Earlier research described a different website; it stays in history but no longer verifies this record.
            changes.update(normalized_domain=key,source_url=changes["website_url"],verification_status="unverified",relevance_score=0,relevance_reason="Website changed; research again to verify.")
    with transaction(db):
        for key,value in changes.items():setattr(record,key,value)
    return record


def set_removed(db,record,revision,removed):
    from app.services.extraction_jobs import now
    check_revision(record,revision)
    with transaction(db):record.removed_at=now() if removed else None
    return record


async def discover(context, provider=None):
    # Google grounded results must never enter this persistence/crawl pipeline.
    from app.services.gemini_search import brave_enabled
    if provider is None and not brave_enabled():
        raise ExtractionError("search_provider_not_configured", "Persistent automatic discovery requires licensed Brave access. Gemini search is display-only.")
    candidates=await (provider or BraveSearchProvider()).search_companies(queries_for(context))
    own=own_domain(context.get('website_url'))
    return [c.model_dump() for c in candidates if c.normalized_domain!=own][:limits.max_candidates]


def own_domain(url):
    # Legacy manual onboarding accepts placeholder/non-researchable company URLs.
    # They must not prevent adding a valid public competitor. Candidate fetching
    # still goes through the full Phase 4 URL/DNS restrictions.
    if not url:return None
    try:return domain(url)
    except (ExtractionError,ValueError):return None


async def fetch_competitor_site(url,extractor=extract_website):
    """Follow one homepage redirect only within the same domain (www/https canonicalisation).

    The followed URL goes through the complete validation, robots and DNS policy again.
    Cross-domain redirects are not followed: they may lead to a different business.
    """
    try:
        return await extractor(url)
    except ExtractionError as exc:
        target=getattr(exc,"redirect_to",None)
        if exc.code!="external_redirect" or not target:raise
        if domain(target)!=domain(url):
            raise ExtractionError("external_redirect",f"The website redirects to {domain(target)}. If that is the same business, edit the competitor website to that address.") from None
        return await extractor(target)


def _merge_usage(base, extra):
    names={"prompt_tokens":"prompt_token_count","output_tokens":"candidates_token_count","total_tokens":"total_token_count"}
    merged={k:(base.get(k) or 0)+(extra.get(v) or 0) for k,v in names.items()}
    merged["thinking_tokens"]=base.get("thinking_tokens")
    return merged


async def research(competitor,context,analyzer,extractor=extract_website,stage=lambda _: None,assessor=None):
    stage("fetching")
    website=await fetch_competitor_site(competitor["website_url"],extractor)
    stage("analyzing")
    # Lenient: unsupported findings are omitted rather than rejecting the whole profile.
    analysis,usage=await analyzer.analyze(website,lenient=True)
    data=analysis.model_dump(mode="json")
    # Verified denotes retrieved identity, not measured competitive performance.
    identity=any(e.field=="company_name" and e.classification=="explicit" for e in analysis.field_evidence)
    legal={'llc','ltd','limited','inc','incorporated','corp','corporation','plc','pvt','private'}
    candidate_name=tokens(competitor['name'])-legal
    retrieved_name=tokens(analysis.company_name)-legal
    identity_match=bool(candidate_name) and candidate_name==retrieved_name
    verified="verified" if identity and identity_match else "partially_verified"
    lexical,lexical_reason=relevance(context,data)
    warnings=list(data["warnings"])
    assessment=None
    if assessor is None and getattr(analyzer,"client",None) is not None:
        from app.services.competitor_analysis import assess
        assessor=lambda ctx,found: assess(analyzer.client,ctx,found)
    if assessor is not None:
        stage("assessing")
        try:
            found,extra=await assessor(context,data)
            assessment=found.model_dump(mode="json")
            usage=_merge_usage(usage or {},extra or {})
        except ExtractionError as exc:
            warnings.append(f"Competitive assessment unavailable ({exc.code}); verified website findings were saved as a partial result.")
    if assessment:
        score=round(0.6*assessment["fit_score"]+0.4*lexical)
        reason=(f"AI fit assessment {assessment['fit_score']}/100 (60%) and term overlap {lexical}/100 (40%). "
                f"{assessment['fit_rationale']} Term overlap: {lexical_reason}")
    else:
        score,reason=lexical,lexical_reason
    strengths=[{"observation":s["observation"],"basis":s["basis"],"classification":"interpretation"} for s in assessment["competitive_strengths"]] if assessment else []
    strengths+=[{"observation":v,"classification":"retrieved_offering"} for v in data["products_services"]][:max(0,6-len(strengths))]
    if assessment:
        opportunities=[{"suggestion":o["suggestion"],"rationale":o.get("rationale",""),"classification":"strategic_suggestion"} for o in assessment["content_opportunities"]]
    else:
        opportunities=[{"suggestion":v,"classification":"strategic_suggestion"} for v in data["content_pillars"]]
    return {"analysis":data,"verification_status":verified,"relevance_score":score,"relevance_reason":reason[:2000],
            "business":{k:data.get(k) for k in ("company_name","description","tagline","industry","business_type","city","country")},
            "products_services":data["products_services"],
            "target_audience":(assessment or {}).get("target_audience") or data["target_audience"],
            "market_positioning":(assessment or {}).get("market_positioning") or data.get("value_proposition"),
            "content_themes":(assessment or {}).get("content_themes") or data["content_pillars"],
            "strengths":strengths,"potential_gaps":[],"content_opportunities":opportunities,
            "fit":{"score":assessment["fit_score"],"rationale":assessment["fit_rationale"]} if assessment else None,
            "lexical_relevance":lexical,
            "assessment_status":"completed" if assessment else ("unavailable" if assessor is not None else "not_requested"),
            "metrics":{"engagement_rate":None,"followers":None,"posting_frequency":None},"warnings":warnings[:15]},usage


def approved_insights(db,company_id):
    """Approved, researched, non-removed competitors. Partially verified records count because a
    user explicitly approved them; verification status is passed along for transparency."""
    output=[]
    rows=db.scalars(select(Competitor).where(Competitor.company_id==company_id,Competitor.selection_status=="approved",Competitor.removed_at.is_(None),Competitor.verification_status.in_(("verified","partially_verified"))).order_by(Competitor.id).limit(limits.max_approved_competitors))
    for competitor in rows:
        row=db.scalar(select(CompetitorResearch).where(CompetitorResearch.company_id==company_id,CompetitorResearch.competitor_id==competitor.id).order_by(CompetitorResearch.created_at.desc()).limit(1))
        if row:
            data=row.data
            output.append({"competitor_id":str(competitor.id),"name":competitor.name,"verification_status":competitor.verification_status,
                           "positioning":(data.get("market_positioning") or "")[:400],
                           "themes":(data.get("content_themes") or [])[:5],
                           "opportunities":[o.get("suggestion") if isinstance(o,dict) else o for o in data.get("content_opportunities",[])][:5],
                           "services":(data.get("products_services") or data.get("analysis",{}).get("products_services",[]))[:6],
                           "source_urls":list(dict.fromkeys(e.get("source_url") for e in row.source_evidence if e.get("source_url")))[:5]})
    return output
