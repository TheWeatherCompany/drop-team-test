# Drop Black Map Performance Test 🗺️

A Playwright stress test for the Drop Black map (https://drop-black-dev.vercel.weather.com).
It logs in, turns on the layers you choose, then pans and zooms the map for a set time
in each map mode while recording memory, CPU and FPS. At the end it writes a CSV and
a multi-page PDF report.

It's a port of the Maverick test in `../map-performance/`, with the same metrics,
results format and PDF, minus the airport visits. The two folders are independent.

## 📋 Contents

- [Project files](#-project-files)
- [Prerequisites](#-prerequisites)
- [Quick start](#-quick-start)
- [Using the config builder](#-using-the-config-builder)
- [What the test does](#-what-the-test-does)
- [Editing test-config.json by hand](#-editing-test-configjson-by-hand)
- [Understanding the results](#-understanding-the-results)
- [Troubleshooting](#-troubleshooting)
- [Layer and overlay IDs](#-layer-and-overlay-ids)
- [Forecast models](#-forecast-models)

---

## 📁 Project files

| File | What it is |
|---|---|
| `drop_black_performance_test.js` | The test itself |
| `test-config.json` | What the next run will do (layers, phases, duration…) |
| `server.js` + `config-builder.html` | The browser config builder (`pnpm start`) |
| `visualize_metrics.py` | Turns a run's CSV into the PDF report (runs automatically) |
| `discover_models.js` + `layer-models.json` | Which layers offer which forecast models (`pnpm models`, see [Forecast models](#-forecast-models)) |
| `.env.example` | Blank login template. Copy it to `.env` (see [Prerequisites](#-prerequisites)) |
| `.env` | Your Drop Black login (and optional port) |
| `results/<YYYY-MM-DD>/` | Every run's output, grouped by day |

---

## 🔧 Prerequisites

Install these once.

1. **Node.js** 16.13 or newer. Download from https://nodejs.org/ and check with `node --version`.

2. **pnpm**. This project uses pnpm, not npm:
   ```bash
   corepack enable
   ```
   (or `npm install -g pnpm`). Check with `pnpm --version`.

3. **Packages and the Chromium browser**, from this folder:
   ```bash
   pnpm install
   pnpm exec playwright install chromium
   ```
   You need **both** commands. `pnpm install` doesn't download a browser. Browsers go
   in a machine-wide cache, so if you've already done this for `map-performance` or
   `e2e-loadtest` (same Playwright version), the second command just says it's present.

4. **Python 3 and the report packages**. Without these, the test still runs, but you
   get no PDF:
   ```bash
   pip3 install -r requirements.txt
   ```
   On Windows use `pip install -r requirements.txt` or `py -m pip install -r requirements.txt`.

5. **A Drop Black login** in a file named `.env` in this folder. Copy the blank template,
   then fill in your login:
   ```bash
   cp .env.example .env
   ```
   Then open `.env` and fill in the two fields:
   ```env
   LOGIN_EMAIL=your.drop.black.login@example.com
   LOGIN_PASSWORD=your_password_here
   ```
   ⚠️ Drop Black uses its **own accounts** (`drop-acct-dev.weather.com`). A Maverick
   login won't work here; you'll get "No account was found for that email".

---

## 🚀 Quick start

```bash
cd drop-black-map-performance
pnpm start
```

Open the URL the terminal prints (http://localhost:3020 by default), pick your layers
and phases, and click **🚀 Run test**. A Chromium window opens and drives the map by
itself. Progress prints in the terminal where you ran `pnpm start`. When it finishes,
the PDF is in `results/<today>/`.

**Leave the Chromium window alone while it runs.** You can move it or cover it with
other windows, but don't click or scroll in it, because that would mix your input into the
measurements. A default run (4 phases × 5 min) takes about 22 minutes.

---

## 🌐 Using the config builder

### Starting the server

```bash
pnpm start
```

The terminal prints the address to open, http://localhost:3020 by default. Stop the
server with **Ctrl+C**.

### Using a different localhost (if 3020 is taken)

Only one program can use a port at a time. If something already has 3020, you'll see:

```
❌ Port 3020 is already in use — another server is probably running there.
   Stop it first (Ctrl+C in its terminal), or pick another port: pnpm start 3021
```

You have three options:

1. **Use another port for this run.** Put the port number after `pnpm start`:
   ```bash
   pnpm start 3021
   ```
   Then open **http://localhost:3021**. Any number from 1024 to 65535 works.

2. **Always use your own port on this machine.** Add a line to your `.env`, next to your login:
   ```env
   PORT=3021
   ```
   After that, plain `pnpm start` uses 3021 every time. Because everyone has their own `.env`,
   each teammate can choose a different port without clashing.

3. **Free up 3020.** It's usually an earlier `pnpm start` still running in another
   terminal; press Ctrl+C there. To find what's using the port:
   - macOS/Linux: `lsof -nP -iTCP:3020 -sTCP:LISTEN`
   - Windows (PowerShell): `Get-NetTCPConnection -LocalPort 3020 | Select-Object OwningProcess`

If you set more than one, `pnpm start <port>` wins over `PORT` in `.env`. Avoid **3000** and
**3010**, which the Maverick map-performance servers use; the server warns you if you pick
one of them.

### The form

The page always opens with the default settings. To start from a past config, use
**📂 Load config file**.

| Section | What to set |
|---|---|
| **Run** | App URL (dev by default), desk name (leave blank to skip), and minutes per phase |
| **Layer (Layers tab)** | **One** layer from Drop Black's Layers tab. Drop Black only allows one at a time. Layers that offer a forecast model show their models in brackets, e.g. `Temperature [FOD / GRAF / HRRR / ECMWF]`, and a **Model** dropdown appears listing only that layer's models. |
| **Overlays (Overlays tab)** | Any number of overlays (Lightning, Airports, SIGMETs…). Use **All on** or **All off** for quick changes. |
| **Phases** | Turn each phase on or off and choose its projection (Globe/Mercator) and style (Default/Dark/Satellite). You can add or remove phases. |
| **Timebar** | Optional extra segment at the end that plays the timeline (see below). If you pick a separate layer to animate, it gets its own **Model** dropdown. |

The estimate next to the buttons shows roughly how long the run will take.

### Buttons

| Button | What it does |
|---|---|
| 💾 **Save config** | Writes the form to `test-config.json` |
| 🚀 **Run test** | Saves, then starts the test. It's disabled while a test is running, so only one runs at a time. |
| 📂 **Load config file** | Fills the form from a `.json` file. Use a downloaded config, or a past run's `results/<date>/…_config.json` to repeat that run exactly. It only fills the form, so click Save or Run to use it. |
| ⬇️ **Download JSON** | Saves the form as a file you can keep or share |

The page won't save a config that can't run, such as one with no phases enabled or
the timebar pointed at a disabled phase. It tells you what to fix instead.

---

## 🧪 What the test does

1. **Logs in** with your `.env` login, then selects the desk if one is set.
2. **Clears the map**: it collapses the left mission panel and dismisses prompts.
3. **Sets layers**: it opens the layer menu, picks the Layers-tab layer (and its
   model, if one is set), and sets each overlay on or off. It reads each layer's current state first and only clicks
   the ones that need to change. Metrics start recording here.
4. **Runs each enabled phase** for the phase duration:
   - It sets the projection and style in Settings → Map.
   - It runs random pans and zooms, alternating with **15 s pan-only** (left/right)
     and **15 s zoom-only** (in/out) blocks, about half the time each. That gives clean
     FPS for each kind of interaction.
   - Zoom stays between 4.5 and 9, and the map is steered away from the poles so
     far-north or far-south tile errors don't skew the results.
   - It writes the phase's statistics at the end of the phase.
5. **Timebar segment (optional)** runs after all phases. It switches to the chosen
   phase's map mode, puts the layer on, centers on the US, and **presses Play** on
   the timeline. The map stays still for one phase duration while the layer animates.
6. **Writes the results and builds the PDF**.

A sample is taken **every 5 seconds**. FPS is only measured while the map is moving
(pan, zoom or timeline playback). Other samples leave FPS blank, so idle time doesn't
inflate the average.

---

## ✏️ Editing test-config.json by hand

The config builder is optional. You can edit `test-config.json` and run `pnpm test`.

```json
{
  "url": "https://drop-black-dev.vercel.weather.com/",
  "desk": null,
  "layer": "TemperatureFod",
  "model": "ECMWF",
  "overlays": { "Lightning": true, "Airports": false },
  "phases": [
    { "enabled": true, "projection": "Globe", "style": "Satellite" },
    { "enabled": true, "projection": "Mercator", "style": "Dark" }
  ],
  "phaseDuration": 300000,
  "timebar": { "enabled": false, "phase": 1, "layer": null, "model": null }
}
```

| Field | Meaning |
|---|---|
| `url` | App URL |
| `desk` | Desk name exactly as shown in the desk picker (case-sensitive), e.g. `"Test2"`, or `null` to skip |
| `layer` | One [Layers-tab ID](#layers-tab-pick-one), or `null` for none |
| `model` | Forecast model for `layer` (`FOD`, `GRAF`, `HRRR`, `ECMWF` or `GFS`), or `null` for the app's default. Only [some layers](#-forecast-models) have models. |
| `overlays` | [Overlay ID](#overlays-tab) set to `true` or `false`. Overlays you leave out aren't touched. |
| `phases` | List of `{ enabled, projection, style }`. Projection is `Globe` or `Mercator`; style is `Default`, `Dark` or `Satellite`. |
| `phaseDuration` | Milliseconds per phase (300000 = 5 min) |
| `timebar.enabled` | Run the timeline segment at the end |
| `timebar.phase` | Which phase's projection and style to use (1 = first). That phase must be enabled. |
| `timebar.layer` | Layer to animate. `null` uses the main `layer` and its `model`. |
| `timebar.model` | Model for `timebar.layer`, or `null` for the app's default. Ignored when `timebar.layer` is `null`. |

If an ID is misspelled, the run logs every valid ID for that tab and carries on.

---

## 📊 Understanding the results

Each run writes four files to `results/<YYYY-MM-DD>/`, all sharing one timestamp:

| File | Contents |
|---|---|
| `performance_metrics_<ts>_UTC.csv` | One row per sample: time, memory, CPU, FPS and what the test was doing (`Action`), plus a statistics block after each phase |
| `performance_metrics_<ts>_UTC_config.json` | The exact config used, plus the machine, monitor and refresh-rate details |
| `console_errors_<ts>_UTC.csv` | App errors captured after login: console errors, page errors, HTTP 4xx/5xx and failed requests |
| `performance_metrics_<ts>_UTC_analysis.pdf` | The report: summary, config, memory, CPU, FPS, memory growth, phase comparisons, FPS by interaction type, the timebar (if it ran) and errors |

To rebuild a PDF from a CSV:
```bash
pnpm visualize results/<date>/performance_metrics_<ts>_UTC.csv
```

### The metrics

- **Memory**: the tab's own memory, which is the figure Chrome's Task Manager shows for
  the tab. Each terminal line is tagged `(renderer)` or, if that couldn't be read,
  `(jsheap)`.
- **CPU**: whole-system CPU, not just the browser.
- **FPS**: frames per second while the map is moving. The ceiling is your monitor's
  refresh rate (the PDF shows it). For example, about 120 on a 120 Hz screen is the maximum.

### What to look for

- **Memory climbing steadily** across phases instead of rising and falling points to a leak.
- **FPS falling well below the refresh rate**, or getting worse over time, means rendering is struggling.
- **CPU staying at 80–100%** for long stretches is a problem.
- **Repeated errors** in `console_errors_…csv` or on the PDF's last page are worth
  investigating. Cancelled requests from fast panning are filtered out as expected noise.

For reference, a run on 2026-10-19 with Radar alone (4 × 5 min, Apple M-series, 122 Hz)
showed about 2–2.4 GB average memory, about 20% CPU and about 120 FPS in every phase,
with no errors.

### Terminal exit codes

- `exited with code 0` ✅ means the test completed.
- `exited with code 1` ❌ means the test hit a problem. Look for `❌ TEST FAILED!` above it.
  The CSV gets an `ERROR` row, and a PDF is still made from whatever was collected.
- `exited with code 130` means it was stopped with Ctrl+C.

---

## 🔍 Troubleshooting

**"Port 3020 is already in use"**
Something else already has that localhost, often an earlier `pnpm start` you forgot
about. Run `pnpm start 3021` and open http://localhost:3021, or see
[Using a different localhost](#using-a-different-localhost-if-3020-is-taken) to set your
own port permanently or free up 3020.

**"Password field never appeared" or "No account was found for that email"**
The email in `.env` isn't a Drop Black account. Maverick logins don't work here.

**"Credentials not found"**
`.env` is missing, or isn't in this folder. It must sit next to `drop_black_performance_test.js`.

**Browser won't launch or the executable doesn't exist**
Run `pnpm exec playwright install chromium`.

**No PDF at the end**
Python or its packages are missing. Run `pip3 install -r requirements.txt`, then use
`pnpm visualize …` on the CSV.

**"Could not find desk"**
The desk name must match the desk picker exactly, including capitals, and your account
must be able to see that desk.

**"model … isn't offered right now" or "has no model picker"**
That layer doesn't offer the model you picked (or any model) at the moment. The run
continues on the layer's default model, and the PDF config page says "not applied".
Run `pnpm models` to refresh the list, then pick again in the config builder.

**A layer shows "could NOT confirm"
The run continues, but check that layer in the PDF's config page and the terminal. The
layer menu may have changed. The IDs come from `data-testid="layer-card-<id>"` in the app.

**Can't see this folder in VS Code**
If your VS Code window only shows `map-performance`, use File → Add Folder to
Workspace… and pick `drop-black-map-performance`.

**Known app issue**
Drop Black once threw `Cannot read properties of undefined (reading '_isPreloading')`
when switching from Mercator to Globe. If it shows up in your errors, it's coming from
the app, not the test.

---

## 🏷️ Layer and overlay IDs

These are the values for `layer`, `timebar.layer` and `overlays` when editing the JSON by
hand. The config builder shows the friendly names instead.

### Overlays tab

Windstream, Isobars, Lightning, StormCells (Storm tracks), Fronts, GovtAlerts, Airports,
SigmetsGovernment, SigmetsTwc, Airspace, AIRMETs, FPGs, PIREPs, SignificantWx,
VolcanicAsh, SOFARBuoys, CmanBuoys, ShipReports, WeatherStations, NHCTropicalForecast,
TWCTropicalForecast, Wildfires

### Layers tab (pick one)

| Group | IDs |
|---|---|
| Radar | Radar, SingleSiteRadar, ConvectiveOutlook, EchoTopsRadar, ObservedIceAccumulation, ObservedPrecipAccumulation, ObservedSnowAccumulation, Shear, SnowDepthObserved, VIL |
| Satellite | SatVisible, SatIR, SatIRColor, SatWaterVapor |
| Precip | PrecipTypeRadarGraf, PrecipAccumulationGraf, CompositeReflectivityHrrr, HailzoneDrop, IceAccumulationGraf, LightningForecast30MinDrop, LightningDensityEcmwf, SnowAccumulationGraf, SnowDepthEcmwf |
| Wind | WindSpeedGraf, WindGustGraf, GeopotentialHeightEcmwf, MslPressureGraf |
| Clouds and aviation | VisibilityGraf, CloudCoverGraf, Turbulence, CeilingGraf, ConvectiveInhibitionHrrr, EchoTopsGraf, FreezingAltitude, HiwcDrop, IcingPotentialFlightLevelsDrop, MixedLayerCapeDrop, MostUnstableCapeEcmwf, PrecipitableWaterEcmwf, SurfaceCapeEcmwf |
| Temperature | TemperatureFod, DewPointDrop, FeelsLikeDrop, RelativeHumidityGraf, SpecificHumidityPressureEcmwf, UvIndexDrop |
| Maritime | SeaStateBeaufortGfs, CurrentLabCurrents, ObservedSurfaceOceanTempContour, WindSpeedGfs, WavesTotalGfs, SeaIceThicknessEcmwf, SeaSurfaceHeightEcmwf, SeaSurfaceTemperatureGfs, SignificantWaveHeightProbabilityEcmwf, WavesSwellGfs, WavesWindGfs, SeaStateWmoGfs |
| Air quality | BreathingIndexDrop, MosquitoIndexDrop, NearSurfaceSmokeHrrr, PollenIndexDrop, VerticallyIntegratedSmokeHrrr |
| Soil | SurfaceSolarRadiationEcmwf, RunoffEcmwf, SoilMoistureEcmwf, SoilTemperatureEcmwf |

Layer settings (the slider button on cards like Turbulence or Temperature) aren't
configurable yet. Each layer runs with its default settings.

---

## 🌦️ Forecast models

Some Layers-tab layers show a model picker on the map (the FOD / GRAF / HRRR / ECMWF
buttons next to the legend), and each layer offers a different set. Set `model` (and
`timebar.model`) to choose one; leave it `null` to keep the app's default.

As of 2026-10-20 on dev, these 12 layers offer a model (default first). Every other layer
has a single source.

| Layer | ID | Models |
|---|---|---|
| Temperature | TemperatureFod | FOD, GRAF, HRRR, ECMWF |
| Feels like temperature | FeelsLikeDrop | FOD, ECMWF |
| Dew point | DewPointDrop | FOD, ECMWF |
| Relative humidity | RelativeHumidityGraf | GRAF, HRRR |
| Precip type | PrecipTypeRadarGraf | GRAF, HRRR, ECMWF |
| Precipitation accumulation | PrecipAccumulationGraf | FOD, HRRR, ECMWF |
| Snow accumulation | SnowAccumulationGraf | FOD, HRRR, ECMWF |
| Ice accumulation | IceAccumulationGraf | FOD, ECMWF |
| Wind speed | WindSpeedGraf | GRAF, HRRR, ECMWF |
| Wind gust | WindGustGraf | FOD, HRRR, ECMWF |
| Cloud cover | CloudCoverGraf | GRAF, HRRR, ECMWF |
| Visibility | VisibilityGraf | GRAF, ECMWF, GFS |

Always use the ID in this table for `layer`, whatever model you pick. Choosing a model
changes the layer's ID inside the app (for example `WindSpeedGraf` becomes `WindSpeedHrrr`
on HRRR), and the test handles that itself. Model choices don't survive a page reload,
so every run starts from the defaults.

⚠️ **A model choice applies to every layer, not just one.** In Drop Black, picking ECMWF on
Temperature also switches Wind speed, Cloud cover and every other layer that offers
ECMWF; layers without ECMWF stay as they were. This matters when the timebar animates a
different layer than the main one: if you leave `timebar.model` as `null`, the test puts
that layer back on its own default instead of leaving it on the main layer's model.

### Refreshing the list

Drop Black adds and removes models over time. To re-check:

```bash
pnpm models          # uses the url in test-config.json
pnpm models <url>    # another environment
```

A Chromium window opens, logs in with your `.env` login, turns on each layer in turn and
records its models (about 15 minutes, so leave the window alone). It writes
`layer-models.json`, which the config builder reads for its Model dropdowns, and it puts
every layer back on its default model when it's done. Update the table above if the list
changes.

If you choose a model a layer doesn't offer on the day, the test logs a warning, keeps
the default, and the PDF's config page shows "not applied". The run doesn't fail.
