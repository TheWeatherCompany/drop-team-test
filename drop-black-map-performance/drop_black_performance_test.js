// Load environment variables from .env file
require('dotenv').config({ path: __dirname + '/.env' });
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Drop Black map performance stress test. Ported from map-performance/
// map_performance_test.js (Maverick) — same metrics sampler, CSV format, phase
// loop and analysis PDF, but driving Drop Black's Pangea/Mapbox map. No airport
// visits. The map viewport is exposed on window.wxmap (Pangea MapViewport).

(async () => {
  console.log('🚀 Starting Drop Black Performance Stress Test...\n');

  // Load test configuration
  const configPath = path.join(__dirname, 'test-config.json');
  let config;

  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('✅ Test configuration loaded from test-config.json\n');
  } catch (error) {
    console.error('❌ ERROR: Could not load test-config.json!');
    console.error(`   ${error.message}`);
    process.exit(1);
  }

  // Get credentials from .env file
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;

  if (!email || !password) {
    console.error('❌ ERROR: Credentials not found!');
    console.error('Please edit drop-black-map-performance/.env and add your LOGIN_EMAIL and LOGIN_PASSWORD');
    process.exit(1);
  }

  const APP_URL = config.url || 'https://drop-black-dev.vercel.weather.com/';
  const APP_HOST = new URL(APP_URL).host;
  const phases = (config.phases || []).map((p, i) => ({ ...p, index: i, name: `Phase ${i + 1}` }));

  console.log('✅ Credentials loaded from .env file');
  console.log(`📧 Email: ${email}`);
  console.log(`🌐 App: ${APP_URL}`);
  console.log(`🖥️  Desk: ${config.desk || '(none configured — will skip desk selection)'}\n`);

  // Which layers have a model picker and the card id each model switches to,
  // written by `pnpm models`. Optional: without it, models are still picked by
  // button name, but the timebar can't find a layer whose model was switched.
  let LAYER_MODELS = {};
  try {
    LAYER_MODELS = JSON.parse(fs.readFileSync(path.join(__dirname, 'layer-models.json'), 'utf8')).layers || {};
  } catch (e) {
    if (config.model || (config.timebar && config.timebar.model)) {
      console.log('⚠️  layer-models.json not found — run `pnpm models` to record which layers have which models\n');
    }
  }

  // Performance metrics storage, one bucket per configured phase (by index).
  const phaseMetrics = phases.map(() => []);
  let currentPhase = null;
  let metricsInterval;
  let testFailed = false;

  // Label the background metrics sampler applies to each reading. Setup and
  // map-mode changes get their own labels so they aren't counted as movement.
  let currentActivity = 'Setup';

  // FPS is only meaningful while the map is actively being RE-RENDERED. request-
  // AnimationFrame reads ~60 on any visible-but-idle page, so samples taken while
  // nothing moves would inflate the average and hide real jank. These are the
  // labels where rendering is actively driven — by camera movement (pan/zoom) OR
  // by animating data (timeline playback). Samples with any other label get a
  // blank FPS (memory/CPU still use every sample). Must match ACTIVE_FPS_ACTIONS
  // in visualize_metrics.py.
  const ACTIVE_MOVEMENT_ACTIONS = new Set([
    'Panning and zooming',
    'Pan only (L/R)',
    'Zoom only (in/out)',
    'Timebar playback (static, US)',
  ]);
  function isActiveMovement(action) {
    return ACTIVE_MOVEMENT_ACTIONS.has(action);
  }

  // Isolated-interaction segments: periodically run a pan-only block then a
  // zoom-only block (each *_ONLY_MS long) to capture clean per-interaction FPS,
  // interleaved with the normal mixed stress activity (~50/50 split).
  const PAN_ONLY_MS = 15000;
  const ZOOM_ONLY_MS = 15000;
  const ISOLATED_BLOCK_MS = PAN_ONLY_MS + ZOOM_ONLY_MS;
  const MIXED_BETWEEN_MS = ISOLATED_BLOCK_MS;

  // Zoom band. Zooming out past MIN_ZOOM brings the poles into view (high-
  // latitude tile errors); MAX_ZOOM caps how deep the random zoom goes.
  const MIN_ZOOM = 4.5;
  const MAX_ZOOM = 9;

  // All run outputs (metrics + console errors + config snapshot + analysis PDF)
  // go into a per-day folder results/<YYYY-MM-DD>/.
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '').replace('T', '_');
  const runDate = timestamp.slice(0, 10);            // YYYY-MM-DD (UTC)
  const resultsDir = path.join(__dirname, 'results', runDate);
  fs.mkdirSync(resultsDir, { recursive: true });
  const csvFilePath = path.join(resultsDir, `performance_metrics_${timestamp}_UTC.csv`);

  fs.writeFileSync(csvFilePath, 'Timestamp,Elapsed_Seconds,Browser_Memory_Used,CPU_Percent,FPS,Action\n');

  // Run config + environment snapshot (read by the analysis PDF). Travels with
  // the results, since test-config.json may be overwritten by a later run.
  const configSnapshotPath = path.join(resultsDir, `performance_metrics_${timestamp}_UTC_config.json`);

  // For tab-memory measurement: identify this Chromium revision and snapshot any
  // pre-existing Chromium processes so we measure only the browser THIS run launches.
  const CHROMIUM_REV = (() => {
    try { return chromium.executablePath().match(/chromium-\d+/)?.[0] || null; }
    catch (e) { return null; }
  })();
  const chromiumPidsBeforeLaunch = new Set(listChromiumProcs().map(p => p.pid));

  const VIEWPORT = { width: 1718, height: 960 };
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: [
      // Stop Chromium throttling/pausing rendering when its window is minimized,
      // occluded, or on another desktop — otherwise the metrics become invalid.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`, // viewport + browser chrome
      '--window-position=0,0',
    ],
  });

  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const startTime = Date.now();

  // Capture machine + monitor specs and write the config snapshot.
  try {
    const cpus = os.cpus() || [];
    // Preliminary display capture; the authoritative read (incl. refresh rate)
    // happens at the END of the test on whatever monitor the window finished on.
    let display = {};
    try {
      display = await page.evaluate(() => ({
        screenWidth: screen.width,
        screenHeight: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        devicePixelRatio: window.devicePixelRatio,
        colorDepth: screen.colorDepth,
      }));
    } catch (e) { /* display stays {} */ }
    let browserVersion = '';
    try { browserVersion = browser.version(); } catch (e) { /* ignore */ }

    const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
    const osName = platformNames[os.platform()] || os.platform();
    const runEnvironment = {
      system: {
        os: `${osName} ${os.release()}`,
        arch: os.arch(),
        cpuModel: cpus[0] ? cpus[0].model : 'unknown',
        cpuCores: cpus.length,
        totalMemoryGB: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
        hostname: os.hostname(),
      },
      display,
      browser: browserVersion ? `Chromium ${browserVersion}` : 'Chromium',
      viewport: VIEWPORT,
      capturedAt: new Date().toISOString(),
    };

    fs.writeFileSync(configSnapshotPath,
      JSON.stringify({ ...config, _runEnvironment: runEnvironment }, null, 2));
    console.log(`📝 Saved run config + environment snapshot: ${path.basename(configSnapshotPath)}\n`);
  } catch (e) {
    try { fs.writeFileSync(configSnapshotPath, JSON.stringify(config, null, 2)); } catch (e2) { /* ignore */ }
    console.log(`⚠️  Could not capture run environment: ${e.message}\n`);
  }

  // Race a promise against a wall-clock timeout so a single hung operation can
  // never freeze the time-boxed phase loop. On timeout (or error) we resolve to
  // `fallback` and let the loop continue.
  function withTimeout(promise, ms, fallback = undefined) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([
      Promise.resolve(promise).then(
        (v) => { clearTimeout(timer); return v; },
        () => { clearTimeout(timer); return fallback; },
      ),
      timeout,
    ]);
  }

  // Console error capture — writes to a parallel CSV the visualizer picks up.
  const errorsFilePath = path.join(resultsDir, `console_errors_${timestamp}_UTC.csv`);
  fs.writeFileSync(errorsFilePath, 'Timestamp,Elapsed_Seconds,Type,Action,Message,URL\n');

  // Known-benign errors to suppress. Each entry may set any combination of
  // `type`, `messageIncludes`, `urlIncludes` — all set fields must match.
  const IGNORED_ERROR_PATTERNS = [
    // Tiles/requests cancelled mid-flight when panning fast or switching
    // projection/style. Expected behavior, not a real failure.
    { type: 'requestfailed', messageIncludes: 'net::ERR_ABORTED' },
    // Mapbox vector tiles that 404 or get aborted while zooming — the map
    // requests tiles that don't exist at a given zoom/region.
    { urlIncludes: '.vector.pbf' },
    { messageIncludes: '.vector.pbf' },
  ];

  function isIgnoredError(type, message, url) {
    for (const p of IGNORED_ERROR_PATTERNS) {
      if (p.type && p.type !== type) continue;
      if (p.messageIncludes && !String(message).includes(p.messageIncludes)) continue;
      if (p.urlIncludes && !String(url).includes(p.urlIncludes)) continue;
      return true;
    }
    return false;
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  let errorCount = 0;
  // Console-error capture is gated OFF until login completes, so the auth phase
  // doesn't pollute the results. Performance metrics are gated OFF until login +
  // desk selection are done, so setup noise doesn't skew the perf baseline.
  let errorCaptureEnabled = false;
  let metricsCaptureEnabled = false;
  function recordError(type, message, url) {
    if (!errorCaptureEnabled) return;
    if (isIgnoredError(type, message, url)) return;
    errorCount++;
    const ts = new Date().toISOString();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const rawAction = currentActivity || '';
    const action = /timebar/i.test(rawAction) ? 'timebar' : rawAction;
    const line = `${ts},${elapsed},${csvEscape(type)},${csvEscape(action)},${csvEscape(message)},${csvEscape(url)}\n`;
    fs.appendFileSync(errorsFilePath, line);
    const preview = message.length > 200 ? message.slice(0, 200) + '...' : message;
    console.log(`   ❌ [${type}] (${action || 'setup'}) ${preview}`);
  }

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const loc = msg.location();
      const locText = loc && loc.url ? ` (source: ${loc.url}:${loc.lineNumber || 0})` : '';
      recordError('console.error', msg.text() + locText, loc ? loc.url : '');
    }
  });

  page.on('pageerror', (error) => {
    recordError('pageerror', error.message, '');
  });

  // HTTP responses with 4xx/5xx status — captures failed API calls even when
  // the page doesn't log them via console.error
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      const req = response.request();
      const bucket = status >= 500 ? 'http_5xx' : 'http_4xx';
      recordError(bucket, `${req.method()} ${status} ${response.statusText()}`, response.url());
    }
  });

  // Network-level request failures (DNS error, aborted, blocked, etc)
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    const reason = failure ? failure.errorText : 'unknown';
    recordError('requestfailed', `${request.method()} (${reason})`, request.url());
  });

  // Function to get system-wide CPU usage (cross-platform)
  function getSystemCpuUsage() {
    try {
      const platform = os.platform();

      if (platform === 'darwin') {
        // Parse output like: "CPU usage: 15.38% user, 8.46% sys, 76.15% idle"
        const output = execSync('top -l 1 -n 0 -s 0 | grep "CPU usage"').toString();
        const match = output.match(/CPU usage: ([\d.]+)% user, ([\d.]+)% sys/);
        if (match) return (parseFloat(match[1]) + parseFloat(match[2])).toFixed(1);
      } else if (platform === 'win32') {
        // PowerShell + CIM (wmic is removed on newer Windows 10/11).
        const output = execSync(
          'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"'
        ).toString();
        const cpuLoad = parseFloat(output.trim());
        if (!isNaN(cpuLoad)) return cpuLoad.toFixed(1);
      } else if (platform === 'linux') {
        // Parse output like: "%Cpu(s):  5.2 us,  2.1 sy,  0.0 ni, 92.5 id, ..."
        const output = execSync('top -bn1 | grep "Cpu(s)"').toString();
        const match = output.match(/([\d.]+)\s+us,\s+([\d.]+)\s+sy/);
        if (match) return (parseFloat(match[1]) + parseFloat(match[2])).toFixed(1);
      }

      return 'N/A';
    } catch (error) {
      console.error('Error getting CPU usage:', error.message);
      return 'N/A';
    }
  }

  // List processes belonging to THIS Playwright Chromium revision (matched by the
  // "chromium-<rev>" segment of its path) along with their --type= (renderer,
  // gpu-process, utility, …; 'browser' for the main process).
  function listChromiumProcs() {
    if (!CHROMIUM_REV) return [];
    try {
      const platform = os.platform();
      const procs = [];
      if (platform === 'darwin' || platform === 'linux') {
        const out = execSync('ps -axww -o pid=,command=').toString(); // -ww: no truncation
        for (const line of out.split('\n')) {
          const m = line.trim().match(/^(\d+)\s+(.*)$/);
          if (m && m[2].includes(CHROMIUM_REV)) {
            const t = m[2].match(/--type=([\w-]+)/);
            procs.push({ pid: +m[1], type: t ? t[1] : 'browser' });
          }
        }
      } else if (platform === 'win32') {
        const out = execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"'
        ).toString();
        for (const line of out.split('\n')) {
          if (!line.includes(CHROMIUM_REV)) continue; // skips header + non-Chromium rows
          const pidMatch = line.match(/^"?(\d+)"?,/); // pid = first CSV field
          const pid = pidMatch ? parseInt(pidMatch[1], 10) : NaN;
          const t = line.match(/--type=([\w-]+)/);
          if (!isNaN(pid)) procs.push({ pid, type: t ? t[1] : 'browser' });
        }
      }
      return procs;
    } catch (e) {
      return [];
    }
  }

  // Private memory footprint of a single process, in MB (macOS phys_footprint /
  // Linux PSS / Windows private bytes). Unlike RSS, it does NOT double-count
  // Chromium's shared framework. Returns 0 if unreadable.
  function processMemoryMB(pid) {
    try {
      const platform = os.platform();
      if (platform === 'darwin') {
        const o = execSync(`/usr/bin/footprint -p ${pid} 2>/dev/null | grep -i phys_footprint | head -1`).toString();
        const mm = o.match(/([\d.]+)\s*(KB|MB|GB)/i);
        if (!mm) return 0;
        const v = parseFloat(mm[1]); const u = mm[2].toUpperCase();
        return u === 'GB' ? v * 1024 : u === 'KB' ? v / 1024 : v;
      } else if (platform === 'linux') {
        const o = execSync(`grep -i '^Pss:' /proc/${pid}/smaps_rollup 2>/dev/null`).toString();
        const mm = o.match(/Pss:\s*(\d+)\s*kB/i);
        return mm ? parseInt(mm[1], 10) / 1024 : 0;
      } else if (platform === 'win32') {
        const o = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).PrivateMemorySize64"`).toString().trim();
        const b = parseInt(o, 10);
        return isNaN(b) ? 0 : b / 1048576;
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // Memory of the page's RENDERER process(es) for THIS run — the figure Chrome
  // shows when you hover the tab. Returns MB, or null if it can't be read
  // (caller falls back to JS heap).
  function getRendererMemoryMB() {
    try {
      if (!CHROMIUM_REV) return null;
      const procs = listChromiumProcs()
        .filter(p => p.type === 'renderer' && !chromiumPidsBeforeLaunch.has(p.pid));
      if (procs.length === 0) return null;
      let total = 0;
      for (const p of procs) total += processMemoryMB(p.pid);
      return total > 0 ? total : null;
    } catch (e) {
      return null;
    }
  }

  // Format memory (MB to GB conversion when >= 1024 MB)
  function formatMemory(mb) {
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(2)} MB`;
  }

  // Collect one performance sample and append it to the CSV.
  async function collectMetrics(action = '') {
    if (!metricsCaptureEnabled) return;
    try {
      // FPS is only measured while the map is moving; idle rows get a blank FPS
      // so a misleading ~60 (idle vsync) value never appears in the data.
      const measureFps = isActiveMovement(action);
      const metrics = await page.evaluate((doFps) => {
        const memory = performance.memory;
        const jsHeapSize = memory ? memory.usedJSHeapSize / (1024 * 1024) : null;

        if (!doFps) return Promise.resolve({ jsHeapSize, fps: null });

        // Measure actual FPS using requestAnimationFrame over 1 second
        return new Promise((resolve) => {
          let frameCount = 0;
          const startTime = performance.now();
          function countFrames() {
            frameCount++;
            const elapsed = performance.now() - startTime;
            if (elapsed < 1000) {
              requestAnimationFrame(countFrames);
            } else {
              resolve({ jsHeapSize, fps: Math.round((frameCount / elapsed) * 1000) });
            }
          }
          requestAnimationFrame(countFrames);
        });
      }, measureFps);

      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const ts = new Date().toISOString();

      const cpuPercent = getSystemCpuUsage();
      const cpuValue = cpuPercent !== 'N/A' ? parseFloat(cpuPercent) : null;

      const rendererMem = getRendererMemoryMB();
      const memoryMB = (rendererMem != null) ? rendererMem : metrics.jsHeapSize;
      const memoryFormatted = formatMemory(memoryMB);
      const memSrc = (rendererMem != null) ? 'renderer' : 'jsheap';

      const fpsCell = (metrics.fps == null) ? '' : metrics.fps;
      const fpsDisplay = (metrics.fps == null) ? 'idle' : metrics.fps;

      // Quote+escape the action: some labels contain commas (e.g. "Timebar
      // playback (static, US)") which would otherwise split into extra columns.
      const safeAction = `"${String(action).replace(/"/g, '""')}"`;
      fs.appendFileSync(csvFilePath, `${ts},${elapsedSeconds},${memoryFormatted},${cpuPercent},${fpsCell},${safeAction}\n`);

      console.log(`📊 [${elapsedSeconds}s] Memory: ${memoryFormatted} (${memSrc}) | CPU: ${cpuPercent}% | FPS: ${fpsDisplay} | Action: ${action}`);

      if (currentPhase !== null && cpuValue !== null) {
        phaseMetrics[currentPhase].push({
          memory: memoryMB,
          cpu: cpuValue,
          fps: metrics.fps,
          fpsActive: isActiveMovement(action),
        });
      }

      return metrics;
    } catch (error) {
      console.error('Error collecting metrics:', error.message);
    }
  }

  function calculateStats(values) {
    if (values.length === 0) return { mean: 0, median: 0, min: 0, max: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((acc, val) => acc + val, 0) / values.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    return { mean, median, min: sorted[0], max: sorted[sorted.length - 1] };
  }

  // Display phase statistics and write them to the CSV. The "<name> STATISTICS"
  // marker row is what visualize_metrics.py uses to split the run into phases.
  function displayPhaseStats(phaseName, phaseIndex) {
    const data = phaseMetrics[phaseIndex];

    if (data.length === 0) {
      console.log(`\n⚠️  No metrics collected for ${phaseName}\n`);
      return;
    }

    const memoryValues = data.map(d => d.memory);
    const cpuValues = data.map(d => d.cpu);
    // FPS only from active-movement samples. Fall back to all samples if a phase
    // somehow recorded none, so we never report a spurious 0.
    const activeFps = data.filter(d => d.fpsActive && d.fps != null).map(d => d.fps);
    const fpsValues = activeFps.length > 0 ? activeFps : data.map(d => d.fps).filter(v => v != null);

    const memoryStats = calculateStats(memoryValues);
    const cpuStats = calculateStats(cpuValues);
    const fpsStats = calculateStats(fpsValues);

    console.log('\n' + '='.repeat(60));
    console.log(`📊 ${phaseName} STATISTICS`);
    console.log('='.repeat(60));
    console.log(`📈 Samples collected: ${data.length}`);
    console.log('');
    console.log('💾 MEMORY (tab MB):');
    console.log(`   Mean:   ${memoryStats.mean.toFixed(2)} MB`);
    console.log(`   Median: ${memoryStats.median.toFixed(2)} MB`);
    console.log(`   Min:    ${memoryStats.min.toFixed(2)} MB`);
    console.log(`   Max:    ${memoryStats.max.toFixed(2)} MB`);
    console.log('');
    console.log('⚡ CPU (%):');
    console.log(`   Mean:   ${cpuStats.mean.toFixed(1)}%`);
    console.log(`   Median: ${cpuStats.median.toFixed(1)}%`);
    console.log(`   Min:    ${cpuStats.min.toFixed(1)}%`);
    console.log(`   Max:    ${cpuStats.max.toFixed(1)}%`);
    console.log('');
    console.log(`🎮 FPS (${fpsValues.length} active-movement samples; idle excluded):`);
    console.log(`   Mean:   ${fpsStats.mean.toFixed(0)}`);
    console.log(`   Median: ${fpsStats.median.toFixed(0)}`);
    console.log(`   Min:    ${fpsStats.min.toFixed(0)}`);
    console.log(`   Max:    ${fpsStats.max.toFixed(0)}`);
    console.log('='.repeat(60) + '\n');

    const ts = new Date().toISOString();
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);

    fs.appendFileSync(csvFilePath, '\n');
    fs.appendFileSync(csvFilePath, `${ts},${elapsedSeconds},,,,"${phaseName} STATISTICS (${data.length} samples)"\n`);
    fs.appendFileSync(csvFilePath, `${ts},${elapsedSeconds},${memoryStats.mean.toFixed(2)},${cpuStats.mean.toFixed(1)},${fpsStats.mean.toFixed(0)},"${phaseName} - Mean"\n`);
    fs.appendFileSync(csvFilePath, `${ts},${elapsedSeconds},${memoryStats.median.toFixed(2)},${cpuStats.median.toFixed(1)},${fpsStats.median.toFixed(0)},"${phaseName} - Median"\n`);
    fs.appendFileSync(csvFilePath, `${ts},${elapsedSeconds},${memoryStats.min.toFixed(2)},${cpuStats.min.toFixed(1)},${fpsStats.min.toFixed(0)},"${phaseName} - Min"\n`);
    fs.appendFileSync(csvFilePath, `${ts},${elapsedSeconds},${memoryStats.max.toFixed(2)},${cpuStats.max.toFixed(1)},${fpsStats.max.toFixed(0)},"${phaseName} - Max"\n`);
    fs.appendFileSync(csvFilePath, '\n');
  }

  // Read the map's center + zoom from the Pangea viewport on window.wxmap:
  // geoCenter has _latitude/_longitude, zoom is zoomLevel. Falls back to the
  // underlying Mapbox engine's getCenter()/getZoom() if Pangea ever changes.
  let _mapReadDiagnosed = false;
  async function readMapState() {
    const state = await page.evaluate(() => {
      try {
        const w = window.wxmap;
        if (!w) return null;
        let lat = null, lon = null, zoom = null;
        const g = w.geoCenter;
        if (g && typeof g._latitude === 'number') {
          lat = g._latitude;
          lon = g._longitude;
          zoom = w.zoomLevel;
        } else if (w.engine && typeof w.engine.getCenter === 'function') {
          const c = w.engine.getCenter();
          lat = c.lat;
          lon = c.lng;
          zoom = w.engine.getZoom();
        }
        if (typeof lat !== 'number' || Number.isNaN(lat)) return null;
        return { lat, lon, zoom: typeof zoom === 'number' ? zoom : 5 };
      } catch (e) {
        return null;
      }
    }).catch(() => null);
    if (!_mapReadDiagnosed) {
      _mapReadDiagnosed = true;
      if (state) {
        console.log(`   🛰️  Map state read OK: lat=${state.lat.toFixed(2)}, lon=${state.lon.toFixed(2)}, zoom=${state.zoom.toFixed(2)} — pole prevention active`);
      } else {
        console.log('   ⚠️  Could not read map state — pole prevention disabled this run');
      }
    }
    return state;
  }

  // Latitude band for pole prevention. POLE_TRIGGER is where we start steering
  // back; POLE_SAFE is how far back we steer before resuming. The gap between
  // them is the hysteresis that stops the camera ping-ponging at the boundary.
  const POLE_TRIGGER = 60;
  const POLE_SAFE = 45;

  // The Mapbox canvas spans the whole map area, but UI floats on top of it: the
  // mission panel (left), the map button column + layer menu (right), and the
  // timeline / bottom drawer (bottom). Random drags landing on those would click
  // UI instead of panning, so shrink the box to the clear map area in between.
  const UI_MARGIN = 12;
  async function getPannableBox() {
    return page.evaluate((margin) => {
      const canvas = document.querySelector('canvas.mapboxgl-canvas');
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
      const midX = (left + right) / 2;
      const visibleRect = (el) => {
        if (!el || el.closest('[inert]')) return null;
        const b = el.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return null;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return null;
        return b;
      };
      const mission = visibleRect(document.querySelector('[data-testid="mission-panel"]'));
      if (mission && mission.right > left && mission.right < midX) left = mission.right + margin;
      // Right-hand map buttons (overlay toggles, zoom, layer menu). The collapse-
      // mission-panel button is also a map button, but it sits on the left.
      for (const btn of document.querySelectorAll('[data-testid="bedrock-map-button"]')) {
        const b = visibleRect(btn);
        if (b && b.left > midX) right = Math.min(right, b.left - margin);
        else if (b && b.right < midX) left = Math.max(left, b.right + margin);
      }
      const menu = visibleRect(document.querySelector('[data-testid="bedrock-map-layer-card-menu"]'));
      if (menu && menu.left > midX && menu.left < right) right = menu.left - margin;
      for (const sel of ['[data-testid="bedrock-map-timeline"]', '[data-testid="bottom-drawer"]']) {
        const b = visibleRect(document.querySelector(sel));
        if (b && b.top > top && b.top < bottom) bottom = Math.min(bottom, b.top - margin);
      }
      if (right - left < 100 || bottom - top < 100) {
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      }
      return { x: left, y: top, width: right - left, height: bottom - top };
    }, UI_MARGIN).catch(() => null);
  }

  // Random map pan (with pole prevention)
  async function randomPan() {
    const box = await getPannableBox();
    if (!box) return;
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;

    let center = await readMapState();

    // Hysteresis recovery: if we've drifted into the pole zone (>60°), steer
    // decisively back until we're comfortably at mid-latitudes (<45°).
    if (center && Math.abs(center.lat) > POLE_TRIGGER) {
      console.log(`   ⚠️  Near pole (lat: ${center.lat.toFixed(1)}°) - steering back to mid-latitudes`);
      let guard = 0;
      while (center && Math.abs(center.lat) > POLE_SAFE && guard < 10) {
        // Cursor drag is OPPOSITE the camera: drag toward the pole to move the
        // camera toward the equator.
        const panDirection = center.lat > 0 ? 1 : -1;
        const endX = midX + (Math.random() - 0.5) * box.width * 0.2;
        const endY = midY - (panDirection * box.height * 0.35);
        await page.mouse.move(midX, midY);
        await page.mouse.down();
        await page.mouse.move(endX, endY, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        center = await readMapState();
        guard++;
      }
      if (center) console.log(`   ✅ Recovered to lat ${center.lat.toFixed(1)}°`);
      return; // this call's job was recovery; the next call resumes normal panning
    }

    const startX = box.x + Math.random() * box.width;
    const startY = box.y + Math.random() * box.height;
    const endX = box.x + Math.random() * box.width;
    let endY = box.y + Math.random() * box.height;

    // Once already somewhat poleward (>35°), don't let the random drag head
    // FURTHER toward the nearer pole. Dragging DOWN moves the camera NORTH,
    // dragging UP moves it SOUTH.
    if (center && Math.abs(center.lat) > 35) {
      if (center.lat > 0 && endY > startY) endY = box.y + Math.random() * (startY - box.y);
      else if (center.lat < 0 && endY < startY) endY = startY + Math.random() * (box.y + box.height - startY);
    }

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
  }

  // Random zoom (bounded to [MIN_ZOOM, MAX_ZOOM], with pole prevention)
  async function randomZoom() {
    const box = await getPannableBox();
    if (!box) return;

    const mapState = await readMapState();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const nearPoles = mapState && Math.abs(mapState.lat) > POLE_TRIGGER;
    const zoom = mapState ? mapState.zoom : null;
    const atFloor = zoom != null && zoom <= MIN_ZOOM;
    const atCeiling = zoom != null && zoom >= MAX_ZOOM;

    if (atFloor) {
      console.log(`   🔭 At zoom floor (${zoom.toFixed(1)}) — zooming in to keep poles out of view`);
      await page.mouse.wheel(0, -100);
    } else if (atCeiling) {
      console.log(`   🔭 At zoom ceiling (${zoom.toFixed(1)}) — zooming out`);
      await page.mouse.wheel(0, 100);
    } else if (nearPoles) {
      // Zoom IN to shrink the visible high-latitude area; randomPan steers back.
      console.log(`   ⚠️  Near pole (lat: ${mapState.lat.toFixed(1)}°) - zooming in; pan will steer back`);
      await page.mouse.wheel(0, -100);
    } else {
      await page.mouse.wheel(0, Math.random() > 0.5 ? -100 : 100);
    }
  }

  // Isolated PAN-ONLY segment: drag the map left↔right for durationMs while the
  // background sampler labels readings "Pan only (L/R)", giving clean pan FPS.
  // Horizontal drags only change longitude, so this never approaches the poles.
  async function panLeftRightSegment(durationMs) {
    const box = await getPannableBox();
    if (!box) return;
    const prev = currentActivity;
    currentActivity = 'Pan only (L/R)';
    console.log(`   ↔️  Pan-only segment (${durationMs / 1000}s)...`);
    try {
      const endTime = Date.now() + durationMs;
      const cy = box.y + box.height / 2;
      const leftX = box.x + box.width * 0.25;
      const rightX = box.x + box.width * 0.75;
      let goRight = true;
      while (Date.now() < endTime) {
        await page.mouse.move(goRight ? leftX : rightX, cy);
        await page.mouse.down();
        await page.mouse.move(goRight ? rightX : leftX, cy, { steps: 10 });
        await page.mouse.up();
        goRight = !goRight;
        await page.waitForTimeout(150);
      }
    } finally {
      // Restore even if abandoned early (its withTimeout guard fired) so later
      // samples aren't mislabeled.
      currentActivity = prev;
    }
  }

  // Isolated ZOOM-ONLY segment: oscillate zoom within [MIN_ZOOM, MAX_ZOOM] at the
  // map center for durationMs while readings are labeled "Zoom only (in/out)".
  async function zoomInOutSegment(durationMs) {
    const box = await getPannableBox();
    if (!box) return;
    const prev = currentActivity;
    currentActivity = 'Zoom only (in/out)';
    console.log(`   🔍 Zoom-only segment (${durationMs / 1000}s)...`);
    try {
      const endTime = Date.now() + durationMs;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      let dir = 'in';
      while (Date.now() < endTime) {
        const st = await readMapState();
        const z = st ? st.zoom : null;
        if (z != null) {
          if (z <= MIN_ZOOM) dir = 'in';
          else if (z >= MAX_ZOOM) dir = 'out';
        }
        await page.mouse.wheel(0, dir === 'in' ? -120 : 120);
        await page.waitForTimeout(150);
      }
    } finally {
      currentActivity = prev;
    }
  }

  // ---------------------------------------------------------------------------
  // Drop Black UI helpers. Every toggle in Drop Black reports its state through
  // aria-pressed, so we read it before clicking and only click when it differs.
  // ---------------------------------------------------------------------------

  // Toggle a button whose aria-pressed reflects on/off. Returns 'toggled',
  // 'already', or false (not found / couldn't confirm).
  async function setPressed(locator, want, attempts = 5) {
    if (!(await locator.count())) return false;
    let toggled = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      const pressed = await locator.getAttribute('aria-pressed', { timeout: 10000 }).catch(() => null);
      if (pressed === String(want)) return toggled ? 'toggled' : 'already';
      if (pressed !== null) {
        await locator.click({ timeout: 5000 }).catch(() => {});
        toggled = true;
      }
      await page.waitForTimeout(1200);
    }
    return false;
  }

  async function setLayerMenuOpen(want) {
    return setPressed(page.getByRole('button', { name: 'Layer menu', exact: true }), want);
  }

  // The layer menu has two tabs. Layers-tab cards are mutually exclusive (one
  // raster layer at a time); Overlays-tab cards toggle independently.
  async function showLayerTab(tab) {
    await page.getByTestId(`bedrock-map-layer-card-menu-tab-${tab}`).click({ timeout: 10000 });
    await page.waitForTimeout(800);
  }

  function layerCardButton(id) {
    return page.locator(`[data-testid="layer-card-${id}"] button.bedrock-map-layer-card-item`).first();
  }

  async function layerCardName(id) {
    const name = await page.locator(`[data-testid="layer-card-${id}"] .bedrock-map-layer-card-item-name`)
      .first().textContent({ timeout: 2000 }).catch(() => null);
    return (name || id).trim();
  }

  // Card ids available on the currently shown tab — printed when a configured
  // id doesn't exist, so a typo in test-config.json is easy to fix.
  async function availableCardIds() {
    return page.evaluate(() => [...document.querySelectorAll('[data-testid^="layer-card-"]')]
      .map(e => e.getAttribute('data-testid').replace('layer-card-', ''))).catch(() => []);
  }

  async function setLayerCard(id, want) {
    const name = await layerCardName(id);
    console.log(`📍 Configuring ${name}...`);
    const btn = layerCardButton(id);
    if (!(await btn.count())) {
      console.log(`❌ Unknown layer id "${id}" — not on this tab. Available: ${(await availableCardIds()).join(', ')}\n`);
      return false;
    }
    const res = await setPressed(btn, want);
    if (res === 'toggled') {
      await collectMetrics(`${name} ${want ? 'enabled' : 'disabled'}`);
      console.log(`✅ ${name} ${want ? 'enabled' : 'disabled'}\n`);
    } else if (res === 'already') {
      console.log(`✅ ${name} already ${want ? 'enabled' : 'disabled'} — not touched\n`);
    } else {
      console.log(`❌ ${name}: could NOT confirm it reached ${want ? 'ON' : 'OFF'}. The run continues, but VERIFY this layer.\n`);
    }
    return res;
  }

  const activeCardIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="layer-card-"] button.bedrock-map-layer-card-item[aria-pressed="true"]')]
    .map(b => b.closest('[data-testid^="layer-card-"]').getAttribute('data-testid').replace('layer-card-', '')));

  // Picking a model swaps the card's id (WindSpeedGraf → WindSpeedHrrr), so a
  // configured id may not be on the page after an earlier switch. Fall back to
  // whichever id of the same layer (per layer-models.json) is there now.
  async function resolveCardId(id) {
    if (await page.locator(`[data-testid="layer-card-${id}"]`).count()) return id;
    const family = familyOf(id);
    if (!family) return id;
    for (const alt of [family[0], ...Object.values(family[1].models || {})]) {
      if (alt && await page.locator(`[data-testid="layer-card-${alt}"]`).count()) return alt;
    }
    return id;
  }

  // Click a model (FOD / GRAF / HRRR / ECMWF / GFS) in the picker the layer shows
  // on the map. The picker's buttons carry the layer name as `title`, so a picker
  // left over from another layer is never used. Never throws; a model that isn't
  // offered right now is logged and the layer stays on its default.
  const MODEL_PICKER = '[role="group"][aria-label="Model"]';
  const familyOf = (id) => Object.entries(LAYER_MODELS).find(([base, e]) => base === id || Object.values(e.models || {}).includes(id));

  async function selectModel(cardId, model) {
    const name = await layerCardName(cardId);
    const family = familyOf(cardId);
    const names = [name, family && family[1].name].filter(Boolean).map(n => n.toLowerCase());
    const result = { layer: cardId, requested: model, applied: null, available: [] };
    let picker = null;
    for (let waited = 0; waited < 12000 && !picker; waited += 500) {
      picker = await page.evaluate(({ sel, names }) => {
        const g = document.querySelector(sel);
        const btns = g ? [...g.querySelectorAll('button')] : [];
        if (!btns.length || !names.includes((btns[0].getAttribute('title') || '').trim().toLowerCase())) return null;
        return { models: btns.map(b => b.textContent.trim()), pressed: btns.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()) };
      }, { sel: MODEL_PICKER, names }).catch(() => null);
      if (!picker) await page.waitForTimeout(500);
    }
    if (!picker) {
      console.log(`⚠️  ${name} has no model picker — model "${model}" ignored\n`);
      return result;
    }
    result.available = picker.models;
    const match = picker.models.find(m => m.toLowerCase() === String(model).toLowerCase());
    if (!match) {
      result.applied = picker.pressed[0] || null;
      console.log(`⚠️  ${name}: model "${model}" isn't offered right now (available: ${picker.models.join(', ')}) — keeping ${result.applied}\n`);
      return result;
    }
    console.log(`📍 Setting ${name} model to ${match}...`);
    const res = await setPressed(page.locator(MODEL_PICKER).getByRole('button', { name: match, exact: true }), true);
    if (res) {
      result.applied = match;
      result.layer = (await activeCardIds())[0] || cardId;
      if (res === 'toggled') await collectMetrics(`${name} model ${match}`);
      console.log(`✅ ${name} model ${res === 'already' ? 'already ' : ''}${match}${result.layer !== cardId ? ` (card is now ${result.layer})` : ''}\n`);
    } else {
      console.log(`❌ ${name}: could NOT confirm model ${match}. The run continues, but VERIFY the model.\n`);
    }
    return result;
  }

  // What each step actually ran with (main layer + timebar), saved into the
  // config snapshot so the PDF shows the model used — not just the one asked for.
  const appliedModels = {};
  function recordAppliedModel(step, result) {
    appliedModels[step] = result;
    try {
      const snap = JSON.parse(fs.readFileSync(configSnapshotPath, 'utf8'));
      snap._appliedModels = appliedModels;
      fs.writeFileSync(configSnapshotPath, JSON.stringify(snap, null, 2));
    } catch (e) { /* snapshot not written yet / unreadable — the console log still has it */ }
  }

  // Select the single Layers-tab layer (or turn whichever one is on OFF when
  // id is null), then its model if one is given (null keeps the app default).
  // Returns the model result, or null when no model was asked for.
  // Leaves the layer menu open — callers close it.
  async function selectMainLayer(id, model) {
    await showLayerTab('layers');
    if (id) {
      const cardId = await resolveCardId(id);
      if (!(await setLayerCard(cardId, true))) return null;
      // No model asked for, but an earlier step switched this layer off its
      // default (the card id moved) — put it back on the default.
      if (!model && cardId !== id && LAYER_MODELS[id]) model = LAYER_MODELS[id].default;
      return model ? selectModel(cardId, model) : null;
    }
    if (model) console.log(`⚠️  Model "${model}" ignored — no layer configured\n`);
    const onIds = await activeCardIds();
    for (const onId of onIds) await setLayerCard(onId, false);
    if (!onIds.length) console.log('✅ No Layers-tab layer configured — none on\n');
    return null;
  }

  // Close a few things that can sit over the map after login: the API-key prompt
  // ("Not now") and the mission panel on the left.
  async function clearMapObstructions() {
    const notNow = page.getByRole('button', { name: 'Not now', exact: true });
    if (await notNow.isVisible().catch(() => false)) {
      await notNow.click().catch(() => {});
      console.log('   ✅ Dismissed "Not now" prompt');
    }
    const collapse = page.getByRole('button', { name: 'Collapse mission panel', exact: true });
    if (await collapse.isVisible().catch(() => false)) {
      await collapse.click().catch(() => {});
      await page.waitForTimeout(800);
      console.log('   ✅ Mission panel collapsed');
    }
  }

  // The open Settings panel puts a full-screen overlay button over everything
  // (including the gear), so clicking the gear to close it times out. Escape
  // closes it; the overlay itself is the fallback. Verified closed afterwards —
  // a panel left open blocks the layer menu and swallows the first map drag.
  async function closeSettings() {
    const isOpen = () => page.locator('aside[aria-label="Settings"]').isVisible().catch(() => false);
    for (let attempt = 0; attempt < 3 && await isOpen(); attempt++) {
      if (attempt === 0) await page.keyboard.press('Escape').catch(() => {});
      else await page.getByRole('button', { name: 'Close settings panel', exact: true })
        .click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    if (await isOpen()) console.log('   ⚠️  Settings panel did not close');
  }

  // Projection + basemap style live under Settings → Map as native <select>s
  // (#map-projection: Globe/Mercator, #map-style: Default/Dark/Satellite).
  async function setMapMode(projection, style) {
    console.log(`\n📍 Setting map to ${projection}/${style}...\n`);
    const prevActivity = currentActivity;
    currentActivity = 'Changing map mode';
    try {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click({ timeout: 10000 });
      await page.waitForTimeout(800);
      await page.getByText('Map', { exact: true }).click({ timeout: 10000 });
      const proj = page.locator('#map-projection');
      await proj.waitFor({ state: 'visible', timeout: 10000 });
      await proj.selectOption({ label: projection });
      await page.waitForTimeout(1500);
      await page.locator('#map-style').selectOption({ label: style });
      await page.waitForTimeout(2500);
      const now = await page.evaluate(() => ({
        projection: document.querySelector('#map-projection')?.selectedOptions[0]?.textContent,
        style: document.querySelector('#map-style')?.selectedOptions[0]?.textContent,
      }));
      await closeSettings();
      if (now.projection !== projection || now.style !== style) {
        console.log(`⚠️  Map mode reads ${now.projection}/${now.style} (wanted ${projection}/${style})\n`);
      }
      await collectMetrics(`Set to ${projection}/${style}`);
      console.log(`✅ Map set to ${projection}/${style}\n`);
    } catch (e) {
      console.log(`⚠️  Could not set map mode ${projection}/${style}: ${e.message}\n`);
      await closeSettings();
    } finally {
      currentActivity = prevActivity;
    }
  }

  // Center on the continental US, zoomed out so the whole US is in view, via the
  // Pangea viewport's own API (works in Globe and Mercator). GeoPoint takes
  // (longitude, latitude).
  async function centerOnUSZoomedOut() {
    const US_CENTER = { lat: 39.5, lon: -98.35 };
    const ok = await page.evaluate(({ lat, lon, z }) => {
      try {
        const w = window.wxmap;
        const GeoPoint = w.geoCenter.constructor;
        w.center(new GeoPoint(lon, lat));
        w.zoom(z);
        return true;
      } catch (e) { return false; }
    }, { ...US_CENTER, z: MIN_ZOOM }).catch(() => false);
    await page.waitForTimeout(1500);
    const s = await readMapState();
    if (ok && s) {
      console.log(`   ✅ Map centered on US (lat ${s.lat.toFixed(1)}, lon ${s.lon.toFixed(1)}, zoom ${s.zoom.toFixed(1)})`);
    } else {
      console.log('   ⚠️  Could not center map on the US via the map API');
    }
  }

  // Timeline play/pause. The play button's aria-label names the NEXT action
  // ("Play" while stopped), so we only click when it's in the opposite state.
  async function setTimelinePlaying(want) {
    const btn = page.getByTestId('play-button');
    const label = await btn.getAttribute('aria-label', { timeout: 5000 }).catch(() => null);
    if (label === null) {
      console.log('   ⚠️  Timeline play button not found');
      return;
    }
    const playing = label !== 'Play';
    if (playing !== want) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    const after = await btn.getAttribute('aria-label').catch(() => '?');
    console.log(`   ✅ Timeline ${want ? 'playing' : 'stopped'} (button now "${after}")`);
  }

  // Standalone Timebar segment — runs at the END of the test, after all pan/zoom
  // phases. Uses the projection/style of the chosen phase, puts the chosen layer
  // on, centers on the US and holds the map STATIC while the timeline animates
  // the layer — the animating frames are the rendering load.
  async function runTimebarSegment(duration, projection, style, layerId, model) {
    console.log(`\n🛰️  Timebar segment (${projection}/${style}) — separate ${duration / 60000} min block, map held static over the US.\n`);
    const prevActivity = currentActivity;
    await setMapMode(projection, style);
    if (layerId) {
      try {
        await setLayerMenuOpen(true);
        const res = await selectMainLayer(layerId, model);
        if (res) recordAppliedModel('timebar', res);
      } catch (e) {
        console.log(`   ⚠️  Could not set timebar layer "${layerId}": ${e.message.split('\n')[0]}`);
      }
      await setLayerMenuOpen(false);
    } else {
      console.log('   ⚠️  No timebar layer and no main layer configured — the timeline has nothing to animate');
    }
    await centerOnUSZoomedOut();
    await setTimelinePlaying(true);
    currentActivity = 'Timebar playback (static, US)';
    const endTime = Date.now() + duration;
    let iter = 0;
    while (Date.now() < endTime) {
      iter++;
      if (iter % 20 === 0) {
        console.log(`⏱️  Timebar segment (static) | ${Math.floor((endTime - Date.now()) / 1000)}s remaining`);
      }
      await page.waitForTimeout(500);
    }
    currentActivity = prevActivity;
    await setTimelinePlaying(false);
    console.log(`\n✅ Timebar segment complete (${projection}/${style})\n`);
  }

  // One pan/zoom stress phase: mixed random pans + zooms, with isolated pan-only
  // and zoom-only blocks interleaved for a ~50/50 split.
  async function stressTestPhase(phaseName, duration, projection, style) {
    console.log(`\n🔴 ${phaseName}: ${projection}/${style} (${duration / 60000} minutes)\n`);
    console.log('Performing continuous random panning and zooming...\n');

    const phaseEndTime = Date.now() + duration;
    let iterationCount = 0;
    currentActivity = 'Panning and zooming';

    // Short warm-up of mixed activity, then alternate isolated blocks and mixed
    // gaps of equal length.
    let nextIsolatedTime = Date.now() + 20000;

    while (Date.now() < phaseEndTime) {
      iterationCount++;

      if (Date.now() >= nextIsolatedTime) {
        await withTimeout(panLeftRightSegment(PAN_ONLY_MS), PAN_ONLY_MS + 15000);
        await withTimeout(zoomInOutSegment(ZOOM_ONLY_MS), ZOOM_ONLY_MS + 15000);
        nextIsolatedTime = Date.now() + MIXED_BETWEEN_MS;
      }

      // 5 random pans + 3 random zooms, each guarded so a hung synthetic input
      // (seen when the tile pipeline is saturated) can't freeze the phase.
      for (let i = 0; i < 5; i++) {
        await withTimeout(randomPan(), 15000);
        await page.waitForTimeout(200);
      }
      for (let i = 0; i < 3; i++) {
        await withTimeout(randomZoom(), 15000);
        await page.waitForTimeout(200);
      }

      if (iterationCount % 10 === 0) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = Math.floor((phaseEndTime - Date.now()) / 1000);
        console.log(`⏱️  [${elapsed}s] ${phaseName} iteration ${iterationCount} | ${remaining}s remaining`);
      }

      await page.waitForTimeout(500);
    }

    currentActivity = 'Between phases';
    console.log(`\n✅ ${phaseName} Complete\n`);
    return iterationCount;
  }

  try {
    // ============================================
    // SETUP: LOGIN, DESK, LAYERS
    // ============================================
    console.log('\n🔵 Setup: Login and Setup\n');

    // Step 1: The app redirects to the Drop account login (email → Continue →
    // password → Sign in). Wait for 'domcontentloaded' rather than 'load' — the
    // app keeps connections open that can delay 'load'.
    console.log('📍 Step 1: Navigating to Drop Black...');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    console.log(`✅ Page loaded (${page.url()})\n`);

    console.log('📍 Step 2: Entering email...');
    const emailField = page.locator('input[type="email"]').first();
    await emailField.waitFor({ state: 'visible', timeout: 60000 });
    await emailField.fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    console.log('✅ Email entered, Continue clicked\n');

    console.log('📍 Step 3: Entering password...');
    const passwordField = page.locator('input[type="password"]').first();
    try {
      await passwordField.waitFor({ state: 'visible', timeout: 60000 });
    } catch (e) {
      const msg = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '');
      throw new Error(`Password field never appeared — is the email right for Drop Black? Page says: ${msg.replace(/\s+/g, ' ')}`);
    }
    await passwordField.fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    console.log('✅ Sign in clicked\n');

    console.log('📍 Step 4: Waiting for login to complete and the map to load...');
    await page.waitForURL((u) => u.host === APP_HOST, { timeout: 120000, waitUntil: 'commit' });
    await page.waitForFunction(() => window.wxmap && document.querySelector('canvas.mapboxgl-canvas'), null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    console.log('✅ Login successful — map loaded\n');

    errorCaptureEnabled = true;
    console.log('🟢 Console-error capture enabled (post-login)\n');

    // Step 5: Optional desk. Desks add saved locations/routes to the map; with no
    // desk configured we skip it (baseline map only).
    if (config.desk) {
      console.log(`📍 Step 5: Selecting "${config.desk}" desk...`);
      try {
        await page.getByRole('button', { name: 'Select desk', exact: true }).first().click();
        await page.waitForTimeout(1500);
        const deskOption = page.getByText(config.desk, { exact: true }).first();
        await deskOption.waitFor({ state: 'visible', timeout: 20000 });
        await deskOption.click();
        await page.waitForTimeout(2000);
        const closeSelector = page.getByRole('button', { name: 'Close desk selector', exact: true });
        if (await closeSelector.isVisible().catch(() => false)) await closeSelector.click().catch(() => {});
        console.log(`✅ ${config.desk} desk selected\n`);
      } catch (error) {
        console.error(`\n❌ Error selecting desk "${config.desk}": ${error.message}`);
        console.error('💡 Check the desk name in test-config.json matches exactly (case-sensitive) and that this account can see it.');
        console.error('\n⚠️  Keeping browser open for 30 seconds so you can inspect the desk list...');
        await page.waitForTimeout(30000);
        throw error;
      }
    } else {
      console.log('📍 Step 5: No desk configured — skipping desk selection\n');
    }

    metricsCaptureEnabled = true;
    console.log('🟢 Performance metrics capture enabled (post-desk-selection)');
    await collectMetrics(config.desk ? 'Desk selected' : 'No desk selected (baseline)');

    // Step 6: Clear anything sitting over the map.
    console.log('📍 Step 6: Clearing panels that block the map...');
    await clearMapObstructions();
    await collectMetrics('Panel closed');
    console.log('');

    // Step 7: Layers from test-config.json — one Layers-tab layer + any overlays.
    console.log('📍 Step 7: Configuring layers from test-config.json...\n');
    if (await setLayerMenuOpen(true)) {
      try {
        const res = await selectMainLayer(config.layer || null, config.model || null);
        if (res) recordAppliedModel('layer', res);

        const overlays = config.overlays || {};
        if (Object.keys(overlays).length) {
          await showLayerTab('overlays');
          for (const [id, want] of Object.entries(overlays)) {
            await setLayerCard(id, !!want);
          }
        }
      } catch (e) {
        console.log(`❌ Layer configuration stopped early — VERIFY layers. ${e.message.split('\n')[0]}\n`);
      }

      await setLayerMenuOpen(false);
      console.log('✅ Layer menu closed\n');
    } else {
      console.log('❌ Could not open the Layer menu — layers NOT configured. The run continues.\n');
    }
    console.log('✅ Layer configuration complete - baseline metrics collected\n');

    // Background metrics collection every 5 seconds
    metricsInterval = setInterval(async () => {
      await collectMetrics(currentActivity);
    }, 5000);

    // ============================================
    // PHASE EXECUTION (controlled by test-config.json)
    // ============================================
    const tb = config.timebar || {};
    if (tb.enabled) {
      console.log(`\n📍 Timebar segment will run at the END, using Phase ${tb.phase}'s projection/style\n`);
    }

    const iterations = phases.map(() => 0);
    for (const phase of phases) {
      if (!phase.enabled) {
        console.log(`\n⏭️  Skipping ${phase.name} (disabled in config)\n`);
        continue;
      }
      currentPhase = phase.index;
      await setMapMode(phase.projection, phase.style);
      iterations[phase.index] = await stressTestPhase(phase.name, config.phaseDuration, phase.projection, phase.style);
      displayPhaseStats(`${phase.name}: ${phase.projection}/${phase.style}`, phase.index);
    }

    // Timebar segment — runs LAST. Borrows the chosen phase's projection/style;
    // that phase must be enabled (so its pan/zoom ran earlier in the test).
    if (tb.enabled) {
      const phase = phases[(tb.phase || 1) - 1];
      if (phase && phase.enabled) {
        currentPhase = phase.index;
        // A separate timebar layer uses its own model; otherwise it's the main layer + model.
        await runTimebarSegment(config.phaseDuration, phase.projection, phase.style,
          tb.layer || config.layer, tb.layer ? (tb.model || null) : (config.model || null));
      } else {
        console.log(`\n⏭️  Skipping Timebar segment — its phase (Phase ${tb.phase}) is not enabled.\n`);
      }
    }

    clearInterval(metricsInterval);

    console.log('\n✅ All Phases Complete - Performance testing finished\n');

    // ============================================
    // FINAL METRICS AND SUMMARY
    // ============================================
    console.log('\n📊 Collecting final metrics...\n');
    await collectMetrics('Test complete');

    // Capture the display the test actually ran on — done HERE (not at startup)
    // so the operator can move the window to another monitor during the run, and
    // so the refresh-rate reading happens while idle and reaches the native rate.
    try {
      const finalDisplay = await page.evaluate(async () => {
        const info = {
          screenWidth: screen.width,
          screenHeight: screen.height,
          availWidth: screen.availWidth,
          availHeight: screen.availHeight,
          devicePixelRatio: window.devicePixelRatio,
          colorDepth: screen.colorDepth,
        };
        // Refresh rate = max renderable FPS: count animation frames over ~1s.
        info.refreshRateHz = await new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = (now) => {
            frames++;
            const elapsed = now - start;
            if (elapsed >= 1000) resolve(Math.round((frames * 1000) / elapsed));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return info;
      });
      const snap = JSON.parse(fs.readFileSync(configSnapshotPath, 'utf8'));
      if (snap._runEnvironment) {
        snap._runEnvironment.display = finalDisplay;
        fs.writeFileSync(configSnapshotPath, JSON.stringify(snap, null, 2));
      }
      console.log(`📺 Display captured: ${finalDisplay.screenWidth}×${finalDisplay.screenHeight} @ ${finalDisplay.refreshRateHz} Hz (max ~${finalDisplay.refreshRateHz} FPS)\n`);
    } catch (e) {
      console.log(`⚠️  Could not capture final display specs: ${e.message}\n`);
    }

    const totalElapsed = Math.floor((Date.now() - startTime) / 1000);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 PERFORMANCE TEST COMPLETE!');
    console.log('='.repeat(60));
    console.log(`⏱️  Total Duration: ${Math.floor(totalElapsed / 60)}m ${totalElapsed % 60}s`);
    console.log('📊 Metrics collected and saved to:');
    console.log(`   ${csvFilePath}`);
    console.log('='.repeat(60) + '\n');

    console.log('📈 Test Summary:');
    console.log('   - Setup: Login and layer setup');
    for (const phase of phases) {
      console.log(`   - ${phase.name}: ${phase.projection}/${phase.style} - ${phase.enabled ? `${iterations[phase.index]} iterations` : 'skipped'}`);
    }
    console.log('');

    console.log('Keeping browser open for 10 seconds so you can see the final state...');
    await page.waitForTimeout(10000);

  } catch (error) {
    testFailed = true;
    console.error('\n❌ TEST FAILED!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);

    // Save error to CSV, sanitized so embedded quotes/newlines don't break parsing.
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const ts = new Date().toISOString();
    const safeMsg = `Test failed: ${error.message}`.replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
    fs.appendFileSync(csvFilePath, `${ts},${elapsedSeconds},ERROR,ERROR,ERROR,"${safeMsg}"\n`);
  } finally {
    if (metricsInterval) clearInterval(metricsInterval);

    console.log('\n🔚 Closing browser...');
    // Headed Chromium sometimes hangs on close after heavy rendering. Cap it so
    // the close can't block the results/PDF step.
    await Promise.race([
      (async () => {
        try { await context.close(); } catch (e) { /* ignore */ }
        try { await browser.close(); } catch (e) { /* ignore */ }
      })(),
      new Promise((resolve) => setTimeout(resolve, 15000)),
    ]);
    console.log('✅ Browser closed');
    console.log(`\n📁 Performance metrics saved to: ${csvFilePath}`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} console error(s) captured to: ${errorsFilePath}\n`);
    } else {
      console.log(`✅ No console errors captured (file: ${errorsFilePath})\n`);
    }

    // Generate the analysis PDF. Detect an available Python command so this
    // works cross-platform (Windows usually has `py`/`python`).
    console.log('📊 Generating performance visualizations...\n');
    const pythonCandidates = os.platform() === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python'];
    let pythonCmd = null;
    for (const cand of pythonCandidates) {
      try {
        execSync(`${cand} --version`, { stdio: 'ignore' });
        pythonCmd = cand;
        break;
      } catch (e) { /* not this one — try the next */ }
    }

    try {
      const visualizeScript = path.join(__dirname, 'visualize_metrics.py');
      if (!pythonCmd) {
        throw new Error(`No Python interpreter found (tried: ${pythonCandidates.join(', ')})`);
      }
      console.log(`Running: ${pythonCmd} visualize_metrics.py...`);
      execSync(`${pythonCmd} "${visualizeScript}" "${csvFilePath}"`, { stdio: 'inherit', cwd: __dirname });
      console.log(`\n✅ Visualizations generated: ${csvFilePath.replace('.csv', '_analysis.pdf')}\n`);
    } catch (error) {
      console.log('\n⚠️  Could not automatically generate visualizations');
      console.log('   You can manually run: pnpm visualize ' + path.relative(__dirname, csvFilePath));
      console.log('   Error:', error.message, '\n');
    }

    // Force a clean exit — a headed browser that didn't close cleanly can keep
    // Node alive indefinitely even though all our work is done.
    console.log('👋 Done.');
    process.exit(testFailed ? 1 : 0);
  }
})();
