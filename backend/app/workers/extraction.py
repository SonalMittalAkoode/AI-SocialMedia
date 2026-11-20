"""Run separately: python -m app.workers.extraction. PostgreSQL leases allow replicas."""
import asyncio
import logging
import time
from sqlalchemy.exc import SQLAlchemyError
from app.db.database import SessionLocal
from app.models.user import User  # noqa: F401; register existing ORM relationship targets
from app.core.config import settings
from app.core.extraction_config import extraction_settings as limits
from app.services import extraction_jobs as jobs
from app.services.website_extraction import extract_website
from app.services import ai_provider
from app.services.extraction_errors import ExtractionError
from app.services import ai_queue
from app.workers.intelligence import run_job as run_intelligence_job
from app.workers.scheduling import run_scheduler

logger = logging.getLogger("socialai.extraction")


async def run_job(claimed, analyzer, session_factory=SessionLocal, extractor=extract_website):
    job_id, token, url = claimed
    started = time.monotonic()
    with session_factory() as db:
        job = jobs.leased(db, job_id, token)
        if not job:
            return
        elapsed_ms = job.duration_ms or 0
        compact = job.attempt_count > 1
    remaining = max(0.1, limits.job_timeout - elapsed_ms / 1000)
    def stage(value):
        with session_factory() as db:
            jobs.stage(db, job_id, token, value)
    try:
        async with asyncio.timeout(remaining):
            website = await extractor(url, stage=stage)
            stage("analyzing")
            result, usage = await analyzer.analyze(website, compact=compact, lenient=True)
            stage("saving")
            with session_factory() as db:
                jobs.succeed(db, job_id, token, result, website, usage, getattr(analyzer, "model", None) or settings.GEMINI_MODEL, elapsed_ms + int((time.monotonic() - started) * 1000))
            logger.info("job=%s status=completed pages=%s duration_ms=%s", job_id, len(website["pages"]), int((time.monotonic() - started) * 1000))
    except Exception as exc:
        error = exc if isinstance(exc, ExtractionError) else ExtractionError("job_timeout" if isinstance(exc, TimeoutError) else "worker_failure", "The analysis could not finish. Retry or enter details manually.", isinstance(exc, TimeoutError))
        with session_factory() as db:
            jobs.fail(db, job_id, token, error)
        # No stack trace/provider error string/URL in logs: these may contain secrets.
        logger.warning("job=%s failure=%s", job_id, error.code)


async def main():
    analyzer = ai_provider.create_analyzer()
    # Model names only; credentials are never logged.
    logger.info("AI provider=%s text_model=%s research_model=%s image_model=%s", ai_provider.name(), ai_provider.text_model(), ai_provider.research_model(), ai_provider.image_model())
    scheduler = asyncio.create_task(run_scheduler())
    try:
        while True:
            try:
                with SessionLocal() as db:
                    ai_claimed=ai_queue.claim(db)
                if ai_claimed:
                    await run_intelligence_job(ai_claimed,analyzer)
                with SessionLocal() as db:
                    claimed = jobs.claim(db)
                if claimed:
                    await run_job(claimed, analyzer)
                else:
                    await asyncio.sleep(2)
            except SQLAlchemyError:
                logger.warning("Extraction storage unavailable; retrying claim")
                await asyncio.sleep(5)
    finally:
        scheduler.cancel()
        await asyncio.gather(scheduler, return_exceptions=True)
        await analyzer.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    for name in ("httpx", "httpx2", "google_genai", "openai"):
        logging.getLogger(name).setLevel(logging.WARNING)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
