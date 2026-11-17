import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { signInWorkspace, apiURL } from "./auth-helpers";

const headers = { Origin: "http://localhost:3000" };
const backend = path.resolve(process.cwd(), "../backend");

/** Real PNG bytes from Pillow (no network, no AI provider). */
function png(width: number, height: number, color: string) {
  const out = execFileSync(
    path.join(backend, ".venv/Scripts/python.exe"),
    [
      "-c",
      "import io,sys,base64;from PIL import Image;b=io.BytesIO();Image.new('RGB',(int(sys.argv[1]),int(sys.argv[2])),sys.argv[3]).save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())",
      String(width),
      String(height),
      color,
    ],
    { encoding: "utf8" },
  );
  return Buffer.from(out.trim(), "base64");
}

async function createPost(page: Page, companyId: string) {
  const response = await page.request.post(`${apiURL}/companies/${companyId}/posts`, {
    headers,
    data: {
      creation_key: randomUUID(),
      title: "Morning roast media test",
      platform: "Instagram",
      content_type: "image",
      caption: "Fresh beans, warm mornings.",
      hashtags: ["#Coffee"],
      hook: "Fresh beans",
      call_to_action: "Visit us",
      image_prompt: "Steam rising over a ceramic cup",
      slides: [],
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test("post images upload, preview, download, revision protection, caption regeneration and history", async ({
  page,
}) => {
  const { companyId } = await signInWorkspace(page);
  const post = await createPost(page, companyId);
  await page.goto(`/dashboard/posts?edit=${post.id}`);
  const dialog = page.getByRole("dialog");
  const images = dialog.getByRole("region", { name: "Post images" });
  await expect(images.getByText("Text-only post")).toBeVisible();
  await expect(images.getByText(/Instagram default 4:5/)).toBeVisible();

  // Upload validates, stores privately and attaches as the post's image.
  await images.getByLabel("Upload image file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: png(400, 500, "sienna"),
  });
  await expect(images.getByText("Image uploaded, validated and attached to this post.")).toBeVisible();
  await expect(images.getByRole("img", { name: "Image for Morning roast media test" })).toBeVisible();
  await expect(images.getByText("Uploaded · 4:5")).toBeVisible();
  const download = images.getByRole("link", { name: "Download image" });
  const href = await download.getAttribute("href");
  expect(href).toContain("?download=true");
  const file = await page.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain("attachment");
  expect(file.headers()["content-disposition"]).toContain("portrait.png");

  // A non-image is rejected before upload and by the server.
  await images.getByLabel("Upload image file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(images.getByRole("alert")).toContainText("Use a PNG, JPEG or WEBP image.");

  // Approve, then change the image: requires confirmation and returns the post to draft.
  await dialog.getByRole("button", { name: "Approve saved draft" }).click();
  await expect(dialog.getByText("Draft approved")).toBeVisible();
  await expect(images.getByText(/This post is approved/)).toBeVisible();
  await images.getByLabel("Upload image file").setInputFiles({
    name: "square.png",
    mimeType: "image/png",
    buffer: png(300, 300, "olive"),
  });
  await expect(images.getByRole("alertdialog", { name: "Confirm image change" })).toBeVisible();
  await images.getByRole("button", { name: "Continue" }).click();
  await expect(images.getByText("Uploaded · 1:1")).toBeVisible();
  await expect(dialog.getByText("draft", { exact: true })).toBeVisible();
  const gallery = images.getByRole("list", { name: "All images for this post" });
  await expect(gallery.getByRole("listitem")).toHaveCount(2);
  await gallery.getByRole("button", { name: "Use this image" }).click();
  await expect(images.getByText("Image selected for this post.")).toBeVisible();
  await expect(gallery.getByText("In use")).toBeVisible();

  // Caption regeneration (provider mocked): suggestion is applied only on request.
  const jobId = randomUUID();
  const job = {
    id: jobId,
    company_id: companyId,
    kind: "content_generation",
    status: "completed",
    stage: "completed",
    attempt_count: 1,
    error_code: null,
    error_message: null,
  };
  await page.route("**/posts/*/regenerate", (r) => r.fulfill({ status: 202, json: { ...job, status: "queued", stage: "queued" } }));
  await page.route(`**/ai-jobs/${jobId}`, (r) => r.fulfill({ json: job }));
  await page.route(`**/content-generations/${jobId}/result`, (r) =>
    r.fulfill({
      json: {
        posts: [
          {
            title: "Morning roast media test",
            platform: "Instagram",
            content_type: "image",
            caption: "A brand new regenerated caption about our morning roast.",
            hashtags: ["#FreshRoast"],
            hook: "New hook",
            call_to_action: "Stop by today",
            image_prompt: "Steam rising over a ceramic cup",
            slides: [],
          },
        ],
        strategy: {},
        warnings: [],
      },
    }),
  );
  await dialog.getByRole("button", { name: "Regenerate caption" }).click();
  const suggestion = dialog.getByLabel("Suggested caption");
  await expect(suggestion).toContainText("A brand new regenerated caption");
  await expect(dialog.getByLabel("Caption", { exact: true })).toHaveValue("Fresh beans, warm mornings.");
  await suggestion.getByRole("button", { name: "Apply caption to editor" }).click();
  await expect(dialog.getByLabel("Caption", { exact: true })).toHaveValue(
    "A brand new regenerated caption about our morning roast.",
  );
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByText("Changes saved", { exact: true })).toBeVisible();

  // Version history keeps the earlier caption.
  await dialog.getByText("Version history").click();
  await expect(dialog.getByText("Fresh beans, warm mornings.").first()).toBeVisible();

  await page.screenshot({ path: "artifacts/post-media-desktop.png", fullPage: false });

  // Persistence: images, chosen image and caption survive reload.
  await page.reload();
  const reopened = page.getByRole("dialog").getByRole("region", { name: "Post images" });
  await expect(reopened.getByRole("list", { name: "All images for this post" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("dialog").getByLabel("Caption", { exact: true })).toHaveValue(
    "A brand new regenerated caption about our morning roast.",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(reopened.getByRole("button", { name: "Upload image" })).toBeVisible();
  await page.screenshot({ path: "artifacts/post-media-mobile.png", fullPage: false });
});

test("studio requests captions with on-brand images and shows the result image", async ({ page }) => {
  const { companyId } = await signInWorkspace(page);
  // A real stored asset to display for the mocked result (no AI provider call).
  const post = await createPost(page, companyId);
  const uploaded = await page.request.post(
    `${apiURL}/companies/${companyId}/posts/${post.id}/assets/upload?revision=${post.revision}`,
    { headers: { ...headers, "Content-Type": "image/png" }, data: png(400, 500, "peru") },
  );
  expect(uploaded.status()).toBe(201);
  const asset = (await uploaded.json()).asset;
  const jobId = randomUUID();
  const job = {
    id: jobId,
    company_id: companyId,
    kind: "content_generation",
    status: "completed",
    stage: "completed",
    attempt_count: 1,
    error_code: null,
    error_message: null,
  };
  let generated = false;
  let requestBody: Record<string, unknown> = {};
  await page.route("**/ai-capabilities", (r) => r.fulfill({ json: { image_available: true, search_available: false, search_provider: "gemini" } }));
  await page.route("**/ai-jobs?kind=content_generation", (r) => r.fulfill({ json: generated ? [job] : [] }));
  await page.route("**/content-generations", async (r) => {
    requestBody = r.request().postDataJSON();
    generated = true;
    await r.fulfill({ status: 202, json: job });
  });
  await page.route(`**/content-generations/${jobId}/result`, (r) =>
    r.fulfill({
      json: {
        posts: [
          {
            title: "Image result",
            platform: "Instagram",
            content_type: "image",
            caption: "Our roast, beautifully presented.",
            hashtags: ["#Roast"],
            hook: "Roast",
            call_to_action: "Visit",
            image_prompt: "Beans",
            slides: [],
          },
        ],
        strategy: {},
        warnings: [],
        image_jobs: [{ result_index: 0, job_id: randomUUID(), aspect_ratio: "4:5" }],
      },
    }),
  );
  await page.route(`**/content-generations/${jobId}/media`, (r) =>
    r.fulfill({
      json: {
        assets: [{ ...asset, post_id: null, result_index: 0 }],
        jobs: [{ id: randomUUID(), status: "completed", stage: "completed", error_code: null, error_message: null, result_index: 0, aspect_ratio: "4:5" }],
      },
    }),
  );
  await page.goto("/dashboard/content-studio");
  await expect(page.getByLabel("Generate images with posts")).toBeChecked();
  await expect(page.getByLabel("Image size for Instagram")).toHaveValue("4:5");
  await page.getByLabel("What's the story?").fill("Our new roast");
  await page.getByRole("button", { name: "Generate content", exact: true }).click();
  await expect(page.getByRole("img", { name: "Generated Instagram creative" })).toBeVisible();
  expect(requestBody.include_images).toBe(true);
  expect(requestBody.aspect_ratios).toEqual({ Instagram: "4:5" });
  await expect(page.getByRole("region", { name: "Image for Instagram result" }).getByRole("button", { name: "Regenerate image" })).toBeVisible();
  await page.screenshot({ path: "artifacts/studio-image-desktop.png", fullPage: false });
});
