const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// .env may set PORT (per machine — .env isn't committed) alongside the login.
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Config builder server for the Drop Black performance test. Defaults to its own
// port (3020) so it never fights the Maverick map-performance servers (3000 for
// this repo, 3010 for the nevetest copy). Pick another port, highest priority first:
//   pnpm start 3030          (just this run)
//   PORT=3030 pnpm start     (just this run)
//   PORT=3030 in .env        (every run on this machine)
const DEFAULT_PORT = 3020;
const RESERVED_PORTS = { 3000: 'the map-performance server', 3010: 'the nevetest map-performance server' };

function resolvePort() {
  const sources = [
    ['command line', process.argv[2]],
    ['PORT', process.env.PORT],
  ];
  for (const [source, raw] of sources) {
    if (raw === undefined || raw === '') continue;
    const port = Number(String(raw).replace(/^--port=/, ''));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      console.error(`\n❌ Invalid port "${raw}" (from ${source}). Use a whole number between 1024 and 65535, e.g. pnpm start 3030\n`);
      process.exit(1);
    }
    return port;
  }
  return DEFAULT_PORT;
}

const PORT = resolvePort();
const configPath = path.join(__dirname, 'test-config.json');
const testPath = path.join(__dirname, 'drop_black_performance_test.js');

const { createAuth, readConfig } = require('./auth');

const app = express();
const auth = createAuth(readConfig());
// Everything below sits behind Okta sign-in (set AUTH_DISABLED=true for local use only).
app.get('/auth/login', auth.login);
app.get('/auth/callback', auth.callback);
app.post('/auth/logout', auth.logout);
app.use(auth.requireAuth);
app.get('/api/me', auth.me);
app.use(express.json());

// Only the builder page is served — not the folder, which holds .env.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'config-builder.html'));
});

// Which layers offer which models (written by `pnpm models`). Empty when the
// file hasn't been generated yet — the builder then shows no model choices.
app.get('/api/layer-models', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, 'layer-models.json'), 'utf8')));
  } catch (error) {
    res.json({ layers: {}, missing: true });
  }
});

app.post('/api/save-config', (req, res) => {
  try {
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2) + '\n');
    res.json({ success: true, message: 'Config saved successfully!', path: configPath });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// One run at a time — two headed browsers would skew each other's metrics.
let running = null;

app.get('/api/status', (req, res) => {
  res.json({ running: !!running, pid: running ? running.pid : null });
});

app.post('/api/run-test', (req, res) => {
  if (running) {
    return res.status(409).json({ success: false, error: `A test is already running (pid ${running.pid}). Wait for it to finish.` });
  }
  try {
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2) + '\n');

    console.log('\n' + '='.repeat(60));
    console.log('🚀 Starting Drop Black performance test...');
    console.log(`📁 Config saved to: ${configPath}`);
    console.log(`▶️  Running: node "${testPath}"`);
    console.log('='.repeat(60) + '\n');

    const child = spawn('node', [testPath], {
      cwd: __dirname,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, FORCE_COLOR: '1', PYTHONUNBUFFERED: '1' },
    });
    running = child;

    child.on('close', (code) => {
      running = null;
      console.log('\n' + '='.repeat(60));
      console.log(`✅ Test process exited with code ${code}`);
      console.log('='.repeat(60) + '\n');
    });

    child.on('error', (error) => {
      running = null;
      console.error(`❌ Error running test: ${error.message}`);
    });

    res.json({ success: true, message: 'Test started! Check the server terminal for progress.', pid: child.pid });
  } catch (error) {
    console.error('❌ Error in /api/run-test:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Best-effort git branch label so you can tell which copy you're driving.
function gitBranch(dir) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return '(not a git repo)';
  }
}

const server = app.listen(PORT, () => {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 Drop Black Performance Test Server');
  console.log('='.repeat(70));
  console.log(`✅ URL:        http://localhost:${PORT}`);
  if (RESERVED_PORTS[PORT]) {
    console.log(`⚠️  Port ${PORT} is normally used by ${RESERVED_PORTS[PORT]} — make sure you open the right one.`);
  }
  console.log(`📁 Folder:     ${__dirname}`);
  console.log(`🌿 Git branch: ${gitBranch(__dirname)}`);
  console.log(`💾 Output dir: ${path.join(__dirname, 'results')}`);
  console.log('\n📋 Instructions:');
  console.log(`   1. Open in browser: http://localhost:${PORT}`);
  console.log('   2. Configure your test in the web interface');
  console.log('   3. Click "Run Test"');
  console.log('   4. Watch the test run IN THIS terminal');
  console.log('\n⚠️  Keep this terminal open while using the server (Ctrl+C to stop)');
  console.log('='.repeat(70) + '\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use${RESERVED_PORTS[PORT] ? ` (normally ${RESERVED_PORTS[PORT]})` : ' — another server is probably running there'}.`);
    console.error(`   Stop it first (Ctrl+C in its terminal), or pick another port: pnpm start ${PORT + 1}`);
    console.error(`   To always use a port on this machine, add PORT=${PORT + 1} to drop-black-map-performance/.env\n`);
    process.exit(1);
  }
  throw err;
});
