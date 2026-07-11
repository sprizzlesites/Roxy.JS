# Roxy.JS — Full Suite Orchestration Plan

**Branch:** `fullsuite` · **Goal owner:** the orchestrating agent (currently Fable 5; this doc lets ANY agent take over).

## 0. What this project is

Expand Roxy.JS from a single-file 3D modeling app into a **full HTML-based 3D modeling + rigging + animation suite** with feature parity to Blender's core toolset, and two unique outputs:

1. **Render animations to MP4** (canvas capture via MediaRecorder, WebCodecs where available).
2. **Export animations as standalone copy-paste Three.js code** users can drop into their own website.

Everything must work **on mobile (touch)** as a first-class citizen — that has been the driving constraint of this codebase from day one.

## 1. Hard constraints (do not violate)

- **Vanilla JS + Three.js r128** loaded from the existing CDN URL. No frameworks, no build step, no npm at runtime.
- **Single-file apps.** `index.html` = modeling suite. `animate.html` = rigging/animation suite (new, to be created). Shared code may be duplicated between the two files if extraction is impractical — files stay self-contained.
- Existing code style: compact vanilla JS, `var`, no classes-heavy design. Match it.
- **Mobile-first:** every new tool needs a touch flow (tap-tap-confirm instead of hover; on-screen numeric entry via the existing `slider()` tap-to-type pattern; buttons ≥36-42px on ≤820px viewports).
- Persistence: `localStorage` (see `doAutosave`/`tryRestoreAutosave`/`AUTOSAVE_KEY`). Models cross between the two HTML files via localStorage + the existing OBJ serialize path.
- **Never break the 62-check verification suite** (see §5). Every wave must end with `ALL CLEAN` plus new checks covering the new features.

## 2. Current state of the codebase (as of branch creation)

`index.html` (~2850 lines) already has: primitive build compositor with modifiers, a real half-edge-ish mesh editor (`EM` object: vert/edge/face modes, extrude with distance/emboss/push, inset, loop cut, select loop/linked, fill hole, mirror with live preview + apply/weld, recalc normals, box-select, subdivide), sculpt brushes (`Sculpt`), PBR materials + presets, 2D/3D texture painting with per-model textures and undo, scene composer (placements, point/spot/sun lights, environments, render-to-PNG at chosen resolution), asset manager with thumbnails/search/rename/duplicate/delete, OBJ import/export with proper-UV tracking, full undo/redo (`History`), autosave, light "liquid glass" theme over dark viewports, complete mobile chrome (tabbar, bottom sheet, zoom knob, quick undo, edit HUD).

Key internal objects an implementer must know: `EM` (mesh rep: `EM.V[]` verts, `EM.F[]` faces incl. n-gons, `EM.E[]` edges; `fromPrim`, `rebuild`, `exportToModel`), `editState` (mode/selection), `History` (undo), `state.models` (THREE.Group per model, `userData.parts`), `paint` (texture painting), `makeModel/makeMaterial/rebuildModel`, `setView` (view switching), panel builders `panelBuild/panelViewer/panelScene/panelPaint/panelAssets/panelEdit`, `renderEditHud`.

## 3. Master phase plan

Detailed feature-by-feature roadmap lives in `docs/GAP_ANALYSIS.md` (written by the research agent — read it before planning any wave). Phases:

- **Phase A — Modeling parity waves.** Close the gap on Blender edit-mode ops and modifiers inside `index.html`. Order per GAP_ANALYSIS roadmap (dependencies first). Each wave = 3-6 features.
- **Phase B — Foundations for animation.** Vertex groups + weight painting in `index.html`; serialization format v2 that carries weights/materials/shape keys through localStorage to `animate.html`.
- **Phase C — `animate.html`: rigging.** Armatures (THREE.Bone/Skeleton), bone create/parent/mirror, automatic weights (distance/heat approximation), weight paint view, IK chains (CCD or FABRIK — no external solver libs), constraints (copy transform, track-to, limit).
- **Phase D — `animate.html`: animation.** Keyframes on any animatable property (bone pose, object TRS, material params, light params, camera), dope sheet, graph editor with bezier/linear/constant interpolation + easing presets, timeline with touch scrubbing, playback transport, action clips, path-follow, onion skinning.
- **Phase E — Output.** (1) MP4 export: render loop → `canvas.captureStream()` → MediaRecorder (webm fallback where mp4 unsupported; WebCodecs + mp4 mux where available — no external mux libs, so if a pure-JS minimal mp4 muxer is too big, ship webm + clearly label it and offer per-frame PNG zip as the lossless path). (2) **Three.js code export:** generate a self-contained `<script>` snippet embedding geometry (compressed JSON), materials, skeleton, and keyframe tracks as `THREE.AnimationClip` code targeting current three versions, with a version banner and copy button.
- **Phase F — Polish/parity sweeps.** Physics-lite stretch goals per GAP_ANALYSIS, perf passes (mesh > 50k tris), theming consistency, docs.

