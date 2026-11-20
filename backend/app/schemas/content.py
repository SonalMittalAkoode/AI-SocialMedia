import re
from datetime import datetime
import unicodedata
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator, field_validator

Platform = Literal['Instagram','LinkedIn','Facebook','X']
ContentType = Literal['text','image','carousel','educational','promotional','thought_leadership','storytelling','meme']
Status = Literal['draft','ready_for_review','approved','archived']
# Conservative editorial caps, not a promise of publishing API compatibility.
CAPS = {'Instagram':2200,'LinkedIn':2800,'Facebook':5000,'X':280}


class Slide(BaseModel):
    model_config = ConfigDict(extra='forbid')
    heading: str = Field(min_length=1,max_length=120)
    body: str = Field(min_length=1,max_length=500)
    visual: str = Field(min_length=1,max_length=500)


class ContentDraft(BaseModel):
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    title: str = Field(min_length=2,max_length=200)
    platform: Platform
    content_type: ContentType = 'text'
    caption: str = Field(min_length=1,max_length=5000)
    hashtags: list[str] = Field(default_factory=list,max_length=5)
    hook: str = Field(default='',max_length=300)
    call_to_action: str = Field(default='',max_length=300)
    image_prompt: str = Field(default='',max_length=1600)
    slides: list[Slide] = Field(default_factory=list,max_length=8)

    @field_validator('hashtags')
    @classmethod
    def tags(cls,values):
        if any(not re.fullmatch(r'#[\w]{1,60}',v) for v in values):raise ValueError('Use plain hashtags without spaces')
        if len({v.casefold() for v in values})!=len(values):raise ValueError('Duplicate hashtag')
        return values

    @model_validator(mode='after')
    def platform_valid(self):
        text=unicodedata.normalize('NFC',self.caption+' '+ ' '.join(self.hashtags))
        # Deliberately overcounts complex emoji and URL text; never undercounts short URLs.
        if self.platform=='X':
            text=re.sub(r'https?://\S+',lambda m:'x'*max(23,len(m[0])),text)
            length=sum(1 if ord(c)<=0x10ff or 0x2000<=ord(c)<=0x200d or 0x2010<=ord(c)<=0x201f or 0x2032<=ord(c)<=0x2037 else 2 for c in text)
        else:length=len(text.strip())
        if length>CAPS[self.platform]:raise ValueError('Caption and hashtags exceed the editorial platform limit')
        if self.content_type=='carousel' and len(self.slides)<2:raise ValueError('Carousel requires 2-8 structured slides')
        if self.content_type in ('image','meme') and not self.image_prompt:raise ValueError('A visual concept is required')
        return self


AspectRatio = Literal['1:1','4:5','3:4','4:3','16:9','9:16','3:2','2:3']
Objective = Literal['educational','brand_awareness','promotion','thought_leadership','engagement','announcement','case_study','promotional_campaign']
VisualStyle = Literal['auto','premium_minimal','photorealistic','editorial','corporate','product_render_3d','modern_illustration',
                      'cinematic','lifestyle','abstract_technology','custom']
ImageOperation = Literal['same_brief','custom','style','background','color_emphasis','simplify','refine','alternative','platform']


class ImageOptions(BaseModel):
    """Creative controls for image briefs. Defaults keep the brand-recommended, no-text behaviour."""
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    visual_style: VisualStyle = 'auto'
    custom_style: str = Field(default='',max_length=300)
    color_intensity: Literal['auto','muted','balanced','vibrant'] = 'auto'
    background: Literal['auto','clean_studio','natural_setting','textured','gradient','dark','light'] = 'auto'
    subject_emphasis: Literal['auto','product','environment','people_in_context','concept'] = 'auto'
    negative_space: Literal['auto','minimal','balanced','generous'] = 'auto'
    detail_level: Literal['auto','minimal','balanced','detailed'] = 'auto'
    text_in_image: bool = False
    overlay_text: str = Field(default='',max_length=60)
    product_imagery: Literal['auto','category_illustration','no_product'] = 'auto'
    negative_instructions: str = Field(default='',max_length=300)

    @model_validator(mode='after')
    def consistent(self):
        if self.visual_style=='custom' and not self.custom_style:raise ValueError('Describe the custom visual style')
        if self.text_in_image:
            if not self.overlay_text:raise ValueError('Enter the exact short text to show in the image')
            if len(self.overlay_text.split())>6:raise ValueError('Image text must be 6 words or fewer so it stays legible')
            if re.search(r'https?://|www\.|[<>{}\[\]\\]',self.overlay_text):raise ValueError('Image text cannot contain links or markup')
        elif self.overlay_text:raise ValueError('Turn on text in image to render image text')
        return self


