"""Read authorized publication samples and retain only aggregate editorial signals."""

import asyncio
import json
import re
from collections import Counter
from dataclasses import dataclass
from statistics import median_low
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class MetaAccount(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)

    company_id: UUID
    facebook_page_id: str = Field("", pattern=r"^\d{0,24}$")
    facebook_page_token: SecretStr = SecretStr("")
    instagram_account_id: str = Field("", pattern=r"^\d{0,24}$")
    instagram_user_token: SecretStr = SecretStr("")


class BrandSocialSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="BRAND_SOCIAL_", extra="ignore", env_ignore_empty=True, hide_input_in_errors=True)

    meta_version: str = Field("v27.0", pattern=r"^v\d{1,3}\.0$")
    meta_accounts: list[MetaAccount] = Field(default_factory=list)

    @field_validator("meta_accounts")
    @classmethod
    def unique_companies(cls, accounts):
        if len({account.company_id for account in accounts}) != len(accounts):
            raise ValueError("Each company must have one social feed configuration")
        return accounts


settings = BrandSocialSettings()
SAMPLE_SIZE = 6
MAX_RESPONSE_BYTES = 128_000


@dataclass(frozen=True)
class Source:
    platform: str
    account_id: str
    token: SecretStr
    edge: str
    fields: str


def sources_for(company_id: UUID):
    account = next((account for account in settings.meta_accounts if account.company_id == company_id), None)
    if account is None:
        return []
    sources = [
        Source("Facebook", account.facebook_page_id, account.facebook_page_token, "published_posts", "message,attachments{media_type}"),
        Source("Instagram", account.instagram_account_id, account.instagram_user_token, "media", "caption,media_type,media_product_type"),
    ]
    return [source for source in sources if source.account_id and source.token.get_secret_value()]


CONTENT_PATTERNS = {
    "Product showcases": r"\b(shop|collection|handcrafted|available now|product spotlight|materials|styles|fabrics)\b",
    "Tips and education": r"\b(how to|tutorial|tips?|guide|learn how|step by step)\b",
    "Behind the scenes": r"\b(behind the scenes|sneak peek|in the studio|making of|our process|work in progress)\b",
    "Launches and announcements": r"\b(announc\w*|launch\w*|introducing|new collection|save the date|now open)\b",
    "Customer stories": r"\b(customer stories|client story|case stud(?:y|ies)|customer spotlight)\b",
    "Community and conversation": r"\b(tell us|which [\w-]+ (would|do)|join us|comment below|share your|your favorite)\b",
}
CTA_PATTERNS = {
    "Shop or browse": r"\b(shop now|shop the|browse|explore the collection)\b",
    "Start a conversation": r"\b(dm us|message us|get in touch|contact us)\b",
    "Invite engagement": r"\b(comment|save this|share this|tell us|tag a friend)\b",
    "Learn more": r"\b(learn more|read more|find out more)\b",
}


def editorial_profile(source, samples):
    """Publish only counts, broad categories and caption shape, never provider text."""
    captions = [text[:1200].strip() for text, _ in samples if isinstance(text, str) and text.strip()]
    formats = Counter(fmt for _, fmt in samples if fmt)
    categories = Counter(category for text in captions for category, pattern in CONTENT_PATTERNS.items() if re.search(pattern, text, re.I))
    calls_to_action = Counter(label for text in captions for label, pattern in CTA_PATTERNS.items() if re.search(pattern, text, re.I))
    result = {
        "source": source,
        "posts_sampled": len(samples),
        "formats": dict(formats.most_common()),
        "topics": [label for label, _ in categories.most_common(3)],
        "calls_to_action": [label for label, _ in calls_to_action.most_common(2)],
    }
    if captions:
        result["median_caption_words"] = median_low([len(text.split()) for text in captions])
        result["median_hashtags"] = median_low([len(re.findall(r"(?<!\w)#\w+", text)) for text in captions])
        result["question_openings"] = sum(text.splitlines()[0].strip().endswith("?") for text in captions)
        result["captions_sampled"] = len(captions)
    return result


def manual_profile(captions):
    unique = list(dict.fromkeys(caption.strip() for caption in captions if caption.strip()))[:SAMPLE_SIZE]
    return editorial_profile("Provided captions", [(caption, None) for caption in unique]) if unique else None


def sample_post(platform, row):
    if platform == "Instagram":
        format_name = "Reel" if row.get("media_product_type") == "REELS" else {
            "CAROUSEL_ALBUM": "Carousel", "IMAGE": "Image", "VIDEO": "Video",
        }.get(row.get("media_type"))
        return row.get("caption"), format_name
    attachments = row.get("attachments")
    data = attachments.get("data") if isinstance(attachments, dict) else None
    first = data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else {}
    format_name = {"photo": "Image", "album": "Carousel", "video": "Video", "link": "Link"}.get(first.get("media_type"))
    return row.get("message"), format_name or ("Text" if not data and row.get("message") else None)


async def read_source(client, source):
    try:
        async with asyncio.timeout(8):
            async with client.stream(
                "GET", f"https://graph.facebook.com/{settings.meta_version}/{source.account_id}/{source.edge}",
                params={"fields": source.fields, "limit": SAMPLE_SIZE},
                headers={"Authorization": f"Bearer {source.token.get_secret_value()}"},
            ) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise ValueError("oversized response")
        data = json.loads(body).get("data")
        if not isinstance(data, list):
            raise ValueError("invalid data")
        samples = [sample_post(source.platform, row) for row in data[:SAMPLE_SIZE] if isinstance(row, dict)]
        samples = [(caption, fmt) for caption, fmt in samples if fmt or (isinstance(caption, str) and caption.strip())]
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError, AttributeError):
        return None, f"Could not read authorized {source.platform} posts. Check the account access and permissions."
    if not samples:
        return None, f"No usable recent posts were returned by {source.platform}."
    return editorial_profile(source.platform, samples), None


async def read_company_style(company_id):
    sources = sources_for(company_id)
    if not sources:
        return [], []
    async with httpx.AsyncClient(trust_env=False, follow_redirects=False, headers={"Accept-Encoding": "identity"}) as client:
        outcomes = await asyncio.gather(*(read_source(client, source) for source in sources))
    return [profile for profile, _ in outcomes if profile], [warning for _, warning in outcomes if warning]
