// Model discovery for Drop Black's Layers tab.
//
// Some layers (Temperature, Wind speed, Precip type, …) show a model picker
// (FOD / GRAF / HRRR / ECMWF / GFS) on the map once they're on, and each layer
// offers a different set. This script logs in, turns on every Layers-tab layer
// one at a time, and records which models it offers, which one is the default,
// and the card id each model switches the layer to (picking a model swaps the
// card's data-testid, e.g. WindSpeedGraf → WindSpeedHrrr).
//
// Picking a model is effectively GLOBAL in Drop Black: it switches every layer
// that offers that model (ECMWF on Cloud cover also moves Temperature, Wind
// speed, … to ECMWF). Re-clicking one layer's default doesn't undo that for
// layers with a different default, so the page is reloaded (which restores
// every default) after each layer that has a picker.
//
// Writes layer-models.json, which the config builder (model dropdown) and the
// test (model selection + finding the layer again after a switch) both read.
// Re-run when Drop Black adds or removes models:
//
//   pnpm models                (uses the url in test-config.json)
//   pnpm models <url>          (another environment)
//
// Drop Black is left on its defaults (model choices don't survive a reload).

require('dotenv').config({ path: __dirname + '/.env' });
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'test-config.json');
const outPath = path.join(__dirname, 'layer-models.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const APP_URL = process.argv[2] || config.url || 'https://drop-black-dev.vercel.weather.com/';
const APP_HOST = new URL(APP_URL).host;
const PICKER = '[role="group"][aria-label="Model"]';
const PICKER_WAIT_MS = 12000; // forecast layers can take a few seconds to show the picker

(async () => {
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  if (!email || !password) {
    console.error('❌ LOGIN_EMAIL / LOGIN_PASSWORD missing from drop-black-map-performance/.env');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, args: ['--window-size=1718,1080', '--window-position=0,0'] });
  const page = await (await browser.newContext({ viewport: { width: 1718, height: 960 } })).newPage();

  const activeCardIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="layer-card-"] button.bedrock-map-layer-card-item[aria-pressed="true"]')]
    .map((b) => b.closest('[data-testid^="layer-card-"]').getAttribute('data-testid').replace('layer-card-', '')));

  // The picker on the map, or null. Its buttons carry the layer name as `title`,
  // which is how we know it belongs to the layer we just turned on.
  const readPicker = () => page.evaluate((sel) => {
    const g = document.querySelector(sel);
    if (!g) return null;
    const btns = [...g.querySelectorAll('button')];
    return {
      title: btns[0] ? (btns[0].getAttribute('title') || '').trim() : '',
      models: btns.map((b) => b.textContent.trim()),
      pressed: btns.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
    };
  }, PICKER);

  async function selectCard(id) {
    const btn = page.locator(`[data-testid="layer-card-${id}"] button.bedrock-map-layer-card-item`).first();
    if (!(await btn.count())) return false;
    await btn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    if ((await btn.getAttribute('aria-pressed', { timeout: 5000 }).catch(() => null)) !== 'true') {
      await btn.click({ timeout: 5000 }).catch(() => {});
    }
    for (let i = 0; i < 10; i++) {
      if ((await activeCardIds()).includes(id)) return true;
      await page.waitForTimeout(500);
    }
    return false;
  }

  async function openLayersTab() {
    const menu = page.getByRole('button', { name: 'Layer menu', exact: true });
    if ((await menu.getAttribute('aria-pressed').catch(() => null)) !== 'true') await menu.click();
    await page.waitForTimeout(1000);
    await page.getByTestId('bedrock-map-layer-card-menu-tab-layers').click();
    await page.waitForTimeout(1000);
  }

  // Reload to put every layer back on its default model (see top of file).
  async function resetModels() {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.wxmap && document.querySelector('canvas.mapboxgl-canvas'), null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    await openLayersTab();
  }

  async function clickModel(model) {
    await page.locator(PICKER).getByRole('button', { name: model, exact: true }).click({ timeout: 5000 });
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      const p = await readPicker();
      if (p && p.pressed.includes(model)) break;
    }
    await page.waitForTimeout(1500);
    return (await activeCardIds())[0] || null;
  }

  try {
    console.log(`🔎 Discovering layer models on ${APP_URL}\n`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const emailField = page.locator('input[type="email"]').first();
    await emailField.waitFor({ state: 'visible', timeout: 60000 });
    await emailField.fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const passwordField = page.locator('input[type="password"]').first();
    await passwordField.waitFor({ state: 'visible', timeout: 60000 });
    await passwordField.fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL((u) => u.host === APP_HOST, { timeout: 120000, waitUntil: 'commit' });
    await page.waitForFunction(() => window.wxmap && document.querySelector('canvas.mapboxgl-canvas'), null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    for (const name of ['Not now', 'Collapse mission panel']) {
      const b = page.getByRole('button', { name, exact: true });
      if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
    console.log('✅ Logged in — map loaded\n');

    await openLayersTab();
    const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="layer-card-"]')].map((e) => ({
      id: e.getAttribute('data-testid').replace('layer-card-', ''),
      name: (e.querySelector('.bedrock-map-layer-card-item-name') || e).textContent.trim(),
    })));
    console.log(`📋 ${cards.length} Layers-tab layers\n`);

    const layers = {};
    const problems = [];
    for (const { id, name } of cards) {
      if (!(await selectCard(id))) {
        problems.push(`${name} (${id}): could not turn it on`);
        console.log(`❌ ${name.padEnd(42)} could not turn it on`);
        continue;
      }
      let picker = null;
      for (let waited = 0; waited < PICKER_WAIT_MS; waited += 500) {
        const p = await readPicker();
        if (p && p.title.toLowerCase() === name.toLowerCase()) { picker = p; break; }
        await page.waitForTimeout(500);
      }
      if (!picker) {
        console.log(`   ${name.padEnd(42)} —`);
        continue;
      }
      const defaultModel = picker.pressed[0] || picker.models[0];
      const models = {};
      for (const model of picker.models) models[model] = await clickModel(model);
      layers[id] = { name, default: defaultModel, models };
      if (models[defaultModel] !== id) problems.push(`${name}: its default model ${defaultModel} gave card "${models[defaultModel]}", expected "${id}"`);
      await resetModels();
      const back = await page.evaluate((all) => all.filter((x) => !document.querySelector(`[data-testid="layer-card-${x}"]`)), cards.map((c) => c.id));
      if (back.length) problems.push(`after resetting from ${name}, these layers were still not back on their default id: ${back.join(', ')}`);
      console.log(`✅ ${name.padEnd(42)} ${picker.models.join(', ')}  (default ${defaultModel})`);
    }

    const out = {
      _about: 'Written by `pnpm models` (discover_models.js). Keys are Layers-tab ids as they appear on a fresh load; '
        + '`models` maps each model button to the card id the layer switches to. Layers not listed have no model choice.',
      generatedAt: new Date().toISOString(),
      url: APP_URL,
      layerCount: cards.length,
      layers,
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
    console.log(`\n💾 ${Object.keys(layers).length} of ${cards.length} layers have a model choice — saved ${path.basename(outPath)}`);
    if (problems.length) {
      console.log('\n⚠️  Check these:');
      for (const p of problems) console.log(`   • ${p}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(`\n❌ Model discovery failed: ${e.message}`);
  process.exit(1);
});
