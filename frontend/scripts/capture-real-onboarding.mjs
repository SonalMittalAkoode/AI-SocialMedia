// Explicit local QA capture. Reads only the isolated live-check credentials.
// Never starts Google grounded search or records its ephemeral response.
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const auth = JSON.parse(await readFile(path.join(os.tmpdir(), 'socialai-phase76-live-auth.json'), 'utf8'));
if (!auth.email.startsWith('e2e-phase76-live-')) throw Error('QA account required');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width:1440,height:1000 }, reducedMotion:'reduce' });
const api = 'http://localhost:8000/api/v1';
const login = await context.request.post(`${api}/auth/login`, { headers:{Origin:'http://localhost:3000'}, data:{email:auth.email,password:auth.password} });
if (!login.ok()) throw Error('QA login failed');
const user = await (await context.request.get(`${api}/auth/me`)).json();
const page = await context.newPage();
await page.goto('http://localhost:3000/dashboard');
await page.evaluate(({user,auth}) => localStorage.setItem(`socialai-active:${user.id}`, JSON.stringify({workspaceId:auth.workspace_id,companyId:auth.company_id})),{user,auth});
await page.reload();
await mkdir('artifacts',{recursive:true});
const checks = [];
for (const width of [1440,375]) {
  await page.setViewportSize({width,height:1000});
  for (const step of ['business','brand','competitors','preferences','generate']) {
    await page.goto(`http://localhost:3000/onboarding/${step}`);
    await page.locator('main h1').waitFor();
    if (step==='brand') {
      await page.getByAltText('Company logo',{exact:true}).waitFor();
      await page.waitForFunction(() => [...document.images].some(i=>i.alt==='Company logo'&&i.naturalWidth>0));
    }
    if (step==='competitors') await page.getByText('Thoughtworks',{exact:true}).first().waitFor();
    // Finish font loading/layout; never capture live grounding results.
    await page.evaluate(()=>document.fonts.ready);
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if (overflow) throw Error(`Overflow on ${step} at ${width}`);
    const file = `artifacts/real-onboarding-${step}-${width===375?'mobile':'desktop'}.png`;
    await page.screenshot({path:file,fullPage:true});
    checks.push({step,width,file});
  }
}
await page.setViewportSize({width:1440,height:1000});
await page.goto('http://localhost:3000/dashboard/posts');
await page.getByRole('button',{name:/Edit /}).first().waitFor();
await page.waitForFunction(()=>[...document.images].some(i=>i.naturalWidth>0&&i.src.includes('/media/')));
await page.screenshot({path:'artifacts/real-onboarding-post-library.png',fullPage:true});
await writeFile('artifacts/real-onboarding-captures.json',JSON.stringify(checks,null,2));
console.log(`Captured ${checks.length} onboarding screens and the saved Post Library with real images.`);
await browser.close();