class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    platforms: list[Platform] = Field(min_length=1,max_length=3)
    content_type: ContentType = 'educational'
    topic: str = Field(min_length=2,max_length=500)
    instructions: str = Field(default='',max_length=1500)
    # Creative brief (all optional; saved preferences are used when omitted).
    objective: Objective | None = None
    audience: str = Field(default='',max_length=200)
    tone: str = Field(default='',max_length=100)
    campaign: str = Field(default='',max_length=300)
    # User-supplied facts (e.g. case-study evidence or announcement details) the copy may cite.
    evidence: str = Field(default='',max_length=1500)
    # Text-with-image: one image job per result is queued after the text completes.
    include_images: bool = False
    aspect_ratios: dict[Platform, AspectRatio] | None = None
    image_options: ImageOptions | None = None
    use_recent_social_posts: bool = True
    published_caption_examples: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1200)]] = Field(default_factory=list, max_length=6)
    @field_validator('platforms')
    @classmethod
    def unique(cls,v):
        if len(set(v))!=len(v):raise ValueError('Duplicate platforms')
        return v
    @model_validator(mode='after')
    def evidence_required(self):
        if self.objective=='case_study' and len(self.evidence.strip())<20:
            raise ValueError('Case studies need supplied evidence (what was done and the verified outcome)')
        return self


class RegenerateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    # caption: new caption/hook/CTA/hashtags for the same post and visual; full: a fresh alternative.
    mode: Literal['full','caption'] = 'full'
    instructions: str = Field(default='',max_length=500)


class ImageRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    aspect_ratio: AspectRatio | None = None
    instructions: str = Field(default='',max_length=500)
    # Variation of an earlier image; options not supplied are inherited from that image.
    operation: ImageOperation = 'same_brief'
    parent_asset_id: UUID | None = None
    options: ImageOptions | None = None

    @model_validator(mode='after')
    def operation_inputs(self):
        if self.operation in ('custom','refine') and not self.instructions.strip():raise ValueError('Describe the change you want')
        if self.operation=='style' and (not self.options or self.options.visual_style=='auto'):raise ValueError('Choose a visual style')
        if self.operation=='background' and (not self.options or self.options.background=='auto'):raise ValueError('Choose a background')
        if self.operation=='color_emphasis' and (not self.options or self.options.color_intensity=='auto'):raise ValueError('Choose a colour emphasis')
        if self.operation=='platform' and not self.aspect_ratio:raise ValueError('Choose the target aspect ratio')
        return self


class AssetReview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    decision: Literal['accepted','rejected'] | None


class PrimaryAssetRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=1)
    asset_id: UUID | None


class GeneratedContent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    posts: list[ContentDraft] = Field(min_length=1,max_length=3)


class PostCreate(ContentDraft):
    creation_key: UUID
    generation_job_id: UUID | None = None
    result_index: int | None = Field(default=None,ge=0,le=2)


class PostUpdate(ContentDraft):
    revision: int = Field(ge=1)
    status: Status = 'draft'


class PostResponse(ContentDraft):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    revision: int
    status: Status
    generation_job_id: UUID | None
    primary_asset_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class RevisionRequest(BaseModel):
    revision: int = Field(ge=1)
