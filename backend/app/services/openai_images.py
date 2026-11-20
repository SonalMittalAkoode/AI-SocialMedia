"""OpenAI Images API provider (generations and reference-image edits).

Sizes are exact for every supported aspect ratio: both edges are multiples of 16, the ratio is
within the documented 1:3-3:1 range and the pixel count is within the documented bounds, so no
image is ever stretched or cropped to fit. An edit sends the earlier image as the reference;
the model re-renders the whole image guided by it, so results are new images, not pixel edits.
"""
import base64
import io

from PIL import Image, UnidentifiedImageError

from app.core.config import settings
from app.core.intelligence_config import ai_settings as limits
from app.services.extraction_errors import ExtractionError
from app.services.openai_provider import OpenAIGateway, configured as openai_configured, usage_of

SIZES = {
    "1:1": "1024x1024", "4:5": "1024x1280", "3:4": "960x1280", "4:3": "1280x960",
    "16:9": "1536x864", "9:16": "864x1536", "3:2": "1536x1024", "2:3": "1024x1536",
}


def image_model(reference=False):
    """Fresh images use OPENAI_IMAGE_MODEL; reference edits use OPENAI_PREMIUM_IMAGE_MODEL when set
    (documented for detailed compositions and editing), otherwise the standard model."""
    if reference and settings.OPENAI_PREMIUM_IMAGE_MODEL:
        return settings.OPENAI_PREMIUM_IMAGE_MODEL
    return settings.OPENAI_IMAGE_MODEL


def configured():
    return openai_configured() and bool(settings.OPENAI_IMAGE_MODEL)


class OpenAIImageProvider:
    provider = "openai"

    def __init__(self, gateway=None):
        self.usage = {}
        self.meta = {}
        self.model = None
        self._owned = gateway is None
        self.gateway = gateway or OpenAIGateway(timeout=limits.image_timeout - 10)
        # Exposed for the optional multimodal review, which uses the same gateway.
        self.client = self.gateway

    async def close(self):
        if self._owned:
            await self.gateway.close()

    async def generate(self, prompt, aspect_ratio, reference=None):
        from app.services.media_storage import IMAGE_SYSTEM
        if not configured():
            raise ExtractionError("image_provider_not_configured", "No OpenAI image model is configured. Save a text-only draft.")
        size = SIZES.get(aspect_ratio)
        if not size:
            raise ExtractionError("unsupported_aspect_ratio", "Unsupported aspect ratio.")
        self.model = model = image_model(bool(reference))
        text = IMAGE_SYSTEM + "\n\n" + prompt[:4500]
        options = {"model": model, "prompt": text, "size": size, "quality": limits.openai_image_quality,
                   "output_format": "png", "n": 1, "timeout": limits.image_timeout - 5}
        client = self.gateway.client
        if reference:
            factory = lambda: client.images.with_raw_response.edit(image=("reference.png", reference, "image/png"), **options)
        else:
            factory = lambda: client.images.with_raw_response.generate(moderation="auto", **options)
        try:
            raw = await self.gateway.call(factory, "image")
        except ExtractionError as exc:
            if exc.code == "openai_request_rejected" and reference:
                raise ExtractionError("image_edit_rejected", "The image model could not use this image as a reference. Try a fresh variation instead.") from None
            if exc.code == "openai_billing_limit":
                raise ExtractionError("image_quota", exc.message) from None
            raise
        response = raw.parse()
        request_id = raw.headers.get("x-request-id")
        self.usage = usage_of(getattr(response, "usage", None))
        self.meta = {"provider": "openai", "model": model, "size": size}
        if request_id:
            self.meta["response_id"] = request_id[:200]
        data = (getattr(response, "data", None) or [None])[0]
        encoded = getattr(data, "b64_json", None) if data else None
        if not encoded:
            raise ExtractionError("image_unavailable", "The provider returned no image (it may have declined the brief). Text-only drafts remain available.")
        try:
            image = base64.b64decode(encoded, validate=True)
            with Image.open(io.BytesIO(image)) as im:
                fmt, width, height = im.format, im.width, im.height
        except (ValueError, UnidentifiedImageError, OSError):
            raise ExtractionError("image_unavailable", "The provider returned an unreadable image. Nothing was saved.") from None
        if fmt != "PNG":
            raise ExtractionError("image_unavailable", "The provider returned an unexpected image format. Nothing was saved.")
        self.meta["returned_size"] = f"{width}x{height}"
        return image, "image/png"
