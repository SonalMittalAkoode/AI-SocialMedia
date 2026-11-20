"""Website identity and provenance of imported brand details."""

from urllib.parse import urlsplit

from sqlalchemy import select

from app.models.brand_extraction import BrandExtractionJob, BrandExtractionResult
from app.schemas.brand_extraction import guideline_lines


def website_host(url):
    try:
        return (urlsplit(url or '').hostname or '').removeprefix('www.')
    except ValueError:
        return ''


def prior_website_research(db, company):
    host = website_host(company.website_url)
    if not host:
        return []
    rows = db.execute(select(BrandExtractionJob.requested_url, BrandExtractionResult).join(
        BrandExtractionResult, BrandExtractionResult.job_id == BrandExtractionJob.id,
    ).where(BrandExtractionJob.company_id == company.id, BrandExtractionJob.status == 'completed')).all()
    return [(url, result) for url, result in rows if website_host(url) != host]


def without_prior_website_guidelines(guidelines, history, current_data):
    if not guidelines or not history:
        return guidelines
    old_lines = {line for _, result in history for line in guideline_lines(result.extracted_data)}
    old_lines.difference_update(guideline_lines(current_data))
    lines = guidelines.splitlines()
    if not any(line in old_lines for line in lines):
        return guidelines
    return '\n'.join(line for line in lines if line not in old_lines).strip() or None


def belongs_to_prior_website(source_url, history, current_pages):
    def listed(pages):
        return any(source_url == candidate.get('url') for page in pages for candidate in page.get('logo_candidates', []))

    return bool(source_url and not listed(current_pages) and any(
        website_host(source_url) == website_host(url) or listed(result.source_pages)
        for url, result in history
    ))
