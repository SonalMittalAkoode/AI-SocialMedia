import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { signInWorkspace, apiURL } from "./auth-helpers";

// Phase 8A.1 Studio brief, preview, quality and variation controls. AI providers are never called:
// generation endpoints are mocked; saved posts, uploads and reviews use the real API and database.
const headers = { Origin: "http://localhost:3000" };
const backend = path.resolve(process.cwd(), "../backend");

function png(width: number, height: number, color: string) {
  const out = execFileSync(
    path.join(backend, ".venv/Scripts/python.exe"),
    [
      "-c",
      "import io,sys,base64;from PIL import Image,ImageDraw;i=Image.new('RGB',(int(sys.argv[1]),int(sys.argv[2])),sys.argv[3]);d=ImageDraw.Draw(i);d.ellipse([i.width//4,i.height//4,i.width//2,i.height//2],fill='white');b=io.BytesIO();i.save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())",
      String(width),
      String(height),
      color,
    ],
    { encoding: "utf8" },
  );
  return Buffer.from(out.trim(), "base64");
}

async function postWithImage(page: Page, companyId: string, title: string) {
  const created = await page.request.post(`${apiURL}/companies/${companyId}/posts`, {
    headers,
    data: {
      creation_key: randomUUID(),
      title,
      platform: "Instagram",
      content_type: "image",
      caption: "Fresh pastries baked each morning for the neighbourhood.",
      hashtags: ["#Bakery"],
      hook: "Fresh pastries",
      call_to_action: "Message us to order",
      image_prompt: "Croissants cooling on a linen cloth",
      slides: [],
    },
  });
  expect(created.status()).toBe(201);
  const post = await created.json();
  const uploaded = await page.request.post(
    `${apiURL}/companies/${companyId}/posts/${post.id}/assets/upload?revision=${post.revision}`,
    { headers: { ...headers, "Content-Type": "image/png" }, data: png(800, 1000, "sienna") },
  );
  expect(uploaded.status()).toBe(201);
  return (await uploaded.json()) as { asset: Record<string, unknown>; post: { id: string; revision: number } };
}

