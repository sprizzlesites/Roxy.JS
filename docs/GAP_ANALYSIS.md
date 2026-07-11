# Roxy.JS ↔ Blender Gap Analysis

**Purpose:** master reference for every future implementation wave (see `docs/ORCHESTRATION.md`). Section numbers are stable — orchestrator prompts cite them (e.g. "GAP_ANALYSIS §3.4"). Do not renumber sections when editing; append instead.

**Method:** full read of `index.html` (2838 lines, current `fullsuite` branch) function-by-function, cross-referenced against Blender's core feature set from general Blender-modeling knowledge. No external sources needed or used.

**Constraints assumed throughout** (see `docs/ORCHESTRATION.md` §1 for the authoritative list): vanilla JS + Three.js r128 from CDN, no build step, single-file HTML apps (`index.html` = modeling, `animate.html` = rigging/animation, new), mobile Safari/Chrome touch as first-class, `localStorage` persistence, existing compact `var`-based code style.

---

## 1. Current App Inventory (as of this analysis)

Everything below already exists in `index.html`. Function/object names are exact — grep them.

### 1.1 Primitives / Build
- `PRIMS`: Cube, Sphere, Cylinder, Cone, Torus, Plane, Icosphere, Knot, Pyramid, Prism, Disc, Tube (12 primitives).
- `panelBuild` / `addPrim`: place multiple primitives in a compositor scene (`buildScene`), per-object transform sliders (pos xyz, rotate x/y, uniform scale), color/roughness/metalness, material presets, duplicate/delete via the drag `Gizmo`.
- `saveBuildAsModel`: bakes the build-scene composition into one model (multi-part).
- `buildDonut` / `doughAlbedo`: one hand-authored procedural sample model.

### 1.2 Mesh editing (`EM` object, `editState`)
- **Topology rep:** `EM.V[]` (verts, may carry `u0/v0` UVs), `EM.F[]` (faces, n-gon capable via `vi[]`), `EM.E[]` (edges with adjacent-face list). Native quad construction (`_quadBox/_quadPlane/_quadCylinder/_quadTorus`) for loop-cut/loop-select-capable primitives.
- **Selection:** vert/edge/face modes (`editState.mode`), tap select (`EM.select`), multi-select toggle, drag box-select add/subtract (`EM.boxSelect`, `editState.boxSel`), `selAll`, `clearSel`, `selectLoops` (quad loop walk), `selectLinked` (connected-island grow).
- **Transform:** `grab` (screen-delta drag move) with **proportional editing** (`editState.prop`, `propR`, smoothstep falloff) and **live mirror** (`editState.mirror/mirrorAxis`, ghost preview + `applyMirror` bake+weld). `scaleSelection`, `rotateSelection` (15° steps X/Y/Z), `alignSelection` (flatten to axis plane). Vertex/grid **snap-on-release** (`applyEditSnap`, top-bar Snap toggle).
- **Ops:** `extrude` (region extrude, +out/-emboss, distance param), `pushSel` (post-extrude normal nudge), `inset`, `subdivide` (selection-aware, tri+ngon), `loopCut` (quad-only), `duplicateSelection`, `separateSelection` (→ new model), `bridgeEdges` (2 edges → quad), `fillHole` (n-gon cap of a full boundary loop), `bevelEdges` (chamfer, interior 2-face edges only), `deleteSelected`, `mergeSelected` (merge-at-centroid), `weldClose` (merge-by-distance, tol 0.05), `flipNormals`, `recalcNormals` (heuristic outward-facing), `smoothVerts` (Laplacian).
- **Export:** `exportToModel` (atlas or carried UVs → new model in the library).
- Full undo/redo via topology snapshots (`_topoSnapshot/_topoRestore/_pushTopo`).
- Desktop keyboard shortcuts: E/I/S/B/L/N/D/X/A/M (see bottom of file, `keydown` handler).

