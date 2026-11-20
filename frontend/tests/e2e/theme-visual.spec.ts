import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { signInWorkspace, apiURL } from "./auth-helpers";
import { addDays, dayInZone } from "../../src/lib/scheduling-api";

// SocialAI application theme: screenshots of every screen plus palette and contrast checks.
// Seeds a fresh test workspace through the real API; no AI provider is called.
const headers = { Origin: "http://localhost:3000" };
const phase = process.env.THEME_PHASE || "after";
const outDir = path.resolve(process.cwd(), "artifacts/theme-redesign", phase === "after" ? "" : phase);
const backend = path.resolve(process.cwd(), "../backend");

const publicPages = [
  ["landing", "/"],
  ["login", "/login"],
  ["signup", "/signup"],
] as const;
const dashboardPages = [
  ["dashboard-overview", "/dashboard"],
  ["dashboard-companies", "/dashboard/companies"],
  ["dashboard-brand", "/dashboard/brand"],
  ["dashboard-competitors", "/dashboard/competitors"],
  ["dashboard-content-studio", "/dashboard/content-studio"],
  ["dashboard-post-library", "/dashboard/posts"],
  ["dashboard-calendar", "/dashboard/calendar"],
  ["dashboard-social-accounts", "/dashboard/accounts"],
  ["dashboard-analytics", "/dashboard/analytics"],
  ["dashboard-settings", "/dashboard/settings"],
] as const;
const responsivePages = [
  "landing",
  "dashboard-overview",
  "dashboard-competitors",
  "dashboard-content-studio",
  "dashboard-post-library",
  "dashboard-calendar",
];

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

async function seed(page: Page, companyId: string) {
  const root = `${apiURL}/companies/${companyId}`;
  const create = async (title: string, platform: string, caption: string, content_type = "text") => {
    const r = await page.request.post(`${root}/posts`, {
      headers,
      data: { creation_key: randomUUID(), title, platform, content_type, caption, hashtags: ["#Coffee"], hook: title, call_to_action: "Visit us this week", image_prompt: content_type === "image" ? "Pour-over coffee on a wooden counter" : "", slides: [] },
    });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const imagePost = await create("Morning pour-over ritual", "Instagram", "Slow mornings start with a careful pour-over.", "image");
  const uploaded = await page.request.post(`${root}/posts/${imagePost.id}/assets/upload?revision=${imagePost.revision}`, {
    headers: { ...headers, "Content-Type": "image/png" },
    data: png(800, 1000, "sienna"),
  });
  expect(uploaded.status()).toBe(201);
  await create("Why we roast in small batches", "LinkedIn", "Small batches let us taste every roast before it reaches you.");
  let scheduled = await create("Weekend tasting flight", "Facebook", "Three single origins, one tasting flight, every Saturday.");
  scheduled = await (await page.request.post(`${root}/posts/${scheduled.id}/approve`, { headers, data: { revision: scheduled.revision } })).json();
  const date = addDays(dayInZone(new Date(), "Asia/Kolkata"), 2);
  const s = await page.request.post(`${root}/schedules`, {
    headers,
    data: { idempotency_key: randomUUID(), post_id: scheduled.id, target_platform: scheduled.platform, post_revision: scheduled.revision, local_date: date, local_time: "10:30", timezone: "Asia/Kolkata" },
  });
  expect(s.status()).toBe(201);
  for (const [i, name] of ["Harbour Roasters", "Little Bean Collective"].entries()) {
    const c = await page.request.post(`${root}/competitors`, {
      headers,
      data: { name, website_url: `https://theme-fixture-${i}-${randomUUID().slice(0, 8)}.iana.org`, industry: "Food & Beverage" },
    });
    expect(c.status()).toBe(201);
  }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

async function shoot(page: Page, name: string) {
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}

// Visible text whose colour fails WCAG AA against the nearest opaque background behind it.
async function contrastFailures(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const blend = (top: { r: number; g: number; b: number; a: number }, under: { r: number; g: number; b: number }) => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
    });
    const backgroundOf = (el: Element | null): { r: number; g: number; b: number } | null => {
      const layers: { r: number; g: number; b: number; a: number }[] = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        // Images and gradients cannot be measured reliably; skip such text.
        if (s.backgroundImage !== "none" || e.tagName === "IMG" || e.tagName === "VIDEO") return null;
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 1) break;
        }
      }
      let base = { r: 255, g: 255, b: 255 };
      for (const l of layers.reverse()) base = blend(l, base);
      return base;
    };
    const failures: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent?.trim()) continue;
      seen.add(el);
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (s.visibility === "hidden" || s.display === "none" || r.width < 1 || r.height < 1 || Number(s.opacity) < 0.6) continue;
      if (el.closest("[aria-hidden='true'], .creative, svg, [data-customer-art]")) continue;
      if (el.closest("button:disabled, [aria-disabled='true'], input:disabled, select:disabled, textarea:disabled")) continue;
      const fg = parse(s.color);
      const bg = backgroundOf(el);
      if (!fg || !bg) continue;
      const color = blend(fg, bg);
      const [a, b] = [lum(color), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      const size = parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < need) failures.push(`${ratio.toFixed(2)} < ${need}: "${node.textContent.trim().slice(0, 40)}" (${el.tagName.toLowerCase()}.${el.className})`);
    }
    return failures;
  });
}

