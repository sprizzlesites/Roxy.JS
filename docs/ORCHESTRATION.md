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
- **Phase G — Node systems** (added by user request: full Blender node capabilities). Shared touch node-graph editor widget, then shader nodes (baked-map path, then true GLSL compile), geometry nodes (interpreter wrapping the existing EM/MODDB cores + ~35-node core registry), compositor nodes (post-FX chain feeding stills AND E1 video export), and a Track/Registry bridge making node params keyframeable. Full specs: GAP_ANALYSIS §6. Sequencing: G0 first; G1/G3a after it (same file — sequential, never parallel agents); G4 lands before or with E1; A8/A9 gate G3c only.

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

Wave definitions live in `docs/GAP_ANALYSIS.md` §4 — this table only tracks status. Update Status/Commit/Notes after every wave.

| Wave | Summary | Status | Commit | Notes |
|------|---------|--------|--------|-------|
| 0 | Branch `fullsuite` + orchestration docs | DONE | 52deb2f | |
| R | Research: GAP_ANALYSIS.md | DONE | | sonnet research agent, full read of index.html |
| T | Verification suite into repo (`tests/`) | DONE | 52deb2f | `cd tests && npm i && node verify.js` |
| A1 | Slide/Shrink-Fatten/Rip/Randomize/Shear edit ops | DONE | 9740368 | +5 checks (suite now 66); also fixed a latent `_pushVertHistory` undo crash |
| C0 | animate.html scaffold: theme/chrome parity, localStorage model bridge, Track/keyframe core seed (Anim.sample/insertKey), timeline scrub+play proof, own suite tests/verify_animate.js (18 checks) | DONE | ab6ec0b | not in original roadmap — added to de-risk C1/D1. Track shape: `{id,targetId,path,keys:[{t,v,interp}]}`, registry targetId→Object3D |
| A2 | Knife / Spin / Screw | DONE | 4c3c0eb | suite now 70; knife core is pointer-free (`EM.knifeCore`), K shortcut; knife points snap to verts/edges (no face-interior points — noted deviation) |
| A3 | Vertex-bevel, N-loop bridge, loop-cut slide, bevel width/segments, Symmetrize | DONE | f78f077+94a652f | suite now 75; bevel width is a fraction (.02-.49) not world units; symmetrize drops strictly-crossing faces (documented) |
| A4 | Seams, project-from-view unwrap, pack islands, UV editor mode | TODO | | |
| A5 | Vertex groups (+ assign UI) — Phase B/C dependency | DONE | 134c190 | suite now 80; `EM.groups` sparse maps + shared index-remap helper; `_vgroups` on parts through all round-trips |
| A6 | Decimate, true Catmull-Clark subsurf, texture displace | TODO | | |
| A7 | Lattice, Shrinkwrap, Cast variants, Skin modifiers | TODO | | |
| A8 | Boolean modifier (vendored BSP CSG) | TODO | | |
| A9 | Bezier curves, curve-to-mesh, array-along-curve | TODO | | |
| A10 | Text objects (billboard then extruded) | TODO | | |
| A11 | Voxel remesh (stretch) | TODO | | |
| B1 | Weight painting | DONE | 5d161b0+678e28a | modeling suite now 88; `WeightPaint` mirrors Sculpt pipeline, writes A5 group weights, Add/Sub/Blur/Set + symmetry, per-stroke undo; agent cut off, tests written by orchestrator |
| B2 | Serialization v2 (weights/keys/skeleton through save + localStorage bridge) | TODO | | |
| B3 | Shape keys / morph targets | TODO | | |
| B4 | Vertex colors | TODO | | |
| C1 | animate.html: armatures/bones/parenting/pose mode | DONE | a561a08 | animate suite now 28; slerp in Anim.sample; bone Registry ids `rig/bone:Name`; anim autosave format v2 |
| C2 | Skinning bind + auto weights | DONE | 3572a51 | animate suite now 67; `bindMeshToRig` SkinnedMesh, vgroups-named-after-bones or inverse-dist-to-bone-segment auto weights; autosave v5 stores bind intent; GLB skin export deferred |
| C3 | Per-axis FK, CCD IK + pole targets, per-bone rotation limits | DONE | 58dc09c | animate suite now 36; `solveIK(chainBEs,target,iters,{maxStep,tolerance,pole})`; `clampBoneRotation` is the C4 Limit-constraint entry point; autosave v3 (additive) |
| C4 | Constraints (copyLoc/copyRot/trackTo/limitRot, influence keyable) | DONE | 52007de | animate suite now 45; influence track ids use stable `con:<id>` not index; object-level constraints runtime-only (not serialized) |
| D1 | Keyframe core (Track model + sampler) | TODO | | load-bearing for D/E |
| D2 | Timeline + playback transport | TODO | | |
| D3 | Dope sheet + transport polish | DONE | 1c55117+b1a0387+5292d3f | animate suite now 58; canvas sheet, frame-snapped retime, marquee multi-select, pinch-zoom; agent cut off, tests committed by orchestrator |
| D4 | Graph editor | TODO | | |
| D5 | Camera animation + path-follow | TODO | | |
| D6 | Action clips (NLA-lite) | TODO | | |
| D7 | Onion skinning | TODO | | |
| G0 | Shared touch node-graph editor widget + registry/eval core | DONE | d93b2f1+4811314 | modeling suite now 106 (+18 node checks); `NodeGraph` eval core + `NodeUI`/`makeNodeEditor` canvas editor + `NODE_DEMO` registry. **Registry contract for G1/G3a/G4: read the G0 code — each node type = {title,inputs,outputs,params,eval}; socket `kind` equality gates connections.** Nodes tab added |
| G1 | Shader nodes: baked-map path (texture/utility nodes, Principled output) | DONE | a229568+66c69f3+13b24ff | modeling suite now 118; `NODE_SHADER` 24 node types on the G0 contract; `bakeShaderMaterial` walks a UV grid → per-channel maps; Fresnel/LayerWeight are bake-time constants (G2 does real GLSL); NodeUI defaults to NODE_SHADER |
| G2 | Shader nodes: true GLSL compile (onBeforeCompile) + bake-for-export | TODO | | |
| G3a | Geometry nodes: interpreter + inputs/primitives/mesh-op nodes | DONE | 67e6bde+3c86225+fc22e5b+ba2ca41 | modeling suite now 131; `NODE_GEO` 24 types, geometry socket = `{V,F,UV}` struct, `evalGeoGraph` interpreter, `model.userData.geoNodes` modifier slot + Apply-bake, Shader/Geometry mode toggle in Nodes tab; Position/Normal/Index are per-pass snapshots (true per-vertex fields = G3b); Extrude has no face-selection yet |
| G3b | Geometry nodes: instancing/scatter + attribute fields | TODO | | |
| G3c | Geometry nodes: curve + boolean nodes | TODO | | after A8+A9 |
| G4 | Compositor nodes (stills + video export hook) | TODO | | land before/with E1 |
| G5 | Keyframeable node params (Track/Registry bridge) | TODO | | |
| E1 | Video export (WebM guaranteed, MP4 progressive) | DONE | e0a11cf+7045605 | animate suite now 76; `exportVideo(opts)` fixed-timestep sampler→MediaRecorder/WebM (vp9 in headless), real non-empty Blob verified; PNG-zip fallback; `VideoExport.active` stands down the main loop; autosave v6. G4 compositor still to be wired into this same render loop |
| E2 | Standalone Three.js code export | DONE | 4964ff2+a71d2bb+50d87b5 | animate suite now 85; `exportStandaloneJS({mode})` snippet or full-HTML; embeds the SAME sampler funcs `Anim.sample` calls (anti-duplication verified); E2E test runs the generated artifact in a fresh page + asserts playback. Deferred: env/PMREM IBL, compositor, live constraint/IK re-solve (replays keyed poses) |
| F1-F7 | Polish & stretch (see GAP_ANALYSIS §4 Phase F) | TODO | | |

## 7. End-state acceptance (what "done" means)

A user on a phone or desktop can: model a character from primitives with the full edit toolset → paint it → rig it with bones and auto weights → keyframe a walk cycle with graph-editor control → light and frame it → press one button to download an MP4, and another to copy Three.js code that replays the same animation on their own site. Every one of those steps has knobs/numeric entry for precise control, undo, autosave, and passes the verification suite.