### 1.3 Sculpt (`Sculpt` object)
- Brushes: Draw, Carve (subtract), Crease, Inflate, Smooth, Grab, Flatten, Pinch.
- Radius/strength sliders, symmetry (Off/X/Y/Z), screen-space brush footprint (avoids corner-bleed on dense meshes via `_dab`'s screen-projected selection for chisel brushes).
- **No dyntopo/remesh** — fixed topology; users are told to add a Subdivide Smooth modifier first for detail. **No masking.**

### 1.4 Modifiers (`MODDB`, 21 entries, two kinds)
- **`kind:'deform'`** (baked into base geometry per-rebuild, live-editable, "Apply" bakes permanently via `applyModifiers`): Twist, Bend, Taper, Spherify, Noise Displace, Wave, Subdivide Smooth (subdivide+relax, not true Catmull-Clark), Solidify (shell thickness), Stretch/Squash, Shear, Ripple, Inflate/Puff, Pinch/Waist.
- **`kind:'gen'`** (adds a generated child group, non-destructive): Sprinkles (raycast scatter), Surface Studs (scatter), Array (Linear), Ring Array, Mirror (generator-level reflect, distinct from `EM.applyMirror`), Spikes (scatter), Grid Array, Wireframe Cage.
- No Boolean, Screw, Lattice, Curve, Shrinkwrap, Cast, Simple Deform, Skin, or Decimate modifiers.

### 1.5 Materials
- `THREE.MeshPhysicalMaterial` per part: color, roughness, metalness, clearcoat/clearcoatRoughness, transmission/ior/thickness (glass), opacity/transparent, emissive+intensity, flatShading toggle.
- `MATPRESETS`: Matte, Plastic, Glossy, Metal, Chrome, Glass, Ceramic, Rubber (`applyMatPreset`).
- One material per **part** (a part = one geometry chunk of a model); no per-face multi-material assignment within a single part, no node-graph procedural shading (only canvas-baked patterns via texture paint).

### 1.6 Texture paint (`paint` object)
- 2D canvas (1024×1024) painting: brush color/size/softness, eraser, eyedropper (`pickColorAt2D/3D`).
- **3D surface painting** (`paint.mode3d`, `do3dPaint`): per-face UV atlas (`ensureAtlasUVs`) avoids cross-face bleed; projection painting via screen→triangle affine mapping, multi-face stroke coverage, sweep-casting between move events.
- Patterns: sprinkles/dots/stripes/checker/gradient (`paintPattern`). Stamp image import. Clear/fill/noise-fill. `paintDrawUV` (show UV wireframe overlay).
- Paint undo/redo is model-aware (`pushPaintHistory`, handles switching the active model mid-session).
- **No layers, no blend modes beyond source-over/erase, only one texture map (base color) — no roughness/normal/AO paint channels.**

### 1.7 Scene composition
- `ENVS` (6 environment presets: Studio Warm, Sunset, Soft Overcast, Night Blue, White Studio, Void) built as canvas-gradient equirect + `PMREMGenerator` (`buildEnvTex/applyEnv`). Custom background color, grid toggle.
- `addPlacement`: instance models into the scene with position/rotation/scale sliders, remove.
- `spawnLight/addLight`: Point/Spot/Sun(Directional) with position/intensity/color, visual helper spheres, delete. **No area lights, no IES profiles.**
- Camera: FOV slider only, "Set render camera = current view" (locks a camera clone), resolution presets (720p/1080p/1440p), transparent-background toggle, `renderScenePNG` (single still).
- **No multiple/switchable cameras as scene objects, no DOF, no camera animation.**

### 1.8 Import / Export
- Import: OBJ (`parseOBJ`, positions/uv/normals), GLB (`importGLB`, custom binary parser — node transforms, embedded baseColor texture only, **no normal/roughness/metalness maps, no skins, no animations**), image (texture or paint stamp), project JSON (`loadProject`, full round-trip).
- Export: GLB (`exportGLB` — embeds baseColorTexture + `KHR_texture_transform`/`KHR_materials_emissive_strength`/`KHR_materials_transmission` extensions, **no skinning/animation export**), OBJ+MTL+PNG (`exportOBJ`), project JSON (`saveProject`, texture data-URLs, autosave via `doAutosave`/`AUTOSAVE_KEY`), PNG screenshot/render.

### 1.9 Rendering / screenshot
- Real-time renderer: ACESFilmicToneMapping, PCFSoftShadowMap, sRGB encoding, PMREM environment, on-demand render loop (`invalidate`/`renderFrames` — battery-aware).
- `#btnShot` → PNG of the active view; `renderScenePNG` → PNG of the Scene view at a chosen resolution.
- **No animation/video export, no offline/higher-sample render pass.**

### 1.10 Mobile / touch UX (already mature — reuse these patterns, don't reinvent)
- Responsive layout: `#rail` (desktop) vs `#tabbar` + draggable bottom-sheet `#panel` (mobile, `openSheet`, drag-to-open/close with velocity fling).
- `RotBall` orbit gizmo (canvas-drawn axis widget), pinch-zoom + two-finger pan (`pointermove` handler, `ptrs` Map), tap-select, double-tap-to-frame, box-select drag with add/subtract cycling, `#zoomKnob` (vertical slider + ± buttons), floating `#quickUndo`.
- `renderEditHud`: compact horizontal-scroll HUD rows with overflow fade + "···" expand toggle — **the pattern to copy for any new mobile tool with many sub-actions.**
- `slider()` helper: drag-to-adjust range input where the **label doubles as tap-to-type exact value** (`prompt()`-based) — reuse for every new numeric control, including future keyframe/graph-editor values.
- First-run per-view hint toasts (`HINTS`, localStorage-gated so they never repeat), `prefers-reduced-motion` support, accessible names on icon-only controls.

### 1.11 Undo/redo & persistence
- Global `History` stack (`push/undo/redo`, 80-entry limit) — used by essentially every destructive op across all views.
- `doAutosave`/`tryRestoreAutosave` (debounced localStorage autosave with texture-size fallback), manual `saveProject`/`loadProject` JSON round-trip.

### 1.12 Explicitly absent (confirmed by full read, not just omission)
Camera objects you can select/animate · curves/surfaces/text objects · real UV unwrap (only auto per-face atlas or carried source UVs — no seams, no LSCM) · vertex groups · weight painting · armatures/bones · any animation system (keyframes, timeline, dope sheet, graph editor, NLA) · shape keys/morph targets · physics/particles · boolean modifier · decimate · multi-material-per-part · texture layers · knife/spin/screw/rip/vertex-slide edit ops · shrink/fatten along individual normals.

---

## 2. Blender Feature Gap Matrix

Legend: **PRESENT** (cite function) · **FEASIBLE** (buildable in vanilla JS/Canvas within constraints — complexity noted) · **HARD** (needs a heavy lib/WASM/numerically-serious algorithm — closest feasible approximation noted).

### 2.1 Mesh modeling — edit-mode operators

| Blender feature | Status | Notes / Roxy.JS reference |
|---|---|---|
| Extrude (region) | PRESENT | `EM.extrude` |
| Extrude along normal (push/pull) | PRESENT | `EM.pushSel` |
| Inset faces | PRESENT | `EM.inset` |
| Bevel (edge, chamfer) | PRESENT (edges only, fixed 1 segment) | `EM.bevelEdges` — FEASIBLE to extend: variable width + segment count (S) |
| Bevel (vertex) | MISSING — FEASIBLE (S) | corner-chamfer variant of `bevelEdges` |
| Bridge Edge Loops | PRESENT (2-edge only) | `EM.bridgeEdges` — FEASIBLE to extend to N-edge-loop-to-loop bridging (M) |
| Loop Cut | PRESENT (quad-only, no slide) | `EM.loopCut` — FEASIBLE to add post-cut slide (S) |
| Knife tool | MISSING — FEASIBLE (M) | needs tap-tap-confirm mobile flow (see §3) instead of hover+click drag |
| Spin (lathe revolve) | MISSING — FEASIBLE (M) | revolve selection N steps around a picked axis; natural fit next to `loopCut`/`bridgeEdges` |
| Screw | MISSING — FEASIBLE (S, once Spin exists) | Spin + per-step Z offset |
| Solidify (edit-mode, selection-based) | PRESENT only as whole-mesh **modifier** (`MODDB.solidify`) | edit-mode selection-scoped solidify is FEASIBLE (M), reuse `solidifyVF` |
| Shrink/Fatten (along individual vertex normals) | MISSING — FEASIBLE (S) | distinct from uniform `scaleSelection`; needs per-vertex normal offset |
| Smooth / Laplacian smooth | PRESENT | `EM.smoothVerts` |
| Vertex/Edge Slide | MISSING — FEASIBLE (S-M) | constrain drag to along adjacent edges instead of free `screenDeltaToWorld` |
| Snap-to (vertex/grid) | PRESENT (drag-release only) | `applyEditSnap` — FEASIBLE to add live snap-while-dragging and snap-to-face (S) |
| Proportional editing | PRESENT | `editState.prop/propR`, `_propWeights` |
| Vertex groups | MISSING — FEASIBLE (S-M) | foundational for weight painting/armatures — see Wave B1 |
| Boolean ops (union/diff/intersect) | MISSING — **borderline HARD** | closest FEASIBLE approach: vendor a compact public-domain BSP CSG algorithm (~500 lines, e.g. the well-known Evan Wallace `csg.js` technique) inlined as a script block — no WASM, no external deps beyond one vendored file (still "vanilla JS"). Complexity: L. Robustness on non-manifold/coplanar input is the real risk — treat as best-effort, not exact. |
| Remesh (voxel) | MISSING — HARD | true voxel remesh needs marching cubes + a signed-distance-field pass. FEASIBLE approximation: implement marching cubes over a coarse voxel grid sampled from the current mesh's implicit SDF (raycasting-based), complexity L. Cheaper stopgap already partially covered by `MODDB.subsurf` (subdivide+relax) for organic smoothing, not true remesh. |
| Decimate (simplify) | MISSING — FEASIBLE (M) | edge-collapse simplification (a simplified quadric-error-free version — collapse shortest edges first, cheaper than full QEM) is implementable without external libs |
| Triangulate / Tris-to-Quads | MISSING — FEASIBLE (S) | export path already triangulates (`_toGeo`); expose as an explicit user-facing op + a quad-recombination heuristic for the reverse |
| Merge by Distance | PRESENT | `EM.weldClose` |
| Split / Rip | MISSING — FEASIBLE (S-M) | duplicate a boundary vertex and disconnect one side's face-fan |
| Shear (edit-mode, selection-scoped) | PRESENT only as whole-mesh **modifier** (`MODDB.shear`) | selection-scoped edit-mode shear is FEASIBLE (S) |
| Randomize vertices | MISSING — FEASIBLE (S) | trivial: `hash3`-based jitter already exists as a pattern (`MODDB.noise`) |
| Mirror (edit-mode live + apply) | PRESENT | `editState.mirror`, `EM.applyMirror` |
| Symmetrize | MISSING — FEASIBLE (S) | one-shot variant of the existing mirror-apply flow without keeping the "off" side |

### 2.2 Modifiers

| Blender modifier | Status | Notes |
|---|---|---|
| Array (linear) | PRESENT | `MODDB.array`, plus `MODDB.ring`, `MODDB.gridarr` (Blender doesn't split these — Roxy.JS already covers more array variants than stock Blender's single Array modifier config) |
| Array (fit-to-curve) | MISSING — FEASIBLE (M), depends on Curves (§2.3) | |
| Mirror | PRESENT | `MODDB.mirror` (generator) + `EM.applyMirror` (edit-mode) |
| Boolean | MISSING — see §2.1 Boolean | L |
| Subdivision Surface (true Catmull-Clark) | PRESENT (approximation) | `MODDB.subsurf` is subdivide+relax, not exact Catmull-Clark — FEASIBLE to upgrade to true Catmull-Clark (M), same architecture (`geoToVF`/`subdivStep`/`vfToGeo`) |
| Solidify | PRESENT | `MODDB.solidify` |
| Bevel (modifier form) | MISSING — FEASIBLE (S), reuse `EM.bevelEdges` core once edit-op supports width/segments | |
| Screw | MISSING — FEASIBLE (S, after Spin) | |
| Lattice | MISSING — FEASIBLE (M) | free-form deform cage (FFD), a 3D generalization of `EM.grab`'s trilinear influence — implementable with a small control-point grid + trilinear interpolation |
| Curve (deform along curve) | MISSING — FEASIBLE (M), depends on Curves | |
| Shrinkwrap | MISSING — FEASIBLE (M) | project each vertex onto nearest point of a target mesh (raycast or nearest-triangle search — same raycast machinery already used by `MODDB.sprinkles`) |
| Displace (texture-driven) | PRESENT-ish | `MODDB.noise`/`MODDB.wave`/`MODDB.ripple` cover procedural displace; texture-map-driven displace (sample a painted grayscale map) is FEASIBLE (S) |
| Wave | PRESENT | `MODDB.wave`, `MODDB.ripple` |
| Cast (to sphere/cylinder/cube) | PRESENT (sphere only) | `MODDB.spherify` — FEASIBLE to add cylinder/cube cast variants (S) |
| Simple Deform (twist/bend/taper/stretch) | PRESENT | `MODDB.twist/bend/taper/stretch` |
| Skin modifier | MISSING — FEASIBLE (M) | generate a tube mesh along a vertex/edge skeleton with per-vertex radius — useful shortcut for quick creature bases |
| Decimate | MISSING — FEASIBLE (M) | see §2.1 |

### 2.3 Curves / surfaces / text

| Blender feature | Status | Notes |
|---|---|---|
| Bezier curve object | MISSING — FEASIBLE (M) | control points + handles, new object type parallel to `state.models`; touch editing reuses `EM`-style tap-select + drag-move patterns |
| Curve-to-mesh (extrude/bevel profile along curve) | MISSING — FEASIBLE (M), depends on Bezier curve | sweep a profile polygon along the curve's Frenet frames — same math family as `_quadCylinder`/`_quadTorus` |
| NURBS curves/surfaces | MISSING — HARD | true NURBS evaluation is a real numerical undertaking for little payoff here. Closest FEASIBLE approximation: Bezier/Catmull-Rom curves (already trivial) cover almost all practical uses; skip true NURBS surfaces as out of scope/stretch. |
| Text objects (3D extruded) | MISSING — FEASIBLE (M) | needs glyph outlines — vendor a small single-file font-to-path parser (e.g. an opentype.js-style CDN script, same pattern as vendoring Three.js itself) then extrude via `THREE.ExtrudeGeometry` |
| Text objects (billboard/canvas, cheap first pass) | MISSING — FEASIBLE (S) | draw text to a canvas texture on a plane — ships before true 3D text, reuses `tex()`/`fbm`-style canvas helpers |

### 2.4 Sculpting

| Blender feature | Status | Notes |
|---|---|---|
| Draw/Clay/Crease/Pinch/Grab/Smooth/Inflate/Flatten/Snake Hook brushes | PRESENT (8 of 9; Snake Hook missing) | `Sculpt.brush` — Snake Hook (grab that also stretches along the drag direction) is FEASIBLE (S), a `grab` variant |
| Dyntopo (dynamic topology) | MISSING — HARD | real-time local remeshing during a stroke is a serious algorithm. Skip; rely on pre-subdividing (`MODDB.subsurf`) before sculpting, as the in-app tip already suggests. |
| Remesh (voxel, applied) | MISSING — HARD | see §2.1 Remesh |
| Masking | MISSING — FEASIBLE (M) | a per-vertex float mask array gating `Sculpt._dab`'s `hits` weights — architecturally similar to vertex groups (§2.1), could share the data structure |
| Multires | MISSING — HARD, low priority | needs a mesh hierarchy with per-level displacement storage; skip, not a mobile-suite priority |

### 2.5 Materials / shading

| Blender feature | Status | Notes |
|---|---|---|
| PBR params (base color, roughness, metalness, IOR, transmission, clearcoat, emission) | PRESENT | `makeMaterial`, `MeshPhysicalMaterial` fields, `MATPRESETS` |
| Procedural texture nodes (noise, checker, gradient, voronoi as material inputs) | MISSING — FEASIBLE (S-M) | `fbm()` and `paintPattern()` already generate exactly these as canvas textures; the gap is exposing them as **material map inputs** (roughness/normal maps), not just paintable base color |
| Vertex colors | MISSING — FEASIBLE (S) | `THREE.BufferAttribute` color channel + `vertexColors:true` material flag; paint UI can reuse the existing brush pipeline targeting `EM.V[i].sel`-style per-vertex data instead of canvas pixels |
| Multiple material slots per mesh (per-face assignment) | MISSING — FEASIBLE (M) | Roxy.JS's "parts" already give multi-material-per-model; true per-face material index within one part needs `geometry.groups` + material array, plus a face-mode "assign material" op in `EM` |
| Normal/roughness/metalness/AO map painting | MISSING — FEASIBLE (M) | extend `paint` object to target multiple named canvases (one per channel) instead of the single base-color canvas; UI: a channel selector chip row before the color picker |
| Node-graph shader editor | MISSING — HARD, low priority | Blender's full shader graph is out of scope for a mobile-first suite; the preset+slider system already covers the practical surface area |

### 2.6 UV

| Blender feature | Status | Notes |
|---|---|---|
| Auto per-face UV atlas (non-destructive painting) | PRESENT | `ensureAtlasUVs`, `_facesToGeo` |
| Real angle-based/conformal unwrap (LSCM/ABF) | MISSING — HARD | numerically nontrivial (sparse linear solve). FEASIBLE approximation: per-island planar projection unwrap (project each connected shell using its dominant plane, like `_facesToGeo`'s per-face projection but grouped by seam-bounded islands instead of per-triangle) — much better than the current 1-triangle-per-tile atlas for anything meant to look clean, still not true LSCM. Complexity M. |
| Seams | MISSING — FEASIBLE (S) | boolean flag on `EM.E[i]`, used as island-boundary input to the planar-projection unwrap above |
| Pack islands | MISSING — FEASIBLE (S) | rectangle-packing of island bounding boxes; the atlas grid-packing logic in `_facesToGeo`/`ensureAtlasUVs` is the starting point |
| Project from view | MISSING — FEASIBLE (S) | `do3dPaint`'s screen-to-triangle projection math is directly reusable to *generate* UVs from the current camera angle, not just paint through them |
| UV Editor view (2D layout, move/scale islands) | MISSING — FEASIBLE (M) | the existing `paint2d` split-view canvas (`panelPaint`'s left pane) is architecturally ready to host an island-editing mode alongside painting |

### 2.7 Rigging

| Blender feature | Status | Notes |
|---|---|---|
| Vertex groups | MISSING — FEASIBLE (S-M) | see §2.1 — foundational, do first |
| Weight painting | MISSING — FEASIBLE (M), depends on vertex groups | reuse `Sculpt`'s touch-brush pipeline (radius/strength/falloff already solved) but write to a float weight array + color-ramp visualization material instead of displacing verts |
| Armatures / bones (`THREE.Bone`/`THREE.Skeleton`) | MISSING — FEASIBLE (L) | new object type; edit-mode bone chain build can reuse `EM.extrude`'s "click to extend a chain" UX; Three.js r128 natively supports `SkinnedMesh`/`Skeleton`, so the runtime deform is native, the gap is entirely tooling |
| Parenting (object/bone) | MISSING — FEASIBLE (S) | simple `THREE.Object3D` parent-child re-attach with a "keep transform" option |
| Automatic weights | MISSING — FEASIBLE approximation (M) | Blender's heat-diffusion solve is HARD; a workable approximation is inverse-distance-to-nearest-bone-segment weighting (cheap, no linear solve), clearly labeled as an approximation in the UI |
| Manual weight assignment | MISSING — FEASIBLE (S), same as weight painting | |
| IK (inverse kinematics) | MISSING — FEASIBLE (S-M) | CCD (cyclic coordinate descent) IK is ~50-100 lines, no external solver needed; FABRIK is a similarly small alternative if CCD's convergence looks worse in practice |
| FK (forward kinematics) | MISSING — FEASIBLE (S) | this is "just" rotating bones — native to `THREE.Bone`, the gap is a rotate-gizmo UI (reuse `Gizmo`/`RotBall` patterns) |
| Constraints: Copy Location/Rotation | MISSING — FEASIBLE (S each) | per-frame code applied before render, small |
| Constraints: Track-To | MISSING — FEASIBLE (S) | `Object3D.lookAt` toward a target object each frame |
| Constraints: Limit (location/rotation/scale) | MISSING — FEASIBLE (S) | clamp after normal transform evaluation |
| Shape keys / morph targets | MISSING — FEASIBLE (M) | Three.js r128 supports `geometry.morphAttributes.position` + `mesh.morphTargetInfluences` natively; the gap is UI to (a) duplicate a base mesh into `EM`, sculpt/edit it, (b) diff the two vertex sets into a morph target, (c) expose a blend slider — the diff-and-store workflow can reuse `EM.V` snapshot/restore machinery already used by undo |

### 2.8 Animation

| Blender feature | Status | Notes |
|---|---|---|
| Keyframes on any property | MISSING — FEASIBLE (M-L) | **the foundational wave.** Needs a generic `Track` model: `{targetId, path, keyframes:[{t, value, interp}]}` where `path` is a dotted accessor (`position.x`, `material.color`, `light.intensity`, `camera.fov`, `boneName.quaternion`...); evaluated each frame by a sampler that resolves `path` against the live object graph |
| Timeline scrubbing + playback (play/pause/loop, fps) | MISSING — FEASIBLE (S-M), depends on Track model | virtual clock driving `requestAnimationFrame`; scrub bar reuses the existing `slider`/`#zkSlider` touch-drag pattern |
| Dope Sheet | MISSING — FEASIBLE (M), depends on Track model | horizontal timeline listing tracks as rows with keyframe "diamonds"; drag-to-retime |
| Graph Editor (bezier/linear/constant interpolation, easing) | MISSING — FEASIBLE (L), depends on Track model | canvas-drawn per-track curve, draggable Bezier handles (De Casteljau eval), numeric fallback entry (reuse `slider()`'s tap-to-type) since handle-dragging is fussy on small touchscreens |
| NLA-style action clips | MISSING — FEASIBLE (M-L), depends on Track model | named clips wrapping a track set with a start/end range; sequential (non-blended) playback is the FEASIBLE first cut — cross-fade blending between overlapping clips is a harder second pass |
| Path-follow animation | MISSING — FEASIBLE (M), depends on Curves (§2.3) + Track model | sample position/tangent along a Bezier curve as a function of a "path position" keyframeable property |
| Camera animation | MISSING — FEASIBLE (S-M), depends on Track model | camera becomes a keyframeable object like any other (position/rotation/FOV tracks); "playback" renders through the active camera each frame |
| Onion skinning | MISSING — FEASIBLE (M-L), depends on Track model | render N translucent ghost evaluations of the pose at nearby frames — cost-bound by how cheap a single "evaluate pose at time t" call is, so keep the sampler fast |

### 2.9 Physics / simulation — explicit stretch goals

| Blender feature | Status | Notes |
|---|---|---|
| Particles (emitter, simple forces) | MISSING — FEASIBLE (M), stretch | position/velocity/gravity/drag integration, no collision — a straightforward `THREE.Points`-based system |
| Cloth simulation | MISSING — HARD, stretch | mass-spring-damper integration is buildable (M-L) but genuinely stable cloth (self-collision, pinning, wind) is a deep rabbit hole; ship a best-effort unconstrained mass-spring cloth with pinned vertices only, clearly labeled experimental |
| Rigid body dynamics | MISSING — HARD, stretch | simple impulse-based sphere/box collision (no general convex solver) is FEASIBLE for basic drop/bounce demos (M-L); a general rigid-body engine is out of scope — if ever prioritized, the pragmatic move is vendoring a small physics engine (e.g. `cannon-es`) the same way Three.js itself is vendored, rather than hand-rolling one |
| Fluid/smoke simulation | MISSING — HARD, out of scope | no feasible lightweight approximation worth building for this suite |

### 2.10 Rendering / output (includes the two unique Roxy.JS requirements)

| Feature | Status | Notes |
|---|---|---|
| Camera settings (FOV) | PRESENT | Scene panel slider |
| Camera settings (near/far clip) | MISSING — FEASIBLE (S) | expose existing `PerspectiveCamera.near/far` |
| Depth of field (bokeh) | MISSING — FEASIBLE (M) | simple two-pass blur-by-depth post-process (no full postprocessing library needed — a manual render-to-texture + custom blur shader pass works in r128 without `EffectComposer`) |
| Render to still image | PRESENT | `renderScenePNG`, `#btnShot` |
| **Render animation to video (MP4)** | MISSING — FEASIBLE (M-L) | `canvas.captureStream()` + `MediaRecorder`, driving a **fixed-timestep** render loop (decoupled from real wall-clock so slow devices don't produce choppy output) through the Track sampler from §2.8. Container/codec reality check: `MediaRecorder`'s MP4/H.264 support is inconsistent across mobile Safari/Chrome — **WebM is the reliable first target**; treat MP4 (via WebCodecs + a minimal muxer) as progressive enhancement, and always offer WebM as the guaranteed-to-work fallback with clear labeling. |
| **Export animation as standalone Three.js code** | MISSING — FEASIBLE (M-L) | unique requirement, no Blender equivalent. Serialize geometry + materials (same embedding technique as `exportGLB`'s inline base64/dataURL textures) + the Track/keyframe data, then emit a self-contained `<script src="cdnjs…three.min.js">` + inline JSON + a **trimmed copy of the same Track-sampler runtime** used in `animate.html`, wrapped in "copy to clipboard" / "download .html" actions. Because the runtime is shared code, build it once and literally paste it into the generated snippet — don't reimplement a second player. |

---

## 3. Mobile/Touch Implementation Notes for the Hard Cases

Reuse existing patterns wherever possible — do not invent new touch idioms if an old one fits.

- **Knife tool:** hover+click doesn't exist on touch. Flow: tap a starting point on an edge/face → each subsequent tap adds a cut vertex (small marker rendered, like `Sculpt._ringObj`'s brush-preview pattern) → a HUD row (reuse `renderEditHud`'s compact-row pattern) shows "Confirm" / "Cancel" / "Undo point" buttons → confirm commits the cut across all crossed faces.
- **Spin/Screw axis pick:** no keyboard axis-lock (X/Y/Z keys) on mobile. Provide axis chip buttons (same look as the `cycleMirror`/`mirrorBtnLabel` Off→X→Y→Z cycling control) plus numeric sliders as the precise fallback, exactly like `editState.mirrorAxis`.
- **Weight painting:** directly reuse `Sculpt`'s pointerdown/move/up pipeline and radius/strength HUD sliders — only the payload changes (write a float weight instead of displacing `EM.V[i]`). This is the single biggest "don't reinvent it" opportunity in the whole roadmap.
- **Graph editor handle dragging:** Bezier handles are small and fussy at finger scale. Mitigations: generous hit-radius (44px+ per Apple/Google touch guidelines, already the app's `min-height:42px` convention on mobile), snap-to-adjacent-keyframe-value gridlines, and a numeric-entry fallback identical to `slider()`'s tap-the-label-to-`prompt()` pattern — every curve value should be reachable without precise dragging.
- **Armature posing:** bone selection via tap (same raycast-then-select pattern as `onViewportTap`); rotation via a per-bone gizmo — reuse `Gizmo`'s translate-axis-cylinder-drag pattern rotated into rotation rings, or reuse `RotBall`'s 2D-drag-to-3D-rotation math scoped to one bone instead of the camera.
- **Boolean op alignment:** precisely overlapping two objects by drag is hard on a small screen. Make numeric position/rotation entry (already available via every `slider()`'s tap-to-type) the primary alignment method for boolean targets, with drag as the coarse/quick option.
- **Timeline scrubbing:** a wide horizontal drag-scrub bar with a large touch target, following the `#zkSlider`/`hudSlider` precedent (range input styled for touch, `touch-action:none` to prevent scroll interference).
- **Dope sheet keyframe drag:** keyframe diamonds need ≥36px effective touch targets even if visually smaller (invisible padding), same principle as the app's existing `.hud-btn`/`.chip` min-height rules.

---

## 4. Prioritized Implementation Roadmap

Waves are ordered so dependencies land first. Each wave = 3-6 features, sized for one implementation-subagent dispatch (see `docs/ORCHESTRATION.md` §4). Complexity: **S** = small (a few focused functions, similar scope to one existing `MODDB` entry or `EM` op), **M** = medium (new subsystem or UI surface, similar scope to the sculpt or 3D-paint systems), **L** = large (new architecture layer, similar scope to the entire `EM` mesh-edit system).

Phase letters match `docs/ORCHESTRATION.md` §3 (A=modeling, B=foundations, C=rigging, D=animation, E=output, F=polish).

### Phase A — Modeling parity (all in `index.html`)

| Wave | Complexity | Features | Touches |
|---|---|---|---|
| **A1** | S | Vertex/Edge Slide · Shrink/Fatten (per-normal) · Rip/Split · Randomize vertices · edit-mode Shear (selection-scoped) | `EM` (new methods), `panelEdit`, `renderEditHud` |
| **A2** | M | Knife tool (tap-tap-confirm, §3) · Spin (lathe revolve around picked axis) · Screw (Spin + step offset) | `EM`, `editState` (new `tool:'knife'`), `panelEdit`, `renderEditHud`, main `pointerdown/move/up` handlers |
| **A3** | S-M | Vertex-bevel · N-edge-loop Bridge (extend `bridgeEdges`) · Loop-cut slide · variable bevel width/segments · Symmetrize | `EM.bevelEdges`/`bridgeEdges`/`loopCut` extensions |
| **A4** | M | Seams (edge flag) · Project-from-view unwrap (reuse `do3dPaint` projection math) · Pack islands · minimal UV Editor mode in the `paint2d` split view | `EM.E` (seam flag), `ensureAtlasUVs`/`_facesToGeo`, `panelPaint` |
| **A5** | S-M | Vertex groups (named float-weight arrays per part) · basic assign/remove-from-group UI | model `userData` (new `vgroups`), new panel section — **this is also Phase B's dependency, land it here or as B1** |
| **A6** | M | Decimate modifier (edge-collapse simplify) · true Catmull-Clark upgrade for Subdivide Smooth · texture-map-driven Displace | `MODDB` (new/upgraded entries), `geoToVF`/`subdivStep`/`vfToGeo` |
| **A7** | M | Lattice modifier (FFD cage) · Shrinkwrap modifier · Cast (cylinder/cube variants) · Skin modifier | `MODDB` (new entries) |
| **A8** | L | Boolean modifier (union/diff/intersect) via vendored compact BSP CSG | new script section, `MODDB` (new `kind:'boolean'` needing a second target object), `panelBuild`/`panelScene` target-pair picker |
| **A9** | M | Bezier curve object (new type parallel to `state.models`) · curve-to-mesh (extrude/bevel profile) · Array-along-curve | new `CURVES`/curve system, `panelBuild` extension |
| **A10** | M | Text objects: canvas-billboard first pass (S), then true 3D extruded text via a vendored font-glyph parser (M) | new text-object type, `tex()`-style canvas helper reuse, `ExtrudeGeometry` |
| **A11** | L, stretch | Voxel remesh (marching cubes over an SDF sample of the current mesh) | new remesh module, likely its own `MODDB` entry or standalone tool |

### Phase B — Foundations for rigging/animation

| Wave | Complexity | Features | Touches |
|---|---|---|---|
| **B1** | M | Weight painting (reuse `Sculpt` touch pipeline, write to `vgroups` from A5 instead of displacing verts) · color-ramp weight visualization material | new `WeightPaint` object mirroring `Sculpt`, `panelEdit` or new tab |
| **B2** | S-M | Serialization format v2: carry vertex groups, weights, (later) shape keys and skeleton through `saveProject`/`loadProject`/autosave and through the localStorage bridge to `animate.html` | `buildProjectData`, `loadProject`, `doAutosave` |
| **B3** | M | Shape keys / morph targets (duplicate-to-`EM`, sculpt/edit, diff → morph target, blend slider) | `EM.V` snapshot/diff reuse, `geometry.morphAttributes`, `panelViewer` extension |
| **B4** | S | Vertex colors (paint + material `vertexColors:true`) | extends the B1 touch-paint pipeline to a second data channel |

### Phase C — `animate.html`: rigging

| Wave | Complexity | Features | Touches |
|---|---|---|---|
| **C1** | L | Armatures: bone chain edit-tool (extrude-to-add-bone, reusing `EM.extrude`'s click-to-extend UX) · `THREE.Bone`/`Skeleton` construction · parenting | new `animate.html`, new Armature object type, `Gizmo`-pattern rotate handles |
| **C2** | M | Bind mesh to skeleton (`SkinnedMesh`) using B1's vertex groups as explicit skin weights · automatic-weights approximation (inverse-distance-to-bone-segment, clearly labeled non-heat-diffusion) | skinning bind code, GLB import/export extension for skins (currently absent — `importGLB`/`exportGLB` need skin support added) |
| **C3** | S-M | FK posing (rotate gizmo per bone) · CCD IK solver (2-4 bone chains) · pole targets | reuse `Gizmo`/`RotBall` rotate math |
| **C4** | S | Constraints: Copy Location, Copy Rotation, Track-To, Limit (location/rotation/scale) | per-frame evaluation pass before render |

### Phase D — `animate.html`: animation

| Wave | Complexity | Features | Touches |
|---|---|---|---|
| **D1** | M-L | **Keyframe core**: generic `Track`/`Keyframe` model, dotted-path property resolver, "insert keyframe" action wired to every relevant slider (reuse `slider()`), linear interpolation first pass, per-frame sampler | new `animate.html` core data model — the load-bearing wave everything else in D/E depends on |
| **D2** | S-M | Timeline + playback transport (play/pause/loop/fps), scrub bar (reuse `#zkSlider`/`hudSlider` touch-drag pattern) | new timeline UI |
| **D3** | M | Dope Sheet (track rows + keyframe diamonds, drag-to-retime) | new dope-sheet UI, built on D1 |
| **D4** | L | Graph Editor: per-track Bezier/linear/constant interpolation curves, draggable handles + numeric fallback (§3) | new canvas curve editor, built on D1 |
| **D5** | M | Camera animation (camera as a keyframeable object) · Path-follow animation (depends on A9 curves) | Track targetPath support for camera + curve-relative params |
| **D6** | M-L | NLA-style action clips (named clip wrapping a track range, sequential playback first, blending later) | new Action data model wrapping Track sets |
| **D7** | M-L | Onion skinning (N translucent ghost pose evaluations at nearby frames) | fast pose-at-time(t) evaluation path, ghost material |

### Phase E — Output (the two unique requirements)

| Wave | Complexity | Features | Touches |
|---|---|---|---|
| **E1** | M-L | Render animation to video: fixed-timestep render loop through the D1 sampler → `canvas.captureStream()` → `MediaRecorder` → WebM (guaranteed path) with progress UI; MP4 via WebCodecs as progressive enhancement where supported | new `exportVideo()` in `animate.html`, reuses `renderScenePNG`'s camera/resolution setup pattern |
| **E2** | M | Standalone Three.js code export: serialize geometry/materials (reuse `exportGLB`'s embedding technique) + Track/keyframe data + skeleton, emit a self-contained HTML snippet with a trimmed copy of the D1 sampler runtime, "copy to clipboard"/"download .html" | new `exportStandaloneJS()`, shares code with the D1 runtime by design (build once, embed twice) |

### Phase F — Polish & stretch goals

| Wave | Complexity | Features |
|---|---|---|
| **F1** | S | Camera near/far clip exposure, depth-of-field post-process |
| **F2** | M | Multiple material slots per part (per-face material assignment) |
| **F3** | M | Normal/roughness/metalness/AO map painting (multi-channel `paint` object) |
| **F4** | M, stretch | Simple particle system (emitter + gravity/drag, no collision) |
| **F5** | L, stretch | Best-effort mass-spring cloth (pinned vertices, no self-collision) |
| **F6** | L, stretch | Basic impulse rigid-body demo (sphere/box drop-and-bounce only) |
| **F7** | — | Perf passes on meshes >50k tris, cross-view theming consistency sweep, doc updates |

---

## 5. Summary of the biggest structural gaps

1. **No animation system at all** — zero keyframes, zero timeline. This is the largest single gap and the reason Phase D exists as its own multi-wave arc; almost everything in rigging (Phase C) exists to feed it.
2. **No rigging** — no bones, no weights, no vertex groups. Phase B/C is a from-scratch build; Three.js r128's native `Skeleton`/`SkinnedMesh` support means the runtime is free, but every authoring tool (bone edit, weight paint, IK) has to be written.
3. **No true UV unwrap** — the current per-face atlas is clever for non-destructive painting but produces unusable UVs for anything else (baking, external tools, clean texel density). LSCM itself is HARD; the planar-projection-per-island approximation (§2.6) is the pragmatic middle ground.
4. **Boolean and Decimate are the two modeling ops most likely to be requested and are absent** — both FEASIBLE but nontrivial (L and M respectively); sequence them after the cheaper edit-ops wins in A1-A4.
5. **Both "unique" output requirements (video export, standalone code export) are entirely unbuilt** but rate as FEASIBLE — they're naturally the very last waves since they depend on the animation runtime existing first.
