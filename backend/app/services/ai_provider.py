"""Active AI provider selection (``AI_PROVIDER``). One provider serves every workflow.

There is no silent fallback: when OpenAI is selected and fails or is unconfigured, the job fails
with an explicit error and no Gemini request is made. Gemini remains selectable explicitly with
``AI_PROVIDER=gemini`` (its implementation is unchanged).
"""
from app.core.config import settings
from app.core.intelligence_config import ai_settings

LABELS = {"openai": "OpenAI", "gemini": "Gemini"}


def name() -> str:
    return settings.AI_PROVIDER


def is_openai() -> bool:
    return name() == "openai"


def label() -> str:
    return LABELS[name()]


def text_model():
    """Captions, hooks, hashtags and image review."""
    return settings.OPENAI_TEXT_MODEL if is_openai() else settings.GEMINI_MODEL


def research_model():
    """Website understanding, competitor analysis/assessment and web search."""
    return settings.OPENAI_RESEARCH_MODEL if is_openai() else settings.GEMINI_MODEL


def text_configured() -> bool:
    if is_openai():
        from app.services.openai_provider import configured
        return configured() and bool(settings.OPENAI_TEXT_MODEL and settings.OPENAI_RESEARCH_MODEL)
    return bool(settings.GEMINI_API_KEY.strip())


def image_configured() -> bool:
    if is_openai():
        from app.services import openai_images
        return openai_images.configured()
    return bool(ai_settings.gemini_image_model)


def image_model(reference=False):
    if is_openai():
        from app.services import openai_images
        return openai_images.image_model(reference)
    return ai_settings.gemini_image_model


def search_configured() -> bool:
    if is_openai():
        from app.services import openai_search
        return openai_search.enabled()
    from app.services import gemini_search
    return gemini_search.configured()


def create_analyzer(client=None):
    """Shared worker handle: brand/competitor analysis plus ``.client`` for structured text calls."""
    if is_openai():
        from app.services.openai_brand import OpenAIBrandAnalyzer
        return OpenAIBrandAnalyzer(client)
    from app.services.gemini_brand_analyzer import GeminiBrandAnalyzer
    return GeminiBrandAnalyzer(client)


def create_image_provider():
    if is_openai():
        from app.services.openai_images import OpenAIImageProvider
        return OpenAIImageProvider()
    from app.services.media_storage import GoogleImageProvider
    return GoogleImageProvider()


def search_provider():
    if is_openai():
        from app.services.openai_search import OpenAIWebSearchProvider
        return OpenAIWebSearchProvider()
    from app.services.gemini_search import GeminiGroundedSearchProvider
    return GeminiGroundedSearchProvider()