test("creative brief, preview, quality checks, variations and caption suggestion", async ({ page }) => {
  const { companyId } = await signInWorkspace(page);
  const { asset } = await postWithImage(page, companyId, "Studio fixture image");
  const jobId = randomUUID();
  const job = { id: jobId, company_id: companyId, kind: "content_generation", status: "completed", stage: "completed", attempt_count: 1, error_code: null, error_message: null };
  const captionJob = { ...job, id: randomUUID() };
  let generated = false;
  let generationBody: Record<string, unknown> = {};
  let variationBody: Record<string, unknown> = {};
  let captionRequested = false;
  const draft = {
    title: "Morning pastry ritual",
    platform: "Instagram",
    content_type: "image",
    caption: "Warm croissants leave the oven at seven.\nStop by on your way to work.",
    hashtags: ["#Croissant", "#Bakery"],
    hook: "Warm croissants at seven",
    call_to_action: "Message us to reserve a box",
    image_prompt: "Croissants on linen",
    slides: [],
  };
  const quality = [
    {
      platform: "Instagram",
      needs_attention: 1,
      checks: [
        { id: "relevance", label: "Brand and offering relevance", status: "pass", detail: "Mentions: croissants" },
        { id: "voice", label: "Specific, non-generic wording", status: "warn", detail: "Generic phrases: elevate" },
      ],
    },
  ];
  const generatedAsset = {
    ...asset,
    post_id: null,
    result_index: 0,
    source: "generated",
    generation_mode: "fresh",
    operation: "same_brief",
    style: "editorial",
    prompt_version: "image-brief-v2",
    quality_status: "needs_review",
    quality_report: {
      status: "needs_review",
      checks: [
        { id: "aspect_ratio", label: "Aspect ratio", status: "pass", detail: "Requested 4:5; received 800×1000." },
        { id: "brand_colors", label: "Brand colours", status: "warn", detail: "No brand colour is clearly visible." },
      ],
      ai_review: { status: "disabled" },
    },
    review_decision: null,
  };
  await page.route("**/ai-capabilities", (r) =>
    r.fulfill({
      json: { image_available: true, image_edit_enabled: true, recommended_styles: ["photorealistic", "editorial"], search_available: false, search_provider: "gemini" },
    }),
  );
  await page.route("**/ai-jobs?kind=content_generation", (r) => r.fulfill({ json: generated ? [job] : [] }));
  await page.route(/\/ai-jobs\/[0-9a-f-]+$/, (r) => r.fulfill({ json: captionJob }));
  await page.route("**/content-generations", async (r) => {
    generationBody = r.request().postDataJSON();
    generated = true;
    await r.fulfill({ status: 202, json: job });
  });
  await page.route(`**/content-generations/${jobId}/result`, (r) =>
    r.fulfill({ json: { posts: [draft], strategy: {}, warnings: ["Human review required"], quality, image_jobs: [] } }),
  );
  await page.route(`**/content-generations/${jobId}/media`, (r) =>
    r.fulfill({
      json: {
        assets: [generatedAsset],
        jobs: [{ id: randomUUID(), status: "completed", stage: "completed", error_code: null, error_message: null, result_index: 0, aspect_ratio: "4:5" }],
      },
    }),
  );
  await page.route(`**/content-generations/${jobId}/results/0/images`, async (r) => {
    variationBody = r.request().postDataJSON();
    await r.fulfill({ status: 202, json: { ...job, id: randomUUID(), kind: "image_generation", status: "queued", stage: "queued" } });
  });
  await page.route(`**/content-generations/${jobId}/results/0/caption`, async (r) => {
    captionRequested = true;
    await r.fulfill({ status: 202, json: { ...captionJob, status: "queued", stage: "queued" } });
  });
  await page.route(`**/content-generations/${captionJob.id}/result`, (r) =>
    r.fulfill({
      json: { posts: [{ ...draft, caption: "Seven o'clock is croissant o'clock. Reserve a box before the morning rush.", hook: "Croissant o'clock" }], strategy: {}, warnings: [] },
    }),
  );

  await page.goto("/dashboard/content-studio");
  const brief = page.getByRole("region", { name: "Creative brief" });
  await expect(brief.getByText("Company", { exact: true })).toBeVisible();
  // Industry-recommended styles appear first; every style stays available.
  const style = brief.getByLabel("Visual style");
  await expect(style.locator("optgroup").first()).toHaveAttribute("label", "Recommended for your industry");
  await expect(style.locator("option")).toHaveCount(11);
  await brief.getByLabel("Content objective").selectOption("case_study");
  await brief.getByLabel("What's the story?").fill("Our morning pastries");
  await expect(brief.getByText(/Case studies need supplied evidence/)).toBeVisible();
  await expect(brief.getByRole("button", { name: "Generate content", exact: true })).toBeDisabled();
  await brief.getByLabel("Content objective").selectOption("promotion");
  await brief.getByLabel("Audience (optional)").fill("Office workers nearby");
  await brief.getByLabel("Caption tone").selectOption("Warm");
  await style.selectOption("editorial");
  await brief.getByText("Advanced image settings").click();
  await brief.getByLabel("Background").selectOption("textured");
  await brief.getByLabel("Text in image").check();
  await expect(brief.getByText(/AI-rendered text can contain spelling/)).toBeVisible();
  await expect(brief.getByRole("button", { name: "Generate content", exact: true })).toBeDisabled();
  await brief.getByLabel("Exact image text (up to 6 words)").fill("Fresh at seven");
  await page.screenshot({ path: "artifacts/content-studio-brief-desktop.png", fullPage: false });
  await brief.getByRole("button", { name: "Generate content", exact: true }).click();

  const preview = page.getByRole("region", { name: "Content preview" });
  await expect(preview.getByRole("article", { name: "Instagram preview" })).toContainText("Warm croissants leave the oven at seven.");
  expect(generationBody).toMatchObject({
    objective: "promotion",
    audience: "Office workers nearby",
    tone: "Warm",
    include_images: true,
    aspect_ratios: { Instagram: "4:5" },
    image_options: { visual_style: "editorial", background: "textured", text_in_image: true, overlay_text: "Fresh at seven" },
  });
  expect(generationBody).not.toHaveProperty("evidence");
  await expect(preview.getByRole("img", { name: "Generated Instagram creative" })).toBeVisible();
  await expect(preview.getByText("Needs review").first()).toBeVisible();
  await preview.getByText("Image checks: 1 to review").click();
  await expect(preview.getByText("No brand colour is clearly visible.")).toBeVisible();
  await preview.getByText("Caption checks: 1 to review").click();
  await expect(preview.getByText("Generic phrases: elevate")).toBeVisible();

  // A background variation with an existing image is labelled as an AI edit, not a precise edit.
  await preview.getByText("Refine image").click();
  await preview.getByLabel("Variation").selectOption("background");
  await expect(preview.getByText(/not a pixel-precise edit/)).toBeVisible();
  await preview.getByLabel("New background").selectOption("dark");
  await preview.getByRole("button", { name: "Create variation" }).click();
  await expect.poll(() => variationBody.operation).toBe("background");
  expect(variationBody).toMatchObject({ options: { background: "dark" } });
  await preview.getByLabel("Variation").selectOption("platform");
  await expect(preview.getByText(/Nothing is stretched or cropped/)).toBeVisible();

  await preview.getByRole("button", { name: "Regenerate caption" }).click();
  await expect.poll(() => captionRequested).toBe(true);
  await expect(preview.getByLabel("Suggested caption")).toContainText("Croissant o'clock");
  await preview.getByRole("button", { name: "Apply caption to editor" }).click();
  await expect(preview.getByRole("article", { name: "Instagram preview" })).toContainText("Reserve a box before the morning rush.");
  await expect(preview.getByLabel("Caption", { exact: true })).toHaveValue(/Reserve a box/);
  await page.screenshot({ path: "artifacts/content-studio-preview-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("region", { name: "Content preview" }).getByRole("article", { name: "Instagram preview" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "artifacts/content-studio-mobile.png", fullPage: true });
});

test("image review blocks approval of a rejected image and variations confirm on approved posts", async ({ page }) => {
  const { companyId } = await signInWorkspace(page);
  const { post } = await postWithImage(page, companyId, "Review flow pastry");
  let variation: Record<string, unknown> | null = null;
  // The real worker must not run a paid generation from this test.
  await page.route(`**/posts/${post.id}/images`, async (r) => {
    variation = r.request().postDataJSON();
    await r.fulfill({ status: 202, json: { id: randomUUID(), company_id: companyId, kind: "image_generation", status: "queued", stage: "queued", attempt_count: 0, error_code: null, error_message: null } });
  });
  await page.goto(`/dashboard/posts?edit=${post.id}`);
  const dialog = page.getByRole("dialog", { name: "Review saved draft" });
  const images = dialog.getByRole("region", { name: "Post images" });
  await expect(images.getByText("Your upload").first()).toBeVisible();
  await images.getByRole("button", { name: "Reject image" }).click();
  await expect(images.getByRole("button", { name: "Reject image" })).toHaveAttribute("aria-pressed", "true");
  await expect(images.getByText(/This image is rejected/)).toBeVisible();
  await dialog.getByRole("button", { name: "Approve saved draft", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: /rejected/ })).toBeVisible();
  await images.getByRole("button", { name: "Accept image" }).click();
  await expect(images.getByRole("button", { name: "Accept image" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Approve saved draft", exact: true }).click();
  await expect(dialog.getByText("Draft approved")).toBeVisible();
  // A variation on an approved post needs explicit confirmation first.
  await images.getByText("Refine image").click();
  await images.getByLabel("Variation").selectOption("simplify");
  await images.getByRole("button", { name: "Create variation" }).click();
  await expect(images.getByRole("alertdialog", { name: "Confirm image variation" })).toBeVisible();
  expect(variation).toBeNull();
  await images.getByRole("alertdialog", { name: "Confirm image variation" }).getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => (variation as Record<string, unknown> | null)?.operation).toBe("simplify");
  await page.screenshot({ path: "artifacts/post-image-review-desktop.png", fullPage: false });
  const assets = await page.request.get(`${apiURL}/companies/${companyId}/posts/${post.id}/assets`, { headers });
  expect((await assets.json())[0].review_decision).toBe("accepted");
});