const checks: Record<string, string[]> = {};

test("theme screenshots and accessibility checks across every screen", async ({ page, browser }) => {
  test.setTimeout(420000);
  const verify = phase === "after";
  const record = async (name: string) => {
    await settle(page);
    await shoot(page, name);
    if (verify) checks[name] = await contrastFailures(page);
  };
  for (const [name, url] of publicPages) {
    await page.goto(url);
    await record(name);
  }
  const { companyId } = await signInWorkspace(page);
  await seed(page, companyId);
  for (const [name, url] of [...dashboardPages]) {
    await page.goto(url);
    await record(name);
  }
  // Representative interaction states.
  await page.goto("/dashboard/content-studio");
  await settle(page);
  await page.getByRole("button", { name: "Advanced image options" }).click({ timeout: 3000 }).catch(() => undefined);
  await page.getByLabel(/Topic/).first().focus({ timeout: 3000 }).catch(() => undefined);
  await record("state-studio-advanced-focus");
  await page.goto("/dashboard/calendar");
  await settle(page);
  await page.getByRole("button", { name: "Plan a post" }).first().click({ timeout: 3000 }).catch(() => undefined);
  await record("state-calendar-plan-dialog");

  for (const [label, viewport] of [
    ["mobile", { width: 390, height: 844 }],
    ["tablet", { width: 820, height: 1180 }],
  ] as const) {
    const context = await browser.newContext({ viewport, storageState: await page.context().storageState() });
    const p = await context.newPage();
    for (const [name, url] of [...publicPages, ...dashboardPages]) {
      if (!responsivePages.includes(name)) continue;
      await p.goto(url);
      await settle(p);
      fs.mkdirSync(outDir, { recursive: true });
      await p.screenshot({ path: path.join(outDir, `${name}-${label}.png`), fullPage: true });
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${label} has no horizontal scroll`).toBe(true);
    }
    if (label === "mobile") {
      await p.goto("/dashboard");
      await settle(p);
      await p.locator(".dashboard-header .mobile-menu").first().click({ timeout: 3000 }).catch(() => undefined);
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(outDir, `dashboard-sidebar-open-mobile.png`) });
    }
    await context.close();
  }

  if (!verify) return;
  fs.writeFileSync(path.join(outDir, "contrast-report.json"), JSON.stringify(checks, null, 2));
  const failing = Object.entries(checks).filter(([, f]) => f.length);
  expect(failing.map(([n, f]) => `${n}: ${f.slice(0, 5).join(" | ")}`), "text below WCAG AA contrast").toEqual([]);
});

test("application palette tokens are applied and customer colours are untouched", async ({ page }) => {
  test.skip(phase !== "after", "palette assertions apply to the redesigned theme");
  await signInWorkspace(page);
  await page.goto("/dashboard");
  await settle(page);
  const colors = await page.evaluate(() => {
    const s = (sel: string, prop = "backgroundColor") => {
      const el = document.querySelector(sel);
      return el ? (getComputedStyle(el) as unknown as Record<string, string>)[prop] : null;
    };
    return {
      body: s("body"),
      bodyText: s("body", "color"),
      sidebar: s(".sidebar"),
      primary: s(".button-primary, .crm-create-post"),
      primaryText: s(".button-primary, .crm-create-post", "color"),
    };
  });
  expect(colors.body).toBe("rgb(245, 218, 191)");
  expect(colors.bodyText).toBe("rgb(15, 61, 58)");
  expect(colors.sidebar).toBe("rgb(15, 61, 58)");
  expect(colors.primary).toBe("rgb(108, 21, 30)");
  expect(colors.primaryText).toBe("rgb(245, 218, 191)");
});
