# Revela

Free, open-source photo catalog & digital darkroom for Windows (and later macOS/Linux).
An Adobe Lightroom alternative with first-class support for **analog film workflows**:
negative-to-positive conversion, dust & scratch removal, non-destructive editing.

Inspired by [Concat](https://github.com/jub0t/Concat) (open-source CapCut replacement):
a native Rust engine, everything local, no account, no subscription.

## Features (MVP)

- **Library** — import folders, SQLite catalog, ratings (1–5), pick/reject flags, colour
  labels (6–9), tags, text search, sorting, filters
- **Non-destructive develop** — edits are stored as a JSON "recipe" in the catalog; originals are never touched; undo (Ctrl+Z), before/after (`\`)
- **RAW support** — CR2/CR3, NEF, ARW, DNG, RAF, ORF, RW2 and more via [rawler](https://github.com/dnglab/dnglab) (pure Rust)
- **Editing** — white balance (sliders + eyedropper), exposure, contrast, highlights/shadows, whites/blacks, auto tone, vibrance/saturation, clarity, sharpening, noise reduction, vignette, film grain, parametric tone curve, crop with aspect ratios, rotate/flip/straighten with auto-crop and alignment grid, zoom & pan
- **Negative → positive** — density-based inversion (log space) with automatic film-base detection or manual eyedropper, per-channel range normalization, red/blue balance trim — works for C-41 colour and B&W negatives, both scanner TIFFs and DSLR "camera scans" (RAW)
- **Dust removal** — heal spots and drag streaks: pattern-matched clone with colour correction, edge-aware fallback for blemishes on contrast boundaries
- **Roll workflow** — presets + copy/paste settings across a selection (Ctrl+Shift+C/V), incl. shared film base
- **Export** — JPEG/PNG with quality and max-size options
- **100 % local** — no telemetry, no cloud

## Installation (users)

No runtimes needed — WebView2 ships with Windows 10/11.

- **Installer** — download `Revela_x.y.z_x64-setup.exe` from GitHub Releases and
  double-click. (Releases are built automatically by `.github/workflows/release.yml`
  whenever a `v*` tag is pushed.)
- **Portable** — `revela.exe` from a build's `src-tauri/target/release/` runs
  standalone; copy it anywhere and start it. Catalog data lives in `%APPDATA%/dev.revela.app`.

Windows SmartScreen may warn about an unknown publisher until the binary is
code-signed — choose *More info → Run anyway*.

## Reporting bugs

- **UI crash** — the app shows a crash screen: press *Copy report* and paste it
  into a GitHub issue along with what you were doing.
- **Failed operations** show up as red toasts (bottom right); the exact backend
  errors are also appended to `%APPDATA%\dev.revela.app\revela.log` — attach that
  file to the issue.
- Include the file type that triggered the problem (camera model for RAWs,
  scanner + bit depth for TIFF scans) and ideally a sample file.

### Releasing a new version (maintainer)

```powershell
npm run release -- 0.2.0
```

Bumps the version everywhere, commits, tags `v0.2.0` and pushes; GitHub Actions
builds the installer and attaches it to a draft Release — just publish it.

**No git installed?** Works from the web UI too: upload the changed files
(*Add file → Upload files*), bump `version` in `package.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` via the web editor, then
*Releases → Draft a new release → Create new tag `vX.Y.Z`* — publishing the tag
triggers the same build. For one-off test builds use *Actions → Release →
Run workflow* and download the installer from the run's artifacts.

Everything below is only needed to **build from source**.

## Tech stack

| Layer | Tech |
|---|---|
| App shell | [Tauri 2](https://tauri.app) (WebView2 on Windows, ~10 MB app) |
| Engine | Rust: `rawler` (RAW decode), `image`, `rayon` (parallel CPU pipeline), `rusqlite` (catalog) |
| UI | React 18 + TypeScript + Vite + zustand |

The image pipeline works on linear-light `f32` RGB buffers and is parallelized with
rayon. Previews are rendered at ≤2560 px and cached; exports re-run the same recipe
at full resolution.

## Getting started on a fresh Windows PC

Copy the project folder (everything except `node_modules/`, `dist/` and
`src-tauri/target/` — those are regenerated) or clone the repo, then run the
bootstrap script from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

It checks for and installs (via winget) everything the build needs, then runs
`npm install`. After it finishes:

```powershell
npm run tauri dev    # run in development mode
npm run tauri build  # produce installer (NSIS) in src-tauri/target/release/bundle
```

First compile takes a while (rawler + SQLite are built from source); subsequent
builds are incremental. App icons are already generated in `src-tauri/icons/`
(re-create anytime with `npm run icons` — the script has no dependencies).

### Manual prerequisites (if you skip the script)

1. **Rust** — install [rustup](https://rustup.rs) (stable-msvc toolchain)
2. **Visual Studio Build Tools** — workload *"Desktop development with C++"*
   (required by the MSVC linker and bundled SQLite)
3. **Node.js** ≥ 20 + npm, then `npm install`
4. WebView2 Runtime — already part of Windows 11 / current Windows 10

## Project layout

```
revela/
├─ src/                  React UI (library grid, develop view, panels, curve editor)
├─ src-tauri/
│  ├─ src/
│  │  ├─ catalog.rs      SQLite catalog (photos, folders, tags, recipes)
│  │  ├─ commands.rs     Tauri IPC commands
│  │  ├─ thumbs.rs       thumbnail generation
│  │  └─ engine/         image engine
│  │     ├─ decode.rs    RAW (rawler) + JPEG/TIFF/PNG decode, EXIF orientation
│  │     ├─ pipeline.rs  edit recipe + tone pipeline
│  │     ├─ negative.rs  film negative inversion (density based)
│  │     ├─ retouch.rs   dust-spot healing (feathered clone)
│  │     ├─ geometry.rs  rotate / flip / straighten / crop
│  │     ├─ curve.rs     monotone-cubic tone curve → LUT
│  │     └─ histogram.rs
│  └─ tauri.conf.json
└─ scripts/gen-icons.mjs dependency-free PNG/ICO icon generator
```

## Roadmap

- [ ] XMP sidecar export, catalog backup
- [ ] 16-bit TIFF export, ICC-aware color management
- [ ] GPU pipeline (wgpu compute) for full-size real-time previews
- [ ] Local adjustments (masks, gradients), AI dust detection
- [ ] Batch negative conversion with roll-wide film base
- [ ] Tethering / import from card with presets

## License

GPL-3.0-or-later. Add the full GPL text as `LICENSE` before publishing the repository.