Phases can overlap: Phase A waves may continue while C/D are being built, since they touch different files after Phase B lands.

## 4. How to orchestrate (instructions for the takeover agent)

You are the **orchestrator**. You do not need to write most code yourself — you dispatch **Sonnet subagents** (Agent tool, `model: "sonnet"`, `subagent_type: "general-purpose"`) and verify their work. Loop:

1. **Read the ledger** (§6) and `docs/GAP_ANALYSIS.md`. Pick the next unstarted wave.
2. **Dispatch an implementation subagent** with a prompt containing, verbatim: the wave's feature list from GAP_ANALYSIS; the constraints from §1; the internal-objects paragraph from §2; the instruction to add `ok`-style checks for each feature to the verification suite (§5) and to run it to `ALL CLEAN` before finishing; and the instruction to commit on `fullsuite` with a descriptive message but **never push**. One wave = one subagent. Prefer `run_in_background: false` so you review before the next wave, or run at most 2 in parallel **only if they touch different files** (e.g., one in `index.html`, one in `animate.html`) — parallel agents editing the same file will clobber each other.
3. **Verify yourself** after the subagent reports: run the verification suite, read the diff (`git diff HEAD~1`), spot-check 2-3 features via a Playwright screenshot script if visual. If broken: dispatch a debugging subagent with the failing output and diff rather than a blind retry.
4. **Push** to `origin/fullsuite` only after your own verification passes.
5. **Update the ledger** (§6) — mark the wave done, note deviations/known issues — commit the doc change, and go to 1.
6. If a subagent's result is fundamentally wrong, `git checkout -- <file>` / `git reset --hard` to the last good commit (check `git status` first) and re-dispatch with a corrected prompt explaining what went wrong.

**Subagent prompt template** (adapt per wave):

```
Implement Wave <N> of the Roxy.JS full-suite plan on branch `fullsuite`.
Read docs/ORCHESTRATION.md §1-2 for constraints and codebase map, and
docs/GAP_ANALYSIS.md section <X> for the features. Implement:
<list features with acceptance criteria>.
Every tool needs desktop mouse + mobile touch flows and undo support via History.
Add one verification check per feature to <suite path — see §5>; run the suite;
it must end ALL CLEAN with zero regressions. Commit on fullsuite
(descriptive message, no push). Report: what you built, what you tested,
any deviations.
```

## 5. Verification

The Playwright suite currently lives OUTSIDE the repo at the session scratchpad (`verify.js`, 62 checks, serves index.html on 127.0.0.1 with a local three.js and a `window.__R` debug-handle injection — repo file is never modified for tests).

**First housekeeping task for any takeover agent: copy the suite into the repo** at `tests/verify.js` + `tests/package.json` (playwright-core + three@0.128 pinned) so it survives session loss, and commit it. Run with `node tests/verify.js` after `npm i` inside `tests/`. Chromium ships pre-installed in this environment at `/opt/pw-browsers/...` (see the executablePath in verify.js). Screenshots for visual checks follow the same pattern (see scratchpad `final_check.js` for a minimal example).

If the scratchpad copy is gone (new session), reconstruct from `tests/` in the repo; if that hasn't been committed yet, rebuild the harness from the description above — boot the page, inject `window.__R` handles by replacing the final `\n})();\n</script>` anchor, and assert per-feature behavior via `page.evaluate`.

## 6. Wave ledger (update after every wave)

| # | Wave | File(s) | Status | Commit | Notes |
|---|------|---------|--------|--------|-------|
| 0 | Branch `fullsuite` + orchestration docs | docs/ | DONE | (this commit) | |
| 1 | Research: GAP_ANALYSIS.md | docs/ | IN PROGRESS | | sonnet research agent dispatched |
| 2 | Suite-into-repo housekeeping (§5) | tests/ | TODO | | do before first impl wave |
| — | *(populate from GAP_ANALYSIS roadmap once Wave 1 lands)* | | | | |

## 7. End-state acceptance (what "done" means)

A user on a phone or desktop can: model a character from primitives with the full edit toolset → paint it → rig it with bones and auto weights → keyframe a walk cycle with graph-editor control → light and frame it → press one button to download an MP4, and another to copy Three.js code that replays the same animation on their own site. Every one of those steps has knobs/numeric entry for precise control, undo, autosave, and passes the verification suite.
