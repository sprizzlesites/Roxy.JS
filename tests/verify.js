// Headless verification of Roxy.JS: boot, view switching, mesh ops, paint, export.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').resolve(__dirname, '..');
const SP = __dirname;

// Debug handles injected inside the app IIFE (test copy only — repo file untouched)
const INJECT = `
window.__R={setView:setView,EM:EM,editState:editState,Sculpt:Sculpt,Knife:Knife,getModel:getModel,state:state,paint:paint,paintInit:paintInit,applyPaintTex:applyPaintTex,ensureAtlasUVs:ensureAtlasUVs,do3dPaint:do3dPaint,exportOBJ:exportOBJ,parseOBJ:parseOBJ,History:History,addModel:addModel,buildDonut:buildDonut,doAutosave:doAutosave,clearAutosave:clearAutosave,AUTOSAVE_KEY:AUTOSAVE_KEY,active:active,addPrim:addPrim,renameModel:renameModel,duplicateModel:duplicateModel,deleteModel:deleteModel,renderAssets:renderAssets,filterAssetGrid:filterAssetGrid,setAssetQuery:function(q){assetSearchQuery=q;filterAssetGrid();},applyEditSnap:applyEditSnap,addPlacement:addPlacement,sceneScene:sceneScene,disposeModelResources:disposeModelResources,resetHintsSeen:function(){try{localStorage.removeItem('roxyHints');}catch(e){}},syncPaintHud:syncPaintHud,snapView:snapView,pickColorAt2D:pickColorAt2D,pickColorAt3D:pickColorAt3D,setPaintColor:setPaintColor,setActiveModel:setActiveModel,resizeActive:resizeActive,renderEditHud:renderEditHud,makeModel:makeModel,makeMaterial:makeMaterial,rebuildModel:rebuildModel,tex:tex,addLight:addLight,frameObject:frameObject,viewState:viewState,invalidate:invalidate};
window.__setDownload=function(fn){download=fn;};
`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index.html')) {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const anchor = "\n})();\n</script>";
    if (!html.includes(anchor)) { res.writeHead(500); res.end('anchor missing'); return; }
    html = html.replace(anchor, "\n" + INJECT + "\n})();\n</script>");
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
  }
  res.writeHead(404); res.end('nf');
});

(async () => {
  await new Promise(r => server.listen(8931, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone-ish
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  // Serve three.js r128 (and kill font requests) — cdnjs is policy-blocked here
  await page.route('**/three.js/r128/three.min.js', route =>
    route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(SP, 'node_modules/three/build/three.min.js'), 'utf8') }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());

  await page.goto('http://127.0.0.1:8931/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__R && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 })
    .catch(() => errors.push('BOOT: never finished'));

  const step = async (name, fn) => {
    try { await fn(); console.log('ok  ' + name); }
    catch (e) { errors.push('STEP ' + name + ': ' + e.message.split('\n')[0]); console.log('ERR ' + name); }
  };

  for (const v of ['viewer', 'paint', 'build', 'scene', 'assets', 'edit']) {
    await step('view:' + v, () => page.evaluate(v => __R.setView(v), v));
    await page.waitForTimeout(120);
  }

  await step('fromPrim+subdivide', () => page.evaluate(() => { __R.EM.fromPrim('Cube'); __R.EM.subdivide(); }));
  await step('face ops', () => page.evaluate(() => {
    var R = __R; R.editState.mode = 'face'; R.EM.clearSel(); R.EM.F[0].sel = true;
    R.EM.extrude(); R.EM.inset(); R.EM.duplicateSelection();
  }));
  await step('edge ops', () => page.evaluate(() => {
    var R = __R; R.editState.mode = 'edge'; R.EM.clearSel(); R.EM.E[0].sel = true;
    R.EM.selectLoops(); R.EM.bevelEdges();
  }));
  await step('vert ops', () => page.evaluate(() => {
    var R = __R; R.editState.mode = 'vert'; R.EM.clearSel(); R.EM.V[0].sel = true; R.EM.V[1].sel = true;
    R.EM.smoothVerts(); R.EM.mergeSelected();
  }));
  await step('mirror grab: off-plane vertex mirrors, on-plane vertex stays pinned', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube'); // BoxGeometry(...,2,2,2) has both a +/-X ring and an x=0 middle ring
    R.editState.mode = 'vert'; EM.clearSel();
    R.editState.prop = false; R.editState.mirror = true; EM._mirMap = null;

    // Off-plane case: moving a +X vertex in Y must move its mirror partner the same amount in Y
    var idx = -1; for (var i = 0; i < EM.V.length; i++) if (EM.V[i].x > 0.1) { idx = i; break; }
    if (idx < 0) throw new Error('test setup: no +X vertex found');
    // Find the mirror partner independently (not via EM._mirrorMap — that's the code under test)
    var mirrorIdx = -1;
    for (var j = 0; j < EM.V.length; j++) {
      if (j === idx) continue;
      if (Math.abs(EM.V[j].x + EM.V[idx].x) < 1e-4 && Math.abs(EM.V[j].y - EM.V[idx].y) < 1e-4 && Math.abs(EM.V[j].z - EM.V[idx].z) < 1e-4) { mirrorIdx = j; break; }
    }
    if (mirrorIdx < 0) throw new Error('test setup: no mirror partner found for the +X vertex');
    var beforeY = EM.V[idx].y, beforeMirrorY = EM.V[mirrorIdx].y, beforeMirrorX = EM.V[mirrorIdx].x;
    EM.V[idx].sel = true;
    EM.grab(new THREE.Vector3(0, 0.3, 0));
    if (Math.abs(EM.V[idx].y - (beforeY + 0.3)) > 1e-9) throw new Error('selected vertex did not move by the drag delta');
    if (Math.abs(EM.V[mirrorIdx].y - (beforeMirrorY + 0.3)) > 1e-6) throw new Error('mirror partner did not move in Y — mirroring did not apply');
    if (Math.abs(EM.V[mirrorIdx].x - beforeMirrorX) > 1e-9) throw new Error('mirror partner X drifted — should only track Y here');
    EM.clearSel(); EM._mirMap = null;

    // On-plane case: an x≈0 vertex must stay pinned to the plane even when dragged sideways
    var onPlane = -1; for (var k = 0; k < EM.V.length; k++) if (Math.abs(EM.V[k].x) < 1e-4) { onPlane = k; break; }
    if (onPlane < 0) throw new Error('test setup: no on-plane (x=0) vertex found on this cube');
    EM.V[onPlane].sel = true;
    EM.grab(new THREE.Vector3(0.4, 0, 0));
    if (Math.abs(EM.V[onPlane].x) > 1e-9) throw new Error('on-plane vertex drifted off the mirror plane, got x=' + EM.V[onPlane].x);

    EM.clearSel(); EM._mirMap = null; R.editState.mirror = false;
  }));

  // ---- Wave A1: Slide / Shrink-Fatten / Rip / Randomize / Shear ----
  await step('vertex slide constrains the drag onto an adjacent edge line', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Plane'); // native quad grid, flat in the XZ plane
    R.editState.mode = 'vert'; EM.clearSel();
    var adj = EM._adjacency();
    var idx = -1; for (var i = 0; i < adj.length; i++) if (adj[i].length === 4) { idx = i; break; }
    if (idx < 0) throw new Error('test setup: no interior (degree-4) grid vertex found');
    EM.V[idx].sel = true;
    if (!EM._slideApplicable()) throw new Error('slide should be applicable with exactly one vertex selected in Vert mode');
    EM.V[EM.V.length - 1].sel = true; // a 2nd vertex should turn it off again
    if (EM._slideApplicable()) throw new Error('slide should NOT be applicable with 2+ vertices selected in Vert mode');
    EM.V[EM.V.length - 1].sel = false;
    var before = EM.V[idx].clone();
    var neighborDirs = adj[idx].map(function (j) { return EM.V[j].clone().sub(before).normalize(); });
    EM.slideDelta(new THREE.Vector3(0.5, 0.2, 0.05)); // deliberately off-axis — free grab would follow this exactly
    var moveVec = EM.V[idx].clone().sub(before);
    if (moveVec.length() < 1e-6) throw new Error('slide did not move the selected vertex at all');
    var onALine = neighborDirs.some(function (d) { return Math.abs(Math.abs(d.dot(moveVec.clone().normalize())) - 1) < 1e-4; });
    if (!onALine) throw new Error('slid vertex left every adjacent-edge line — moved freely instead of sliding, moveVec=' + JSON.stringify(moveVec));
    EM.clearSel();
  }));

  await step('shrinkFatten offsets every selected vertex along its own normal by the given signed distance', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Sphere');
    R.editState.mode = 'vert'; EM.clearSel(); EM.V.forEach(function (v) { v.sel = true; });
    var before = EM.V.map(function (v) { return v.clone(); });
    var N = EM._vertNormalsWeighted(); // same normals shrinkFatten itself uses
    var dist = 0.3;
    EM.shrinkFatten(dist);
    for (var i = 0; i < EM.V.length; i++) {
      var expected = before[i].clone().addScaledVector(N[i], dist);
      if (EM.V[i].distanceTo(expected) > 1e-4) throw new Error('vertex ' + i + ' did not move along its own normal by the given distance');
    }
    EM.clearSel(); R.History.undo(); // leave no dangling vert-history entry for later steps' meshes
  }));

  await step('rip duplicates a shared vertex, grows the vert count, and opens a new boundary edge', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube'); // closed quad box — starts with zero boundary edges
    var boundaryBefore = EM.E.filter(function (e) { return e.fi.length === 1; }).length;
    if (boundaryBefore !== 0) throw new Error('test setup: a fresh cube should have no boundary edges, got ' + boundaryBefore);
    var vi = -1; for (var i = 0; i < EM.V.length && vi < 0; i++) { var t = 0; EM.F.forEach(function (f) { if (f.vi.indexOf(i) >= 0)t++; }); if (t >= 2) vi = i; }
    if (vi < 0) throw new Error('test setup: no vertex touching 2+ faces found on a cube');
    R.editState.mode = 'vert'; EM.clearSel(); EM.V[vi].sel = true;
    var vCountBefore = EM.V.length;
    EM.rip();
    if (EM.V.length !== vCountBefore + 1) throw new Error('rip should add exactly one duplicate vertex, went from ' + vCountBefore + ' to ' + EM.V.length);
    var boundaryAfter = EM.E.filter(function (e) { return e.fi.length === 1; }).length;
    if (boundaryAfter <= boundaryBefore) throw new Error('rip should open at least one new boundary edge, boundary count stayed at ' + boundaryAfter);
    EM.clearSel();
  }));

  await step('randomize jitters selected verts along their normals, deterministic for a fixed seed', () => page.evaluate(() => {
    var R = __R, EM = R.EM, History = R.History;
    EM.fromPrim('Icosphere');
    R.editState.mode = 'vert'; EM.clearSel(); EM.V.forEach(function (v) { v.sel = true; });
    var seed = 7, amount = 0.15;
    var before = EM.V.map(function (v) { return v.clone(); });
    EM.randomize(amount, seed);
    var afterFirst = EM.V.map(function (v) { return v.clone(); });
    var moved = false; for (var i = 0; i < EM.V.length; i++) if (afterFirst[i].distanceTo(before[i]) > 1e-6) { moved = true; break; }
    if (!moved) throw new Error('randomize did not move any vertex');
    History.undo();
    for (var i = 0; i < EM.V.length; i++) if (EM.V[i].distanceTo(before[i]) > 1e-6) throw new Error('undo did not restore pre-randomize positions at vertex ' + i);
    EM.randomize(amount, seed); // same seed, same starting positions
    for (var i = 0; i < EM.V.length; i++) if (EM.V[i].distanceTo(afterFirst[i]) > 1e-6) throw new Error('randomize with the same seed was not deterministic at vertex ' + i);
    History.undo();
  }));

  await step('edit-mode shear displaces the selection proportionally to distance from its OWN centroid', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Plane'); // flat in XZ (y=0) — Z varies across it, a real proportional axis to shear against
    R.editState.mode = 'vert'; EM.clearSel(); EM.V.forEach(function (v) { v.sel = true; });
    R.editState.shearPair = 1; // SHEAR_PAIRS[1] = [dispAxis=X(0), refAxis=Z(2)]
    var before = EM.V.map(function (v) { return v.clone(); });
    var c = new THREE.Vector3(); before.forEach(function (v) { c.add(v); }); c.divideScalar(before.length);
    var amount = 0.4;
    EM.shearSelection(amount);
    for (var i = 0; i < EM.V.length; i++) {
      var expectedX = before[i].x + (before[i].z - c.z) * amount;
      if (Math.abs(EM.V[i].x - expectedX) > 1e-6) throw new Error('vertex ' + i + ' X not sheared proportionally to its distance from the selection centroid on Z');
      if (Math.abs(EM.V[i].y - before[i].y) > 1e-9 || Math.abs(EM.V[i].z - before[i].z) > 1e-9) throw new Error('vertex ' + i + ' Y/Z should stay put for an X-displacement shear');
    }
    EM.clearSel(); R.History.undo(); // leave no dangling vert-history entry for later steps' meshes
  }));

  // ---- Wave A2: Knife / Spin / Screw ----
  await step('knife cuts across a cube face: +1 face, +2 verts, both new verts on the cut plane', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube');
    var fi = 0, f = EM.F[fi];
    if (f.vi.length !== 4) throw new Error('test setup: expected a quad face at EM.F[0]');
    var e0 = EM._edgeIndexFor(f.vi[0], f.vi[1]), e2 = EM._edgeIndexFor(f.vi[2], f.vi[3]);
    if (e0 < 0 || e2 < 0) throw new Error('test setup: could not find the two opposite boundary edges of the face');
    var mid0 = EM.V[EM.E[e0].a].clone().lerp(EM.V[EM.E[e0].b], 0.5);
    var mid1 = EM.V[EM.E[e2].a].clone().lerp(EM.V[EM.E[e2].b], 0.5);
    var corner = EM.V[EM.E[e0].a];
    // the face is axis-aligned (a fresh cube quad) — find which coordinate is constant across it
    var axis = -1;
    ['x', 'y', 'z'].forEach(function (ax) { if (Math.abs(mid0[ax] - mid1[ax]) < 1e-6 && Math.abs(mid0[ax] - corner[ax]) < 1e-6) axis = ax; });
    if (axis === -1) throw new Error('test setup: could not determine the face\'s constant axis');
    var vBefore = EM.V.length, fBefore = EM.F.length;
    // synthetic cut points — exactly what Knife.tap would produce after snapping two taps to
    // these two edges, called directly (no pointer events) per the geometric-core requirement
    var ok = EM.knifeCore([{ type: 'edge', ei: e0, t: 0.5, fi: fi }, { type: 'edge', ei: e2, t: 0.5, fi: fi }]);
    if (!ok) throw new Error('knifeCore reported no cut');
    if (EM.V.length !== vBefore + 2) throw new Error('expected exactly 2 new cut vertices, got +' + (EM.V.length - vBefore));
    if (EM.F.length !== fBefore + 1) throw new Error('expected the face count to grow by exactly 1 (one face split into two), got +' + (EM.F.length - fBefore));
    var v0 = EM.V[vBefore], v1 = EM.V[vBefore + 1];
    if (v0.distanceTo(mid0) > 1e-6) throw new Error('first cut vertex is not at the expected edge midpoint');
    if (v1.distanceTo(mid1) > 1e-6) throw new Error('second cut vertex is not at the expected edge midpoint');
    if (Math.abs(v0[axis] - corner[axis]) > 1e-6 || Math.abs(v1[axis] - corner[axis]) > 1e-6) throw new Error('cut vertices are not on the face\'s cut plane');
    // no crack left behind: every edge of the cut face's two new sub-faces must still be shared
    // by exactly the faces that touch it (rebuilt edge list has no stray 1-face boundary where
    // the original interior edges used to be 2-face)
    EM._buildEdges();
    var openBoundary = EM.E.filter(function (e) { return e.fi.length === 1; }).length;
    if (openBoundary !== 0) throw new Error('cutting an interior face of a closed cube should not open any new boundary edges, got ' + openBoundary);
  }));

  await step('knife tool: K toggles the tool and the HUD confirm/undo/cancel row', () => page.evaluate(() => {
    var R = __R;
    R.setView('edit'); R.EM.fromPrim('Cube');
    R.editState.tool = 'select';
    var evt = new KeyboardEvent('keydown', { key: 'k' });
    window.dispatchEvent(evt);
    if (R.editState.tool !== 'knife') throw new Error('K did not switch editState.tool to knife');
    R.renderEditHud();
    var hud = document.getElementById('editHud');
    if (!/Confirm/i.test(hud.textContent)) throw new Error('knife HUD did not render a Confirm control');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    if (R.editState.tool !== 'select') throw new Error('K did not toggle back to select');
  }));

  await step('spin revolves a profile around an axis: welded vert count and every spun vertex keeps its source radius', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Plane'); EM.clear();
    var p0 = new THREE.Vector3(1, 0, 0); p0.sel = true;
    var p1 = new THREE.Vector3(1.5, 1, 0); p1.sel = true;
    var p2 = new THREE.Vector3(2, 2, 0); p2.sel = true;
    EM.V = [p0, p1, p2]; EM.F = []; EM.E = [];
    R.editState.mode = 'vert';
    R.editState.spinAxis = 1; // Y
    R.editState.spinOriginWorld = true; // origin = world 0,0,0 (all 3 profile verts are off-axis)
    R.editState.spinAngle = 360;
    R.editState.spinSteps = 8;
    var vBefore = EM.V.length; // 3
    EM.spin();
    // a full 360°, zero-offset spin welds the seam by reusing the original profile verts for the
    // final ring, so only (steps-1) NEW rings of 3 verts each are created
    var expectedAdded = 3 * (R.editState.spinSteps - 1);
    if (EM.V.length !== vBefore + expectedAdded) throw new Error('unexpected vert count after spin: got +' + (EM.V.length - vBefore) + ', expected +' + expectedAdded);
    var radii = [1, 1.5, 2];
    for (var i = 0; i < EM.V.length; i++) {
      var v = EM.V[i], r = Math.sqrt(v.x * v.x + v.z * v.z);
      var ok = radii.some(function (rr) { return Math.abs(rr - r) < 1e-4; });
      if (!ok) throw new Error('vertex ' + i + ' radius ' + r + ' from the Y axis does not match any source profile radius');
    }
  }));

  await step('screw sweeps a profile helically: axis coordinate rises monotonically and matches offset×revolutions', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Plane'); EM.clear();
    var q0 = new THREE.Vector3(1, 0, 0); q0.sel = true;
    var q1 = new THREE.Vector3(1, 0, 0.6); q1.sel = true; // 2-vertex profile, both off-axis
    EM.V = [q0, q1]; EM.F = []; EM.E = [];
    R.editState.mode = 'vert';
    R.editState.spinAxis = 1; // Y
    R.editState.spinOriginWorld = true;
    R.editState.spinSteps = 8;
    R.editState.screwOffset = 0.5; // per full revolution
    R.editState.screwRevs = 3;
    EM.screw();
    // every 2 consecutive verts are one ring (profile has 2 verts); track ring 0's Y coordinate
    var ys = [];
    for (var i = 0; i < EM.V.length; i += 2) ys.push(EM.V[i].y);
    if (ys.length < 2) throw new Error('screw produced too few rings to check monotonicity');
    for (var j = 1; j < ys.length; j++) if (ys[j] <= ys[j - 1] - 1e-9) throw new Error('screw did not raise the axis coordinate monotonically: ' + JSON.stringify(ys));
    var totalRise = ys[ys.length - 1] - ys[0], expectedRise = R.editState.screwOffset * R.editState.screwRevs;
    if (Math.abs(totalRise - expectedRise) > 1e-4) throw new Error('total screw rise ' + totalRise + ' does not match offset×revolutions=' + expectedRise);
  }));

  await step('sculpt dabs all brushes actually move geometry', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    ['draw', 'carve', 'crease', 'inflate', 'smooth', 'flatten', 'pinch'].forEach(function (br) {
      EM.fromPrim('Sphere'); R.Sculpt._adj = EM._adjacency(); // fresh mesh per brush, isolates each check
      var before = EM.V.map(function (v) { return v.clone(); });
      R.Sculpt.brush = br;
      R.Sculpt._dab(new THREE.Vector3(0, .6, 0), new THREE.Vector3(0, 1, 0));
      var moved = false;
      for (var i = 0; i < EM.V.length; i++) if (EM.V[i].distanceTo(before[i]) > 1e-6) { moved = true; break; }
      if (!moved) throw new Error('brush "' + br + '" did not move any vertex');
    });
    EM._syncPositions();
  }));
  await step('alignSelection', () => page.evaluate(() => {
    var R = __R; R.EM.fromPrim('Cube'); R.editState.mode = 'vert'; R.EM.clearSel();
    R.EM.V[0].sel = true; R.EM.V[1].sel = true; R.EM.V[2].sel = true;
    R.EM.alignSelection(1);
    var y0 = R.EM.V[0].y;
    if (Math.abs(R.EM.V[1].y - y0) > 1e-9 || Math.abs(R.EM.V[2].y - y0) > 1e-9) throw new Error('verts not coplanar after align');
  }));
  await step('exportToModel (no tex)', () => page.evaluate(() => { __R.EM.exportToModel(); }));

  await step('textured export keeps uv+map', () => page.evaluate(() => {
    var R = __R;
    var m = R.getModel(R.state.activeId);
    R.paintInit(); R.applyPaintTex();
    R.EM.fromModel(m, 0);
    if (!R.EM._srcTex) throw new Error('srcTex not captured');
    R.EM.subdivide();
    R.EM.exportToModel();
    var nm = R.getModel(R.state.activeId);
    if (!nm.userData.parts[0].mat.map) throw new Error('exported without texture');
    if (!nm.userData.parts[0].mesh.geometry.attributes.uv) throw new Error('exported without uv');
    var uv = nm.userData.parts[0].mesh.geometry.attributes.uv.array, nz = 0;
    for (var i = 0; i < uv.length; i++) if (uv[i] !== 0) nz++;
    if (!nz) throw new Error('exported uvs all zero');
  }));

  await step('ensureAtlasUVs+do3dPaint', () => page.evaluate(() => {
    var R = __R; R.setView('paint'); R.paint.mode3d = true;
    // #slot-paint is display:none on mobile until this class is added (what the real
    // "Paint on 3D surface" button does) — without it the canvas has a 0x0 rect and
    // do3dPaint's raycast silently hits nothing.
    document.querySelector('[data-view=paint]').classList.add('mode3d');
    R.resizeActive();
    var m = R.getModel(R.state.activeId);
    R.ensureAtlasUVs(m, 0);
    var before = R.paint.ctx.getImageData(0, 0, 1024, 1024).data.slice();
    R.do3dPaint(180, 300);
    var after = R.paint.ctx.getImageData(0, 0, 1024, 1024).data;
    var changed = false;
    for (var i = 0; i < before.length; i += 4) if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) { changed = true; break; }
    if (!changed) throw new Error('do3dPaint did not change any texture pixels — the raycast likely missed the mesh');
  }));

  await step('3D paint on a proper-UV model is non-destructive (no atlas rebake/scramble on toggle)', () => page.evaluate(() => {
    var R = __R;
    R.state.models.length = 0;
    var d = R.buildDonut(); d.userData.parts[0]._hasProperUVs = true; // simulate an imported GLB with a real unwrap
    R.addModel(d); R.setActiveModel(d.userData.id);
    R.setView('paint'); R.paint.mode3d = true; R.paint.part = 0;
    document.querySelector('[data-view=paint]').classList.add('mode3d'); R.resizeActive();
    var part = R.getModel(R.state.activeId).userData.parts[0];
    var g0 = part.mesh.geometry;
    // snapshot the ORIGINAL indexed unwrap so we can prove each un-indexed corner still
    // carries the exact UV it was expanded from (as opposed to a repacked atlas tile)
    var idx0 = g0.index ? Array.prototype.slice.call(g0.index.array) : null;
    var uv0 = g0.attributes.uv, origUV = [];
    for (var i = 0; i < uv0.count; i++) origUV.push([uv0.getX(i), uv0.getY(i)]);
    function canvasSig() { var ctx = R.paint.ctx, s = ''; for (var y = 0; y < 1024; y += 128) for (var x = 0; x < 1024; x += 128) { var dd = ctx.getImageData(x, y, 1, 1).data; s += dd[0] + ',' + dd[1] + ',' + dd[2] + ';'; } return s; }
    var beforeCanvas = canvasSig();
    // this is exactly what toggling "Paint on 3D surface" ON triggers:
    R.ensureAtlasUVs(R.getModel(R.state.activeId), 0);
    var g1 = R.getModel(R.state.activeId).userData.parts[0].mesh.geometry;
    if (g1.index) throw new Error('geometry must be un-indexed for do3dPaint face addressing');
    if (!part._atlasUVs) throw new Error('_atlasUVs guard not set — would rebake on every toggle');
    // Each un-indexed UV must equal the ORIGINAL UV it was expanded from (g1.uv[k] === uv0[idx0[k]]).
    // An atlas repack would instead produce per-face normalized tile coords — this check fails hard for that.
    var uv1 = g1.attributes.uv;
    if (idx0 && uv1.count !== idx0.length) throw new Error('un-indexed vertex count mismatch');
    for (var k = 0; k < uv1.count; k++) {
      var src = idx0 ? origUV[idx0[k]] : origUV[k];
      if (Math.abs(uv1.getX(k) - src[0]) > 1e-5 || Math.abs(uv1.getY(k) - src[1]) > 1e-5)
        throw new Error('UV at corner ' + k + ' was altered (got ' + uv1.getX(k).toFixed(4) + ',' + uv1.getY(k).toFixed(4) + ' expected ' + src[0].toFixed(4) + ',' + src[1].toFixed(4) + ') — atlas repack instead of non-destructive un-index');
    }
    // the painted texture canvas must be untouched (no lossy rebake) — this is the actual bug
    if (canvasSig() !== beforeCanvas) throw new Error('paint canvas was rebaked/scrambled — 3D paint toggle is not non-destructive');
    // painting must still work on this path
    var b = R.paint.ctx.getImageData(0, 0, 1024, 1024).data.slice();
    R.do3dPaint(180, 300);
    var a = R.paint.ctx.getImageData(0, 0, 1024, 1024).data, changed = false;
    for (var i = 0; i < b.length; i += 4) if (b[i] !== a[i] || b[i + 1] !== a[i + 1] || b[i + 2] !== a[i + 2]) { changed = true; break; }
    if (!changed) throw new Error('do3dPaint did not paint on the non-destructive proper-UV path');
  }));

  await step('OBJ import flags real UVs as proper (so 3D paint stays non-destructive)', () => page.evaluate(() => {
    var R = __R;
    var withUV = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n';
    var noUV = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
    var g1 = R.parseOBJ(withUV);
    if (!g1.userData.hasUV) throw new Error('parseOBJ did not flag an OBJ that has vt lines as having UVs');
    var m1 = R.makeModel('withUV', [{ geo: g1, mat: R.makeMaterial({ color: 0xffffff }), _hasProperUVs: g1.userData.hasUV }]);
    if (!m1.userData.parts[0]._hasProperUVs) throw new Error('imported OBJ with real UVs did not get _hasProperUVs — 3D paint would scramble it');
    var g2 = R.parseOBJ(noUV);
    if (g2.userData.hasUV) throw new Error('parseOBJ wrongly flagged a UV-less OBJ as having UVs (would skip the atlas it needs)');
  }));

  await step('mesh-editor export inherits real-unwrap status from the source (not texture flipY)', () => page.evaluate(() => {
    var R = __R;
    function editExport(sourceProper) {
      R.state.models.length = 0;
      var cv = document.createElement('canvas'); cv.width = cv.height = 64; cv.getContext('2d').fillStyle = '#abcdef'; cv.getContext('2d').fillRect(0, 0, 64, 64);
      var canvasTex = R.tex(cv, true, [1, 1]); // CanvasTexture -> flipY = true (like a painted model)
      var mat = R.makeMaterial({ color: 0xffffff }); mat.map = canvasTex;
      var part = { geo: new THREE.BoxGeometry(1, 1, 1, 1, 1, 1), mat: mat };
      if (sourceProper) part._hasProperUVs = true;
      var src = R.makeModel('src', [part]); R.addModel(src); R.setActiveModel(src.userData.id);
      R.EM.fromModel(src, 0); R.EM.exportToModel();
      var exp = R.state.models[R.state.models.length - 1];
      return !!exp.userData.parts[0]._hasProperUVs;
    }
    // a proper-UV source painted (flipY=true canvas) must still export as proper-UV
    if (!editExport(true)) throw new Error('editing a proper-UV (but painted) model exported _hasProperUVs=false — would scramble on re-paint');
    // a non-proper source (overlapping UVs) must stay non-proper so it keeps the atlas it needs
    if (editExport(false)) throw new Error('editing an overlapping-UV model wrongly exported _hasProperUVs=true');
  }));

  await step('modifier rebuild keeps a 3D-painted model consistent (atlas re-derived, canvas not rebaked)', () => page.evaluate(() => {
    var R = __R;
    function canvasSig() { var ctx = R.paint.ctx, s = ''; for (var y = 0; y < 1024; y += 64) for (var x = 0; x < 1024; x += 64) { var d = ctx.getImageData(x, y, 1, 1).data; s += d[0] + ',' + d[1] + ',' + d[2] + ';'; } return s; }
    // ---- atlas-path primitive (overlapping UVs -> needs the per-face atlas) ----
    R.state.models.length = 0;
    var cube = R.makeModel('Cube', [{ geo: new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), mat: R.makeMaterial({ color: 0xffffff }) }]);
    R.addModel(cube); R.setActiveModel(cube.userData.id);
    R.setView('paint'); R.paint.part = 0; R.ensureAtlasUVs(cube, 0);
    var cp = cube.userData.parts[0];
    if (cp.mesh.geometry.index || !cp._atlasUVs) throw new Error('cube did not enter the atlas paint state');
    // put some content on the canvas so "unchanged" is meaningful
    R.paint.ctx.fillStyle = '#123456'; R.paint.ctx.fillRect(100, 100, 400, 400); if (R.paint.tex) R.paint.tex.needsUpdate = true;
    var beforeCanvas = canvasSig();
    cube.userData.mods.push({ def: 'twist', val: 1, on: true }); R.rebuildModel(cube);
    if (cp.mesh.geometry.index) throw new Error('atlas-painted cube reverted to indexed geometry after modifier (UVs no longer match the atlas canvas)');
    if (!cp._atlasUVs) throw new Error('atlas flag lost after modifier — next paint would rebake and scramble');
    if (cp.mesh.geometry.attributes.uv.count % 3 !== 0) throw new Error('geometry is not face-addressable (fi*3) for do3dPaint after modifier');
    if (canvasSig() !== beforeCanvas) throw new Error('modifier rebuild rebaked/altered the paint canvas (keepCanvas failed)');
    // ---- proper-UV model must NOT be re-atlased on rebuild (stays clean indexed) ----
    R.state.models.length = 0;
    var d = R.buildDonut(); d.userData.parts[0]._hasProperUVs = true; R.addModel(d); R.setActiveModel(d.userData.id);
    R.setView('paint'); R.paint.part = 0; R.ensureAtlasUVs(d, 0);
    d.userData.mods.push({ def: 'twist', val: 1, on: true }); R.rebuildModel(d);
    var dp = d.userData.parts[0];
    if (!dp.mesh.geometry.index) throw new Error('proper-UV model was needlessly un-indexed/atlased on modifier rebuild');
    if (dp._atlasUVs) throw new Error('proper-UV model should not carry the atlas flag after a plain modifier rebuild');
  }));

  await step('painting one model does not overwrite another (per-model texture isolation)', () => page.evaluate(() => {
    var R = __R;
    R.state.models.length = 0;
    var A = R.buildDonut(), B = R.buildDonut(); R.addModel(A); R.addModel(B);
    function sample(mat) { var img = mat.map && mat.map.image; if (!img) return 'none'; var c = document.createElement('canvas'); c.width = c.height = 2; c.getContext('2d').drawImage(img, 0, 0, 2, 2); var d = c.getContext('2d').getImageData(1, 1, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; }
    // paint A red
    R.setActiveModel(A.userData.id); R.setView('paint');
    R.paint.ctx.fillStyle = '#ff0000'; R.paint.ctx.fillRect(0, 0, 1024, 1024); R.paint.tex.needsUpdate = true;
    // switch to B (while in paint) and paint it blue
    R.setActiveModel(B.userData.id);
    R.paint.ctx.fillStyle = '#0000ff'; R.paint.ctx.fillRect(0, 0, 1024, 1024); R.paint.tex.needsUpdate = true;
    if (A.userData.parts[0].mat.map.image === B.userData.parts[0].mat.map.image) throw new Error('A and B still share the same canvas — textures not isolated');
    if (sample(A.userData.parts[0].mat) !== '255,0,0') throw new Error('model A texture was overwritten by painting B (got ' + sample(A.userData.parts[0].mat) + ', expected red)');
    if (sample(B.userData.parts[0].mat) !== '0,0,255') throw new Error('model B texture is not blue (got ' + sample(B.userData.parts[0].mat) + ')');
    // switch back to A — its own red texture must reload onto the editor
    R.setActiveModel(A.userData.id);
    if (sample(A.userData.parts[0].mat) !== '255,0,0') throw new Error('model A texture did not persist after round-trip (got ' + sample(A.userData.parts[0].mat) + ')');
  }));

  await step('obj export capture', () => page.evaluate(() => {
    var R = __R, m = R.getModel(R.state.activeId);
    window.__objP = new Promise(function (res) {
      window.__setDownload(function (blob, name) { if (/\.obj$/.test(name)) blob.text().then(res); });
      R.exportOBJ(m, 'test.obj');
    });
  }));
  await step('obj roundtrip has real uvs', () => page.evaluate(() => {
    return window.__objP.then(function (txt) {
      if (!/\nvt /.test(txt)) throw new Error('no vt lines in obj');
      var g = __R.parseOBJ(txt);
      if (!g.attributes.uv) throw new Error('parsed obj lost uv');
      var uv = g.attributes.uv.array, nz = 0;
      for (var i = 0; i < uv.length; i++) if (uv[i] !== 0) nz++;
      if (!nz) throw new Error('parsed obj uvs all zero');
    });
  }));

  await step('undo chain', () => page.evaluate(() => {
    for (var i = 0; i < 5; i++) __R.History.undo();
    for (var i = 0; i < 3; i++) __R.History.redo();
  }));

  await step('collapsible sections persist', () => page.evaluate(() => {
    __R.setView('edit');
    var t = document.querySelector('#panelBody .sec-toggle');
    if (!t) throw new Error('no sec-toggle rendered');
    var title = t.textContent;
    t.click();
    var hidden = t.nextElementSibling && t.nextElementSibling.style.display === 'none';
    if (!hidden) throw new Error('section did not collapse');
    __R.setView('viewer'); __R.setView('edit'); // force re-render
    var t2 = Array.prototype.find.call(document.querySelectorAll('#panelBody .sec-toggle'), function (x) { return x.textContent === title; });
    if (!t2 || !t2.classList.contains('closed')) throw new Error('collapse state lost on re-render');
    t2.click(); // restore open
  }));
  await step('asset thumbnails render', () => page.evaluate(() => {
    __R.setView('assets');
    var imgs = document.querySelectorAll('#assetsBody .thumb-img');
    if (!imgs.length) throw new Error('no thumbnails rendered');
    for (var i = 0; i < imgs.length; i++) if (!/^data:image\/png/.test(imgs[i].src)) throw new Error('thumb src not a data url');
  }));
  await step('mobile chrome present', () => page.evaluate(() => {
    if (getComputedStyle(document.getElementById('tabbar')).display === 'none') throw new Error('tabbar hidden on mobile');
    ['quickUndo', 'paintHud', 'hint', 'zoomKnob'].forEach(function (id) {
      if (!document.getElementById(id)) throw new Error(id + ' missing');
    });
  }));

  await step('live mirror preview ghost', () => page.evaluate(() => {
    var R = __R;
    R.EM.fromPrim('Cube');
    R.editState.mirror = true;
    R.EM._refresh();
    if (!R.EM._mirrorObj) throw new Error('mirror ghost not created when toggled on');
    if (R.EM._mirrorObj.scale.x !== -1) throw new Error('mirror ghost not scale.x=-1');
    if (R.EM._mirrorObj.geometry !== R.EM._meshObj.geometry) throw new Error('mirror ghost geometry not shared with live mesh');
    R.EM.subdivide(); // triggers another _refresh internally
    if (R.EM._mirrorObj.geometry !== R.EM._meshObj.geometry) throw new Error('mirror ghost geometry not kept in sync after an op');
    R.editState.mirror = false;
    R.EM._refresh();
    if (R.EM._mirrorObj) throw new Error('mirror ghost not removed when toggled off');
  }));

  await step('tap-to-type exact slider value (clamped + undoable)', async () => {
    await page.evaluate(() => { __R.setView('build'); __R.addPrim('Cube'); });
    await page.waitForTimeout(50);
    const beforeX = await page.evaluate(() => __R.state.selBuild.position.x);
    let dialogSeen = false;
    const handler = d => { dialogSeen = true; d.accept('999'); }; // way past the -5..5 clamp
    page.once('dialog', handler);
    await page.click('#panelBody .tap-edit'); // first slider readout is Pos X
    await page.waitForTimeout(80);
    if (!dialogSeen) throw new Error('prompt() dialog did not appear on tap');
    const afterX = await page.evaluate(() => __R.state.selBuild.position.x);
    if (afterX !== 5) throw new Error('value not clamped to slider max (got ' + afterX + ')');
    await page.evaluate(() => __R.History.undo());
    const undoneX = await page.evaluate(() => __R.state.selBuild.position.x);
    if (Math.abs(undoneX - beforeX) > 1e-9) throw new Error('undo did not restore prior value (got ' + undoneX + ', expected ' + beforeX + ')');
  });

  await step('rename/duplicate/delete model', async () => {
    await page.evaluate(() => { var R = __R; R.state.models.length = 0; var d = R.buildDonut(); d.userData.name = 'RenTest'; R.addModel(d); });
    const id = await page.evaluate(() => __R.state.models[0].userData.id);
    // rename via prompt()
    let dialogSeen = false;
    page.once('dialog', d => { dialogSeen = true; d.accept('Renamed Donut'); });
    await page.evaluate(id => { var R = __R; R.renameModel(R.getModel(id)); }, id);
    await page.waitForTimeout(50);
    if (!dialogSeen) throw new Error('rename prompt did not appear');
    const nameAfter = await page.evaluate(id => __R.getModel(id).userData.name, id);
    if (nameAfter !== 'Renamed Donut') throw new Error('rename did not apply, got ' + nameAfter);
    await page.evaluate(() => __R.History.undo());
    const nameUndone = await page.evaluate(id => __R.getModel(id).userData.name, id);
    if (nameUndone !== 'RenTest') throw new Error('rename undo failed, got ' + nameUndone);
    // duplicate: independent geometry, not a shared reference
    const countBefore = await page.evaluate(() => __R.state.models.length);
    await page.evaluate(id => { __R.duplicateModel(__R.getModel(id)); }, id);
    const countAfter = await page.evaluate(() => __R.state.models.length);
    if (countAfter !== countBefore + 1) throw new Error('duplicate did not add a model');
    const shared = await page.evaluate(id => {
      var R = __R, orig = R.getModel(id), dup = R.state.models[R.state.models.length - 1];
      return orig.userData.parts[0].mesh.geometry === dup.userData.parts[0].mesh.geometry;
    }, id);
    if (shared) throw new Error('duplicate shares geometry reference with original (should be cloned)');
    // delete: removed from state.models, undo restores it
    const dupId = await page.evaluate(() => __R.state.models[__R.state.models.length - 1].userData.id);
    await page.evaluate(dupId => { __R.deleteModel(dupId); }, dupId);
    const stillThere = await page.evaluate(dupId => !!__R.getModel(dupId), dupId);
    if (stillThere) throw new Error('deleteModel did not remove the model');
    await page.evaluate(() => __R.History.undo());
    const restoredAfterUndo = await page.evaluate(dupId => !!__R.getModel(dupId), dupId);
    if (!restoredAfterUndo) throw new Error('delete-model undo did not restore it');
  });

  await step('asset search filters cards without re-rendering thumbnails', () => page.evaluate(() => {
    var R = __R;
    R.state.models.length = 0;
    ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].forEach(function (nm) { var d = R.buildDonut(); d.userData.name = nm; R.addModel(d); });
    R.setView('assets'); R.renderAssets();
    var input = document.querySelector('#assetsBody input[type=text]');
    if (!input) throw new Error('search box did not appear with 5 models');
    R.setAssetQuery('alp');
    var cards = Array.prototype.slice.call(document.querySelectorAll('#assetsGrid .thumb'));
    var visible = cards.filter(function (c) { return c.style.display !== 'none'; });
    if (visible.length !== 1 || visible[0].getAttribute('data-name') !== 'alpha') throw new Error('search did not narrow to exactly Alpha, got ' + visible.map(function(c){return c.getAttribute('data-name');}));
    R.setAssetQuery('zzz-nomatch');
    var visible2 = cards.filter(function (c) { return c.style.display !== 'none'; });
    if (visible2.length !== 0) throw new Error('no-match query still showed cards');
    if (!document.getElementById('assetsEmptyMsg')) throw new Error('no-results message did not appear');
    R.setAssetQuery('');
    var visible3 = cards.filter(function (c) { return c.style.display !== 'none'; });
    if (visible3.length !== 5) throw new Error('clearing query did not restore all 5 cards, got ' + visible3.length);
    if (document.getElementById('assetsEmptyMsg')) throw new Error('no-results message did not clear');
  }));

  await step('eyedropper picks a color from the 2D canvas', () => page.evaluate(() => {
    var R = __R;
    R.setView('paint'); R.paint.mode3d = false;
    R.paint.ctx.fillStyle = '#3388ff'; R.paint.ctx.fillRect(400, 400, 50, 50); // known-color patch
    R.paint.color = '#000000'; R.paint.eyedrop = true;
    R.pickColorAt2D(420, 420); // inside the patch
    if (R.paint.eyedrop) throw new Error('eyedrop mode should auto-turn-off after a pick');
    if (R.paint.color.toLowerCase() !== '#3388ff') throw new Error('picked wrong color: ' + R.paint.color);
  }));

  await step('eyedropper picks a color from the 3D-painted surface', async () => {
    await page.evaluate(() => {
      var R = __R;
      R.state.models.length = 0;
      var d = R.buildDonut(); R.addModel(d); R.setActiveModel(d.userData.id);
      R.setView('paint'); R.paint.mode3d = true;
      document.querySelector('[data-view=paint]').classList.add('mode3d'); // see do3dPaint test comment
      R.resizeActive();
      R.ensureAtlasUVs(d, R.paint.part);
      R.paint.ctx.fillStyle = '#cc22aa'; R.paint.ctx.fillRect(0, 0, 1024, 1024); // flat color, any hit reads the same value
      R.paint.tex.needsUpdate = true;
    });
    await page.waitForTimeout(150);
    const result = await page.evaluate(() => {
      var R = __R;
      R.paint.color = '#000000'; R.paint.eyedrop = true;
      R.pickColorAt3D(180, 300);
      return { eyedrop: R.paint.eyedrop, color: R.paint.color };
    });
    if (result.eyedrop) throw new Error('eyedrop mode should auto-turn-off after a pick — the ray likely missed the mesh');
    if (result.color.toLowerCase() !== '#cc22aa') throw new Error('picked wrong color from 3D surface: ' + result.color);
  });

  await step('axis view snaps (Front/Back/Left/Right/Top) position the camera correctly', () => page.evaluate(() => {
    var R = __R;
    R.setView('edit');
    var vs = R.active.vs;
    vs.tx = 0; vs.ty = 0; vs.tz = 0; vs.rad = 10;
    // Match the app's own camera formula (updateCam) rather than assuming pure axis
    // vectors — snapView deliberately uses ph=1.5, not pi/2, to match the orbit-drag
    // clamp range, so the horizontal views have a slight intentional tilt.
    function expected(th, ph) {
      var sp = Math.sin(ph);
      return new THREE.Vector3(sp * Math.cos(th), Math.cos(ph), sp * Math.sin(th)).normalize();
    }
    function checkAxis(name, th, ph) {
      R.snapView(name);
      var p = vs.cam.position.clone().normalize();
      var exp = expected(th, ph);
      if (p.distanceTo(exp) > 0.01) throw new Error(name + ': camera direction ' + JSON.stringify(p) + ' does not match expected ' + JSON.stringify(exp));
    }
    checkAxis('right', 0, 1.5);
    checkAxis('left', Math.PI, 1.5);
    checkAxis('front', Math.PI / 2, 1.5);
    checkAxis('back', -Math.PI / 2, 1.5);
    R.snapView('top');
    var pTop = vs.cam.position.clone().normalize();
    if (pTop.y < 0.98) throw new Error('top view camera not close enough to straight-down, got y=' + pTop.y);
    // subsequent orbit-drag clamp (ph 0.1-1.5) must not jump after a snap
    if (vs.ph < 0.1 || vs.ph > 1.5) throw new Error('post-snap ph=' + vs.ph + ' is outside the orbit-drag clamp range, would jump on next drag');
  }));

  await step('paintHud sits above the tabbar on mobile (was hidden entirely behind it)', () => page.evaluate(() => {
    var R = __R;
    R.setView('paint'); R.paint.mode3d = true; document.querySelector('[data-view=paint]').classList.add('mode3d'); R.syncPaintHud();
    var ph = document.getElementById('paintHud'), tb = document.getElementById('tabbar');
    var pr = ph.getBoundingClientRect(), tr = tb.getBoundingClientRect();
    if (getComputedStyle(ph).bottom !== '134px') throw new Error('paintHud bottom is ' + getComputedStyle(ph).bottom + ', expected mobile 134px (desktop base rule is winning again)');
    if (pr.bottom > tr.top) throw new Error('paintHud (bottom ' + pr.bottom + ') overlaps the tabbar (top ' + tr.top + ')');
  }));

  await step('zoom knob: mobile touch-target sizing actually applies (was silently overridden)', () => page.evaluate(() => {
    var s = document.getElementById('zkSlider'), btn = document.querySelector('.zk-btn');
    var sw = getComputedStyle(s).width, sh = getComputedStyle(s).height, bw = getComputedStyle(btn).width;
    if (sw !== '32px') throw new Error('zkSlider width is ' + sw + ', expected mobile 32px (desktop base rule is winning again)');
    if (sh !== '96px') throw new Error('zkSlider height is ' + sh + ', expected 96px at this (tall) viewport');
    if (bw !== '32px') throw new Error('.zk-btn width is ' + bw + ', expected mobile 32px');
  }));

  await step('zoom knob never collides with the tabbar down to realistic landscape heights', async () => {
    for (const h of [375, 390, 420]) {
      await page.setViewportSize({ width: 700, height: h });
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => {
        var zk = document.getElementById('zoomKnob'), tb = document.getElementById('tabbar');
        return { zkBottom: zk.getBoundingClientRect().bottom, tabbarTop: tb.getBoundingClientRect().top };
      });
      if (info.zkBottom > info.tabbarTop) throw new Error('at height ' + h + ': zoom knob (bottom ' + info.zkBottom + ') overlaps tabbar (top ' + info.tabbarTop + ')');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
  });

  await step('view-switch clears a still-fading hint instead of leaving it stuck', () => page.evaluate(() => {
    var R = __R;
    R.resetHintsSeen();
    R.setView('edit'); // has a hint, and hasn't been "seen" after the reset above
    var h = document.getElementById('hint');
    if (!h.classList.contains('show')) throw new Error('edit hint did not show on first visit');
    if (h.textContent.indexOf('RotBall') < 0) throw new Error('hint text is not the edit-view one, got: ' + h.textContent);
    R.setView('assets'); // no hint of its own — must not leave edit's hint lingering
    if (h.classList.contains('show')) throw new Error('stale hint from the previous view was left showing after switching to assets');
  }));

  await step('landscape-phone viewport: collapsed sheet never bleeds through the tabbar gap', async () => {
    await page.setViewportSize({ width: 812, height: 375 }); // short landscape phone
    await page.waitForTimeout(200);
    const geo = await page.evaluate(() => {
      var panel = document.getElementById('panel'), mask = document.getElementById('navMask'), tabbar = document.getElementById('tabbar');
      var pr = panel.getBoundingClientRect(), mr = mask.getBoundingClientRect(), tr = tabbar.getBoundingClientRect();
      return { panelOpen: panel.classList.contains('open'), peekTop: pr.top, peekBottom: pr.top + 48, maskTop: mr.top, maskBottom: mr.bottom, tabbarTop: tr.top, viewportH: window.innerHeight };
    });
    if (geo.panelOpen) throw new Error('test setup: panel unexpectedly open');
    // the mask must fully cover from the peek's bottom edge down to the true viewport bottom —
    // that's the fixed-size gap that always exists regardless of viewport height (see commit msg)
    if (geo.maskTop > geo.peekBottom + 1) throw new Error('gap between peek (' + geo.peekBottom + ') and mask start (' + geo.maskTop + ') is uncovered');
    if (geo.maskBottom < geo.viewportH - 1) throw new Error('mask (' + geo.maskBottom + ') does not reach the viewport bottom (' + geo.viewportH + ')');
    await page.setViewportSize({ width: 390, height: 844 }); // restore the suite's default mobile viewport
    await page.waitForTimeout(200);
  });

  await step('deleteModel disposes GPU resources, but not when still placed/shared', async () => {
    // Case 1: a model with no scene placement — deleting it should dispose its geometry.
    await page.evaluate(() => {
      var R = __R;
      R.state.models.length = 0;
      var d1 = R.buildDonut(); d1.userData.name = 'DisposeMe'; R.addModel(d1);
      var geo1 = d1.userData.parts[0].mesh.geometry;
      window.__disposed1 = false; var orig = geo1.dispose.bind(geo1);
      geo1.dispose = function () { window.__disposed1 = true; return orig(); };
      window.__geo1 = geo1; window.__d1id = d1.userData.id;
      R.deleteModel(d1.userData.id);
    });
    const disposed1 = await page.evaluate(() => window.__disposed1);
    if (!disposed1) throw new Error('geometry.dispose() was not called for an unplaced deleted model');
    const cpuIntact = await page.evaluate(() => { var g = window.__geo1; return !!(g.attributes.position && g.attributes.position.array.length > 0); });
    if (!cpuIntact) throw new Error('dispose() destroyed CPU-side attribute data');
    await page.evaluate(() => __R.History.undo());
    const restored = await page.evaluate(() => !!__R.getModel(window.__d1id));
    if (!restored) throw new Error('undo did not restore the disposed-then-deleted model');
    await page.waitForTimeout(100); // let a couple of animation frames render the revived model; any exception surfaces via the page's pageerror listener

    // Case 2: a model that IS placed in the Scene — deleting it must NOT dispose (still rendered there).
    await page.evaluate(() => {
      var R = __R;
      R.state.models.length = 0;
      var d2 = R.buildDonut(); d2.userData.name = 'PlacedModel'; R.addModel(d2);
      R.addPlacement(d2.userData.id); // real placement clone sharing geometry/material by reference
      var geo2 = d2.userData.parts[0].mesh.geometry;
      window.__disposed2 = false; var orig2 = geo2.dispose.bind(geo2);
      geo2.dispose = function () { window.__disposed2 = true; return orig2(); };
      R.deleteModel(d2.userData.id);
      R.sceneScene.userData.holder.children.slice().forEach(function (c) { R.sceneScene.userData.holder.remove(c); }); // cleanup
    });
    const disposed2 = await page.evaluate(() => window.__disposed2);
    if (disposed2) throw new Error('geometry.dispose() was called even though a scene placement still references it');
  });

  await step('vertex snap (priority) + grid snap (fallback)', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube');
    var preDrag = EM.V.map(function (v) { return v.clone(); });
    // find two distinct verts: one we'll "drag" near another stationary one
    var stationary = EM.V[0], dragged = EM.V[1];
    var targetPos = stationary.clone();
    dragged.copy(targetPos).add(new THREE.Vector3(0.01, 0.01, 0.01)); // within vsnapR, not exact
    R.applyEditSnap(preDrag);
    if (dragged.distanceTo(stationary) > 1e-9) throw new Error('vertex snap did not lock onto the stationary vertex exactly');

    // now a vertex moved far from everything else should fall back to the 0.1 grid
    EM.fromPrim('Cube');
    var preDrag2 = EM.V.map(function (v) { return v.clone(); });
    var far = EM.V[2];
    far.set(3.14159, 2.7, -1.41); // nowhere near any other vertex
    R.applyEditSnap(preDrag2);
    var onGrid = Math.abs(far.x - Math.round(far.x / 0.1) * 0.1) < 1e-9 &&
                 Math.abs(far.y - Math.round(far.y / 0.1) * 0.1) < 1e-9 &&
                 Math.abs(far.z - Math.round(far.z / 0.1) * 0.1) < 1e-9;
    if (!onGrid) throw new Error('far vertex did not fall back to the 0.1 grid, got ' + far.x + ',' + far.y + ',' + far.z);
  }));

  await step('extrude distance + emboss + push give precise depth control', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    function capZ() { var zs = []; EM.F.forEach(function (f, fi) { if (f.sel) zs.push(EM._faceCenter(fi).z); }); return zs.reduce(function (a, b) { return a + b; }, 0) / (zs.length || 1); }
    function selPlusZ() { R.editState.mode = 'face'; EM.clearSel(); for (var i = 0; i < EM.F.length; i++) { if (Math.abs(EM._faceCenter(i).z - 0.5) < 1e-6) { EM.F[i].sel = true; break; } } }
    // extrude by an explicit distance moves the cap exactly that far along the normal
    EM.fromPrim('Cube'); selPlusZ();
    EM.extrude(0.5);
    if (Math.abs(capZ() - 1.0) > 1e-4) throw new Error('extrude(0.5) did not move the +Z cap to z=1.0 (got ' + capZ() + ')');
    // push pulls the extrusion back in without adding geometry
    var fc = EM.F.length; EM.pushSel(-0.2);
    if (Math.abs(capZ() - 0.8) > 1e-4) throw new Error('pushSel(-0.2) did not pull the cap to z=0.8 (got ' + capZ() + ')');
    if (EM.F.length !== fc) throw new Error('pushSel changed face count (it should only move vertices)');
    // emboss = negative extrude, pushes inward
    EM.fromPrim('Cube'); selPlusZ(); EM.extrude(-0.3);
    if (Math.abs(capZ() - 0.2) > 1e-4) throw new Error('emboss (extrude -0.3) did not push the cap to z=0.2 (got ' + capZ() + ')');
    R.History.undo();
    // region extrude: a group of adjacent faces stays one connected block (shared lifted
    // verts) instead of splitting into per-face pillars
    EM.fromPrim('Cube'); R.editState.mode = 'face'; EM.clearSel();
    EM.F.forEach(function (f, fi) { if (Math.abs(EM._faceCenter(fi).z - 0.5) < 1e-6) f.sel = true; });
    var vBefore = EM.V.length; EM.extrude(0.5);
    if (EM.V.length - vBefore !== 9) throw new Error('region extrude of the 4 +Z faces added ' + (EM.V.length - vBefore) + ' verts, expected 9 shared (16 = cracked pillars)');
    var caps = []; EM.F.forEach(function (f, fi) { if (f.sel) caps.push(fi); });
    var em = {}; caps.forEach(function (fi) { var vi = EM.F[fi].vi; for (var i = 0; i < vi.length; i++) { var k = Math.min(vi[i], vi[(i + 1) % vi.length]) + '_' + Math.max(vi[i], vi[(i + 1) % vi.length]); em[k] = (em[k] || 0) + 1; } });
    var shared = Object.keys(em).filter(function (k) { return em[k] === 2; }).length;
    if (shared < 4) throw new Error('extruded cap faces are not connected (shared edges=' + shared + ') — region cracked into pillars');
  }));

  await step('box-select: adds front-facing elements only, subtract removes them', async () => {
    await page.evaluate(() => { var R = __R; R.EM.fromPrim('Cube'); R.setView('edit'); R.frameObject(R.EM._meshObj, R.viewState.edit); R.resizeActive(); R.invalidate(8); R.editState.mode = 'vert'; R.EM.clearSel(); });
    await page.waitForTimeout(250); // let the render loop settle the edit camera
    const res = await page.evaluate(() => {
      var R = __R, EM = R.EM, W = 500, H = 648, cam = R.active.vs.cam; cam.updateMatrixWorld();
      var cp = cam.position, self = EM;
      var front = self.F.map(function (f, fi) { return self._faceNormal(fi).dot(cp.clone().sub(self._faceCenter(fi))) > 0; });
      // a vertex is fully occluded if ALL its faces face away from the camera
      var anyFront = new Array(self.V.length), touched = new Array(self.V.length);
      self.F.forEach(function (f, fi) { f.vi.forEach(function (vi) { touched[vi] = true; if (front[fi]) anyFront[vi] = true; }); });
      // build a box covering every front vertex's projection
      function scr(v) { var q = v.clone().project(cam); return { x: (q.x + 1) / 2 * W, y: (-q.y + 1) / 2 * H }; }
      var xs = [], ys = [];
      self.V.forEach(function (v, i) { if (!anyFront[i]) return; var s = scr(v); xs.push(s.x); ys.push(s.y); });
      var x0 = Math.min.apply(null, xs) - 8, x1 = Math.max.apply(null, xs) + 8, y0 = Math.min.apply(null, ys) - 8, y1 = Math.max.apply(null, ys) + 8;
      EM.clearSel(); EM.boxSelect(x0, y0, x1, y1, cam, W, H, false);
      var selAdd = EM.V.map(function (v, i) { return v.sel ? i : -1; }).filter(function (i) { return i >= 0; });
      var frontVerts = anyFront.map(function (b, i) { return b ? i : -1; }).filter(function (i) { return i >= 0; });
      var occludedSelected = selAdd.filter(function (i) { return !anyFront[i]; });
      EM.boxSelect(x0, y0, x1, y1, cam, W, H, true); // subtract
      var selAfterSub = EM.V.filter(function (v) { return v.sel; }).length;
      return { nFront: frontVerts.length, nAdd: selAdd.length, occludedSelected: occludedSelected.length, selAfterSub: selAfterSub };
    });
    if (res.nAdd < res.nFront) throw new Error('box-select missed front vertices: selected ' + res.nAdd + ' of ' + res.nFront);
    if (res.occludedSelected > 0) throw new Error('box-select grabbed ' + res.occludedSelected + ' fully-occluded back vertices');
    if (res.selAfterSub !== 0) throw new Error('subtract box did not clear the selection: ' + res.selAfterSub + ' left');
  });

  await step('edit view: solid mesh, selection-only overlay, front-surface picking', () => page.evaluate(() => {
    var R = __R, EM = R.EM, W = 500, H = 700;
    EM.fromPrim('Cube'); R.setView('edit'); R.frameObject(EM._meshObj, R.viewState.edit); R.resizeActive();
    // mesh is opaque (not a translucent skeleton)
    if (EM._mat.transparent !== false || EM._mat.opacity !== 1) throw new Error('edit mesh should be opaque/solid');
    // with nothing selected, the vertex-dot overlay must be gone (verts stay selection-only)
    // but the edge wireframe is always traced (full topology), just depth-tested/opaque now
    // instead of the old depthTest:false "x-ray" hack that bled through the whole mesh.
    EM.clearSel(); EM._refresh();
    if (EM._vertObj) throw new Error('vertex overlay is drawn with nothing selected (verts should stay selection-only)');
    if (!EM._edgeObj) throw new Error('edge wireframe should always be traced, even with nothing selected');
    var em = EM._edgeObj.material;
    if (em.depthTest !== true) throw new Error('edge wireframe must be depth-tested (occluded by the solid mesh), not the old x-ray overlay');
    if (em.transparent !== false || em.opacity !== 1) throw new Error('edge wireframe should be opaque, not the old transparent ghost effect');
    // selecting shows the vertex highlight overlay
    EM.V[0].sel = true; EM._refresh();
    if (!EM._vertObj) throw new Error('selected vertex highlight not drawn');
    EM.clearSel(); EM._refresh();
    // front-surface picking: deterministic camera looking straight down -Z so each front (z+)
    // vertex projects on top of a back (z-) one — the pick must resolve to the near vertex.
    var cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 100); cam.position.set(0, 0, 4); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    var Vs = EM.V.map(function (v, i) { var q = v.clone().project(cam); return { i: i, x: (q.x + 1) / 2 * W, y: (-q.y + 1) / 2 * H, cd: cam.position.distanceTo(v) }; });
    var front = Vs.slice().sort(function (a, b) { return a.cd - b.cd; })[0];
    var overlap = Vs.filter(function (o) { return o.i !== front.i && o.cd > front.cd + 0.5 && Math.hypot(o.x - front.x, o.y - front.y) < 44; });
    if (!overlap.length) throw new Error('test setup: no screen-overlapping back vertex to disambiguate');
    var ndcx = front.x / W * 2 - 1, ndcy = -(front.y / H * 2 - 1);
    var ray = new THREE.Raycaster(); ray.setFromCamera({ x: ndcx, y: ndcy }, cam);
    R.editState.mode = 'vert'; EM.clearSel(); EM.select(ray, front.x, front.y, cam, W, H, false);
    var picked = EM.V.map(function (v, i) { return v.sel ? i : -1; }).filter(function (i) { return i >= 0; })[0];
    if (picked !== front.i) throw new Error('picking selected an occluded back vertex (' + picked + ') instead of the front one (' + front.i + ')');
  }));

  await step('recalcNormals auto-flips only the inward-facing face', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube');
    var otherVi = EM.F[1].vi.slice(); // untouched control face
    EM.F[0].vi.reverse(); EM._buildEdges(); EM._refresh(); // deliberately face this one inward
    var c = new THREE.Vector3(); EM.V.forEach(function (v) { c.add(v); }); c.divideScalar(EM.V.length);
    var nBefore = EM._faceNormal(0), fcBefore = EM._faceCenter(0);
    if (nBefore.dot(fcBefore.clone().sub(c)) >= 0) throw new Error('test setup failed: face 0 not actually inward-facing');
    EM.recalcNormals();
    var nAfter = EM._faceNormal(0), fcAfter = EM._faceCenter(0);
    if (nAfter.dot(fcAfter.clone().sub(c)) < 0) throw new Error('recalcNormals did not flip the inward-facing face');
    if (EM.F[1].vi.join(',') !== otherVi.join(',')) throw new Error('recalcNormals touched a face that was already correct');
  }));

  await step('applyMirror bakes + welds seam, no dup verts', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube'); // BoxGeometry(...,2,2,2) has a vertex ring exactly at x=0 to weld
    var n0 = EM.V.length;
    // asymmetric bump on the +X side so the mirrored half is verifiably distinct
    var bumpI = -1;
    for (var i = 0; i < EM.V.length; i++) if (EM.V[i].x > 0.1) { bumpI = i; break; }
    if (bumpI < 0) throw new Error('no +X vertex found to bump');
    EM.V[bumpI].x += 0.5;
    var bumpX = EM.V[bumpI].x;
    R.editState.mirror = true; EM._refresh();
    EM.applyMirror();
    if (R.editState.mirror) throw new Error('mirror toggle should auto-disable after applying');
    if (EM._mirrorObj) throw new Error('mirror ghost should be gone after applying (baked into real geometry)');
    if (EM.V.length >= n0 * 2) throw new Error('no seam vertices were welded (count=' + EM.V.length + ', expected < ' + (n0 * 2) + ')');
    // no coincident duplicate vertices anywhere post-weld
    for (var a = 0; a < EM.V.length; a++) for (var b = a + 1; b < EM.V.length; b++)
      if (EM.V[a].distanceTo(EM.V[b]) < 1e-4) throw new Error('duplicate unwelded vertices at ' + a + ',' + b);
    // the bumped vertex and its mirrored counterpart should both be present
    var hasOrig = EM.V.some(function (v) { return Math.abs(v.x - bumpX) < 1e-6; });
    var hasMirr = EM.V.some(function (v) { return Math.abs(v.x + bumpX) < 1e-6; });
    if (!hasOrig || !hasMirr) throw new Error('bumped vertex or its mirror missing after bake');
  }));

  await step('fromPrim(Cube/Plane) build real quads; Select Loop + Loop Cut actually work', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube');
    if (!EM.F.every(function (f) { return f.vi.length === 4; })) throw new Error('Cube primitive is not all quads (was triangulated — Select Loop/Loop Cut cannot function)');
    if (EM.F.length !== 24) throw new Error('expected 24 quad faces on a 2-segment cube, got ' + EM.F.length);
    EM.fromPrim('Plane');
    if (!EM.F.every(function (f) { return f.vi.length === 4; })) throw new Error('Plane primitive is not all quads');
    // Select Loop: starting from one internal edge, the loop must wrap all the way
    // around the cube through welded seams onto adjacent faces (not stay stuck on one face).
    EM.fromPrim('Cube');
    var internalEdge = EM.E.find(function (e) { return e.fi.length === 2; });
    if (!internalEdge) throw new Error('no internal (2-face) edge found on quad cube');
    EM.clearSel(); internalEdge.sel = true;
    EM.selectLoops();
    var loopCount = EM.E.filter(function (e) { return e.sel; }).length;
    if (loopCount < 4) throw new Error('Select Loop only grew to ' + loopCount + ' edges — loop traversal is not walking the quad topology');
    // Loop Cut: cutting every face should double the quad count and stay all-quad.
    EM.fromPrim('Cube');
    var beforeCount = EM.F.length;
    EM.F.forEach(function (f) { f.sel = true; });
    EM.loopCut();
    if (EM.F.length !== beforeCount * 2) throw new Error('Loop Cut did not double face count: ' + beforeCount + ' -> ' + EM.F.length);
    if (!EM.F.every(function (f) { return f.vi.length === 4; })) throw new Error('Loop Cut produced non-quad faces');
  }));

  await step('fromPrim(Cylinder/Prism) build quad side walls + n-gon caps with correct outward normals', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    [['Cylinder', 8], ['Prism', 6]].forEach(function (t) {
      var type = t[0], radialSeg = t[1];
      EM.fromPrim(type);
      var sideFaces = EM.F.filter(function (f) { return f.vi.length === 4; });
      var capFaces = EM.F.filter(function (f) { return f.vi.length === radialSeg; });
      if (sideFaces.length !== radialSeg) throw new Error(type + ': expected ' + radialSeg + ' side quads, got ' + sideFaces.length);
      if (capFaces.length !== 2) throw new Error(type + ': expected 2 n-gon caps, got ' + capFaces.length);
      // every side quad's normal must point radially outward from the Y axis
      EM.F.forEach(function (f, fi) {
        if (f.vi.length !== 4) return;
        var c = EM._faceCenter(fi), n = EM._faceNormal(fi);
        var radial = new THREE.Vector3(c.x, 0, c.z).normalize();
        if (radial.dot(n) < 0.5) throw new Error(type + ': side quad ' + fi + ' normal is not pointing outward (inverted winding)');
      });
      // caps must point straight down (-Y) and straight up (+Y), one each
      var capYs = EM.F.map(function (f, fi) { return f.vi.length === radialSeg ? EM._faceNormal(fi).y : null; }).filter(function (y) { return y !== null; });
      if (!capYs.some(function (y) { return y < -0.99; }) || !capYs.some(function (y) { return y > 0.99; }))
        throw new Error(type + ': caps are not facing straight up/down, got ' + JSON.stringify(capYs));
      // Select Loop + Loop Cut must work on the side quads same as the cube
      var internalEdge = EM.E.find(function (e) { return e.fi.length === 2 && EM.F[e.fi[0]].vi.length === 4 && EM.F[e.fi[1]].vi.length === 4; });
      if (!internalEdge) throw new Error(type + ': no internal side-quad edge found');
      EM.clearSel(); internalEdge.sel = true; EM.selectLoops();
      if (EM.E.filter(function (e) { return e.sel; }).length < 2) throw new Error(type + ': Select Loop did not grow past the seed edge');
      var beforeCount = EM.F.length;
      EM.F.forEach(function (f) { f.sel = (f.vi.length === 4); });
      EM.loopCut();
      if (EM.F.length !== beforeCount + radialSeg) throw new Error(type + ': Loop Cut face count wrong: ' + beforeCount + ' -> ' + EM.F.length);
    });
  }));

  await step('fromPrim(Torus) builds a pure doubly-periodic quad grid with correct outward normals', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Torus');
    if (!EM.F.every(function (f) { return f.vi.length === 4; })) throw new Error('Torus is not all quads (was triangulated)');
    if (EM.F.length !== 60) throw new Error('expected 60 quads (10 major x 6 minor), got ' + EM.F.length);
    var majorR = 0.5;
    EM.F.forEach(function (f, fi) {
      var c = EM._faceCenter(fi), n = EM._faceNormal(fi);
      var ringDir = new THREE.Vector3(c.x, 0, c.z).normalize();
      var ringPt = ringDir.clone().multiplyScalar(majorR);
      var expected = c.clone().sub(ringPt).normalize();
      if (expected.dot(n) < 0.9) throw new Error('Torus face ' + fi + ' normal is not pointing radially outward from the tube (inverted winding)');
    });
    // it wraps in BOTH directions, so every edge should be internal (shared by exactly 2 faces) — no boundary at all
    if (EM.E.some(function (e) { return e.fi.length !== 2; })) throw new Error('Torus has a boundary edge — the seam did not weld correctly in both directions');
    var internalEdge = EM.E[0];
    EM.clearSel(); internalEdge.sel = true; EM.selectLoops();
    if (EM.E.filter(function (e) { return e.sel; }).length < 5) throw new Error('Select Loop did not wrap around the torus');
    var beforeCount = EM.F.length;
    EM.F.forEach(function (f) { f.sel = true; });
    EM.loopCut();
    if (EM.F.length !== beforeCount * 2) throw new Error('Loop Cut did not double face count on torus: ' + beforeCount + ' -> ' + EM.F.length);
  }));

  await step('mobile edit HUD: overflowing button rows get a scroll-fade, non-overflowing rows do not', async () => {
    await page.evaluate(() => {
      var R = __R;
      R.EM.fromPrim('Cube'); R.setView('edit');
      R.editState.mode = 'edge'; R.editState.hudExpanded = true; R.renderEditHud();
    });
    await page.waitForTimeout(150);
    const info = await page.evaluate(() => {
      var rows = Array.prototype.slice.call(document.querySelectorAll('#editHud .hud-compact'));
      return rows.map(function (r) {
        return { overflow: r.scrollWidth > r.clientWidth + 1, hasClass: r.classList.contains('has-overflow'), mask: getComputedStyle(r).maskImage || getComputedStyle(r).webkitMaskImage };
      });
    });
    if (!info.length) throw new Error('no .hud-compact rows found in the mobile edit HUD');
    info.forEach(function (r, i) {
      if (r.overflow !== r.hasClass) throw new Error('row ' + i + ': overflow=' + r.overflow + ' but has-overflow class=' + r.hasClass);
      if (r.overflow && (!r.mask || r.mask === 'none')) throw new Error('row ' + i + ' overflows but has no mask-image fade applied');
      if (!r.overflow && r.mask && r.mask !== 'none') throw new Error('row ' + i + ' does not overflow but still has a mask-image fade (would clip visible content)');
    });
    // the multi-select toggle must read as a real word, not a symbol that clips to "+S" mid-glyph
    const hasMulti = await page.evaluate(() => Array.prototype.some.call(document.querySelectorAll('#editHud .hud-btn'), function (b) { return b.textContent === 'Multi'; }));
    if (!hasMulti) throw new Error('multi-select HUD button label missing/renamed unexpectedly');
  });

  await step('top bar (Undo/Redo/Snap/Frame/Shot) never clips off-screen on narrow phones', async () => {
    for (const w of [320, 340]) {
      await page.setViewportSize({ width: w, height: 700 });
      await page.waitForTimeout(120);
      const info = await page.evaluate(() => {
        var shot = document.getElementById('btnShot');
        var r = shot.getBoundingClientRect();
        return { right: r.right, width: r.width, viewportW: window.innerWidth };
      });
      if (info.width < 1) throw new Error('Shot button has zero width at ' + w + 'px viewport');
      if (info.right > info.viewportW) throw new Error('Shot button clips off-screen at ' + w + 'px viewport (right=' + info.right + ')');
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await step('mesh editor HUD row leaves a real gap before RotBall (was touching by 2px)', async () => {
    for (const w of [320, 360, 390]) {
      await page.setViewportSize({ width: w, height: 568 });
      await page.evaluate(() => __R.setView('edit'));
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => {
        var hud = document.getElementById('editHud'), rb = document.getElementById('rotBall');
        return { hudRight: hud.getBoundingClientRect().right, rotBallLeft: rb.getBoundingClientRect().left };
      });
      if (info.rotBallLeft - info.hudRight < 4) throw new Error('edit HUD row crowds RotBall at ' + w + 'px viewport (gap=' + (info.rotBallLeft - info.hudRight) + 'px)');
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await step('fillHole caps a deleted face (quad and n-gon) with correct winding, and rejects invalid selections', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    // quad cube: delete one face, select its 4 boundary edges, fill it back exactly
    EM.fromPrim('Cube');
    var targetFi = -1;
    for (var fi = 0; fi < EM.F.length; fi++) { var c = EM._faceCenter(fi); if (Math.abs(c.z - 0.5) < 1e-6) { targetFi = fi; break; } }
    if (targetFi < 0) throw new Error('could not find +Z quad face on the cube');
    var expectedNormal = EM._faceNormal(targetFi).clone();
    R.editState.mode = 'face'; EM.F[targetFi].sel = true; EM.deleteSelected();
    var boundary = EM.E.filter(function (e) { return e.fi.length === 1; });
    if (boundary.length !== 4) throw new Error('expected a 4-edge hole, got ' + boundary.length);
    EM.clearSel(); boundary.forEach(function (e) { e.sel = true; });
    R.editState.mode = 'edge';
    var beforeF = EM.F.length;
    EM.fillHole();
    if (EM.F.length !== beforeF + 1) throw new Error('fillHole did not add exactly one face: ' + beforeF + ' -> ' + EM.F.length);
    var newFace = EM.F[EM.F.length - 1];
    if (newFace.vi.length !== 4) throw new Error('fill face has wrong vertex count: ' + newFace.vi.length);
    if (expectedNormal.dot(EM._faceNormal(EM.F.length - 1)) < 0.99) throw new Error('fill face normal does not match the original face (bad winding)');
    if (EM.E.some(function (e) { return e.fi.length !== 2; })) throw new Error('mesh is not fully closed after fillHole');

    // n-gon cylinder cap: same operation must generalize past quads
    EM.fromPrim('Cylinder');
    var capFi = -1;
    for (var fi2 = 0; fi2 < EM.F.length; fi2++) if (EM.F[fi2].vi.length === 8) { capFi = fi2; break; }
    R.editState.mode = 'face'; EM.F[capFi].sel = true; EM.deleteSelected();
    R.editState.mode = 'edge';
    var capBoundary = EM.E.filter(function (e) { return e.fi.length === 1; });
    if (capBoundary.length !== 8) throw new Error('expected an 8-edge cap hole, got ' + capBoundary.length);
    EM.clearSel(); capBoundary.forEach(function (e) { e.sel = true; });
    EM.fillHole();
    var capFill = EM.F[EM.F.length - 1];
    if (capFill.vi.length !== 8) throw new Error('n-gon fill face has wrong vertex count: ' + capFill.vi.length);
    if (EM.E.some(function (e) { return e.fi.length !== 2; })) throw new Error('cylinder mesh is not fully closed after fillHole');

    // rejects: fewer than 3 edges selected must not add a face
    EM.fromPrim('Cube');
    var oneEdge = EM.E[0]; EM.clearSel(); oneEdge.sel = true;
    var beforeReject = EM.F.length;
    EM.fillHole();
    if (EM.F.length !== beforeReject) throw new Error('fillHole should reject a selection of <3 edges');
    // rejects: interior (non-boundary) edges must not add a face
    var interior = EM.E.filter(function (e) { return e.fi.length === 2; }).slice(0, 3);
    EM.clearSel(); interior.forEach(function (e) { e.sel = true; });
    var beforeReject2 = EM.F.length;
    EM.fillHole();
    if (EM.F.length !== beforeReject2) throw new Error('fillHole should reject interior (non-boundary) edges');
  }));

  await step('selectLinked grows to the connected island only, not across disconnected pieces', () => page.evaluate(() => {
    var R = __R, EM = R.EM;
    EM.fromPrim('Cube');
    var base = EM.V.length;
    // graft a detached quad far away = a second island in the same mesh
    [[10, 10, 10], [11, 10, 10], [11, 11, 10], [10, 11, 10]].forEach(function (p) { var v = new THREE.Vector3(p[0], p[1], p[2]); v.sel = false; EM.V.push(v); });
    EM.F.push({ vi: [base, base + 1, base + 2, base + 3], sel: false });
    EM._buildEdges();
    // vert mode: seed one island-B vertex, must select exactly island B's 4 verts and none of island A
    R.editState.mode = 'vert'; EM.clearSel(); EM.V[base].sel = true; EM.selectLinked();
    var bSel = 0, aSel = 0;
    for (var i = 0; i < EM.V.length; i++) if (EM.V[i].sel) { if (i >= base) bSel++; else aSel++; }
    if (bSel !== 4) throw new Error('selectLinked should select all 4 island-B verts, got ' + bSel);
    if (aSel !== 0) throw new Error('selectLinked leaked into island A: ' + aSel + ' verts wrongly selected');
    // face mode: seed one island-A face, must grab every cube face and no island-B face
    R.editState.mode = 'face'; EM.clearSel();
    var aFace = -1; for (var fi = 0; fi < EM.F.length; fi++) if (EM.F[fi].vi.indexOf(0) >= 0) { aFace = fi; break; }
    EM.F[aFace].sel = true; EM.selectLinked();
    var aFacesSel = 0, bFacesSel = 0;
    EM.F.forEach(function (f) { if (f.sel) { if (f.vi[0] >= base) bFacesSel++; else aFacesSel++; } });
    if (aFacesSel !== 24) throw new Error('selectLinked should grab all 24 cube faces, got ' + aFacesSel);
    if (bFacesSel !== 0) throw new Error('selectLinked leaked into island B faces: ' + bFacesSel);
    // empty selection is a no-op (does not throw, selects nothing)
    EM.clearSel(); EM.selectLinked();
    if (EM.F.some(function (f) { return f.sel; })) throw new Error('selectLinked with no seed should select nothing');
  }));

  await step('topology ops stay healthy (no NaN/degenerate/non-manifold, undo-clean) on quad + n-gon primitives', () => page.evaluate(() => {
    var R = __R, EM = R.EM, problems = [];
    function healthCheck(label) {
      for (var i = 0; i < EM.V.length; i++) { var v = EM.V[i]; if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) problems.push(label + ': non-finite vertex #' + i); }
      for (var fi = 0; fi < EM.F.length; fi++) {
        var vi = EM.F[fi].vi;
        if (vi.length < 3) problems.push(label + ': face ' + fi + ' has <3 verts');
        var seen = {};
        for (var k = 0; k < vi.length; k++) {
          if (vi[k] < 0 || vi[k] >= EM.V.length) problems.push(label + ': face ' + fi + ' out-of-range index');
          if (seen[vi[k]]) problems.push(label + ': face ' + fi + ' duplicate vertex');
          seen[vi[k]] = 1;
        }
      }
      for (var ei = 0; ei < EM.E.length; ei++) { var fc = EM.E[ei].fi.length; if (fc < 1 || fc > 2) problems.push(label + ': edge ' + ei + ' non-manifold (' + fc + ' faces)'); }
    }
    var scenarios = [
      ['Cube', 'face', 'extrude'], ['Cube', 'face', 'inset'], ['Cube', 'face', 'subdivide'], ['Cube', 'face', 'duplicateSelection'],
      ['Cube', 'edge', 'bevelEdges'], ['Cube', 'edge', 'loopCut'], ['Cube', 'vert', 'smoothVerts'],
      ['Cylinder', 'face', 'extrude'], ['Cylinder', 'face', 'inset'], ['Cylinder', 'face', 'subdivide'],
      ['Cylinder', 'edge', 'bevelEdges'], ['Cylinder', 'edge', 'loopCut'],
      ['Torus', 'face', 'subdivide'], ['Torus', 'face', 'extrude'], ['Torus', 'edge', 'loopCut']
    ];
    var undoable = { extrude: 1, inset: 1, subdivide: 1, duplicateSelection: 1, bevelEdges: 1, loopCut: 1 };
    scenarios.forEach(function (s) {
      var prim = s[0], mode = s[1], op = s[2], label = prim + '/' + op;
      EM.fromPrim(prim); R.editState.mode = mode;
      if (mode === 'face') EM.F.forEach(function (f) { f.sel = true; });
      else if (mode === 'edge') EM.E.forEach(function (e) { e.sel = true; });
      else EM.V.forEach(function (v) { v.sel = true; });
      var before = { v: EM.V.length, f: EM.F.length };
      try { EM[op](); } catch (e) { problems.push(label + ': THREW ' + e.message); return; }
      healthCheck(label);
      if (undoable[op]) { R.History.undo(); if (EM.V.length !== before.v || EM.F.length !== before.f) problems.push(label + ': undo did not restore counts'); }
    });
    if (problems.length) throw new Error(problems.length + ' topology-health problem(s): ' + problems.slice(0, 5).join(' | '));
  }));

  await step('mirror works on all three axes (X/Y/Z): grab propagation + Apply Mirror winding', () => page.evaluate(() => {
    var R = __R, EM = R.EM, AX = ['x', 'y', 'z'];
    [0, 1, 2].forEach(function (ax) {
      var comp = AX[ax];
      // ---- grab propagation ----
      EM.fromPrim('Cube');
      R.editState.mirror = true; R.editState.mirrorAxis = ax; EM._mirMap = null;
      var srcI = -1; for (var i = 0; i < EM.V.length; i++) if (EM.V[i][comp] > 0.1) { srcI = i; break; }
      if (srcI < 0) throw new Error('axis ' + comp + ': no +' + comp + ' vertex found');
      // independent brute-force mirror partner (NOT via _mirrorMap)
      var s = EM.V[srcI], partner = -1;
      for (var j = 0; j < EM.V.length; j++) {
        var v = EM.V[j], ok = (j !== srcI) && Math.abs(v[comp] + s[comp]) < 1e-4;
        AX.forEach(function (c) { if (c !== comp && Math.abs(v[c] - s[c]) >= 1e-4) ok = false; });
        if (ok) { partner = j; break; }
      }
      if (partner < 0) throw new Error('axis ' + comp + ': no true mirror partner for vertex ' + srcI);
      var perp = AX[(ax + 1) % 3], before = EM.V[partner][perp];
      R.editState.mode = 'vert'; EM.clearSel(); EM.V[srcI].sel = true;
      var d = new THREE.Vector3(); d[perp] = 0.3; EM.grab(d);
      if (Math.abs(EM.V[partner][perp] - (before + 0.3)) >= 1e-6) throw new Error('axis ' + comp + ': mirror partner did not follow the drag on the perpendicular axis');
      if (Math.abs(EM.V[partner][comp] + EM.V[srcI][comp]) >= 1e-6) throw new Error('axis ' + comp + ': mirror partner is not the negated reflection on ' + comp);
      // ---- Apply Mirror bake winding ----
      EM.fromPrim('Cube');
      var n0 = EM.V.length, bumpI = -1;
      for (var k = 0; k < EM.V.length; k++) if (EM.V[k][comp] > 0.1) { bumpI = k; break; }
      EM.V[bumpI][comp] += 0.5; var bx = EM.V[bumpI][comp];
      R.editState.mirror = true; R.editState.mirrorAxis = ax; EM._refresh(); EM.applyMirror();
      if (EM.V.length >= n0 * 2) throw new Error('axis ' + comp + ': seam not welded after Apply Mirror');
      if (!EM.V.some(function (v) { return Math.abs(v[comp] - bx) < 1e-6; }) || !EM.V.some(function (v) { return Math.abs(v[comp] + bx) < 1e-6; }))
        throw new Error('axis ' + comp + ': bumped vertex or its mirror missing after bake');
      var c = new THREE.Vector3(); EM.V.forEach(function (v) { c.add(v); }); c.divideScalar(EM.V.length);
      EM.F.forEach(function (f, fi) { var nrm = EM._faceNormal(fi), fc = EM._faceCenter(fi); if (nrm.dot(fc.clone().sub(c)) < -0.01) throw new Error('axis ' + comp + ': face ' + fi + ' points inward after bake (winding not reversed correctly)'); });
    });
    R.editState.mirror = false; R.editState.mirrorAxis = 0;
  }));

  await step('prefers-reduced-motion collapses the bottom-sheet slide, default motion untouched', async () => {
    // default (motion allowed): the sheet slide keeps its real duration
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    var dflt = await page.evaluate(() => getComputedStyle(document.getElementById('panel')).transitionDuration);
    if (parseFloat(dflt) < 0.1) throw new Error('default sheet transition should be animated, got ' + dflt);
    // reduce: every transition (incl. the big translateY sheet slide) snaps to near-instant
    await page.emulateMedia({ reducedMotion: 'reduce' });
    var red = await page.evaluate(() => ({
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      panel: getComputedStyle(document.getElementById('panel')).transitionDuration
    }));
    if (!red.matches) throw new Error('reduced-motion media did not activate under emulation');
    if (parseFloat(red.panel) > 0.01) throw new Error('sheet transition not neutralized under reduced-motion, got ' + red.panel);
    await page.emulateMedia({ reducedMotion: 'no-preference' }); // restore for later steps
  });

  await step('icon-only controls (FABs, RotBall) expose an accessible name', () => page.evaluate(() => {
    function accName(id) { var e = document.getElementById(id); if (!e) return null; return (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim(); }
    ['fabBuild', 'fabScene', 'rotBall'].forEach(function (id) {
      var n = accName(id);
      // FABs render only a "+" glyph and the canvas has no text at all — without a label a
      // screen reader announces nothing meaningful, so require a real (>1 char) name.
      if (!n || n === '+' || n.length < 2) throw new Error(id + ' has no accessible name (got ' + JSON.stringify(n) + ')');
    });
  }));

  await step('paint UV state survives save/restore (proper-UV flag + atlas base geometry)', async () => {
    await page.evaluate(() => {
      var R = __R; R.clearAutosave(); R.state.models.length = 0;
      // atlas-path primitive, 3D-painted -> atlas promoted into base geometry
      var cube = R.makeModel('Cube', [{ geo: new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), mat: R.makeMaterial({ color: 0xffffff }) }]);
      R.addModel(cube); R.setActiveModel(cube.userData.id); R.setView('paint'); R.paint.part = 0; R.ensureAtlasUVs(cube, 0);
      // proper-UV model, flagged
      var d = R.buildDonut(); d.userData.name = 'ProperUV'; d.userData.parts[0]._hasProperUVs = true; R.addModel(d);
      R.doAutosave();
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__R && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => {
      var R = __R, r = {};
      R.state.models.forEach(function (m) { var p = m.userData.parts[0], g = p.mesh.geometry; r[m.userData.name] = { indexed: !!g.index, atlas: !!p._atlasUVs, baseAtlas: !!p._baseIsAtlas, proper: !!p._hasProperUVs }; });
      return r;
    });
    // proper-UV flag must survive so post-reload 3D paint stays non-destructive
    if (!st.ProperUV || !st.ProperUV.proper) throw new Error('_hasProperUVs was lost across save/restore — 3D paint would scramble the texture again after reload');
    // atlas cube must restore as consistent atlas geometry (matches its atlas-layout canvas)
    if (!st.Cube || st.Cube.indexed || !st.Cube.baseAtlas || !st.Cube.atlas) throw new Error('atlas-painted primitive did not restore as atlas geometry: ' + JSON.stringify(st.Cube));
    await page.evaluate(() => { __R.clearAutosave(); });
  });

  await step('scene composition (placements + lights + background) survives save/restore', async () => {
    await page.evaluate(() => {
      var R = __R; R.clearAutosave(); R.state.models.length = 0;
      var d = R.buildDonut(); d.userData.name = 'D'; R.addModel(d); R.setActiveModel(d.userData.id);
      R.setView('scene');
      R.addPlacement(d.userData.id); R.addPlacement(d.userData.id);
      var pls = R.sceneScene.userData.holder.children.filter(function (c) { return c.userData && c.userData.placement; });
      pls[1].position.set(1.5, 0.7, -2.3);
      R.addLight('Point');
      var lt = R.sceneScene.userData.lights.children.filter(function (c) { return c.isLight; })[0];
      lt.intensity = 7.5; lt.color.set('#ff8800'); lt.position.set(-2, 4, 1); lt.userData.helper.position.copy(lt.position);
      R.sceneScene.background = new THREE.Color('#123456');
      R.doAutosave();
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__R && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => {
      var R = __R;
      var pls = R.sceneScene.userData.holder.children.filter(function (c) { return c.userData && c.userData.placement; });
      var lts = R.sceneScene.userData.lights.children.filter(function (c) { return c.isLight; });
      var helpers = R.sceneScene.userData.lights.children.filter(function (c) { return c.isMesh; });
      var pt = lts.filter(function (L) { return L.userData.kind === 'Point'; })[0];
      return {
        nPlace: pls.length, nLight: lts.length, nHelper: helpers.length,
        p2: pls[1] ? pls[1].position.toArray() : null,
        linked: pls[0] ? !!R.getModel(pls[0].userData.modelId) : false,
         int: pt ? pt.intensity : null, col: pt ? '#' + pt.color.getHexString() : null,
        bg: (R.sceneScene.background && R.sceneScene.background.getHexString) ? '#' + R.sceneScene.background.getHexString() : null
      };
    });
    if (s.nPlace !== 2) throw new Error('placements not restored: ' + s.nPlace);
    if (!s.linked) throw new Error('restored placement did not re-link to its model (model id not preserved)');
    if (!s.p2 || Math.abs(s.p2[0] - 1.5) > 1e-4 || Math.abs(s.p2[2] + 2.3) > 1e-4) throw new Error('placement transform lost: ' + JSON.stringify(s.p2));
    if (s.nLight !== 1 || s.nHelper !== 1) throw new Error('lights/helpers not restored: lights=' + s.nLight + ' helpers=' + s.nHelper);
    if (Math.abs(s.int - 7.5) > 1e-4 || s.col !== '#ff8800') throw new Error('light params lost: int=' + s.int + ' col=' + s.col);
    if (s.bg !== '#123456') throw new Error('scene background not restored: ' + s.bg);
    await page.evaluate(() => { __R.clearAutosave(); });
  });

  await step('autosave writes + restores across reload', async () => {
    await page.evaluate(() => { __R.clearAutosave(); });
    await page.evaluate(() => {
      var R = __R;
      R.state.models.length = 0;
      var d = R.buildDonut(); d.userData.name = 'AutosaveDonut'; R.addModel(d);
      R.doAutosave();
    });
    const raw = await page.evaluate(() => localStorage.getItem(__R.AUTOSAVE_KEY));
    if (!raw || !JSON.parse(raw).models.length) throw new Error('autosave did not persist to localStorage');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__R && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    const restoredName = await page.evaluate(() => __R.state.models[0] && __R.state.models[0].userData.name);
    if (restoredName !== 'AutosaveDonut') throw new Error('restored model name mismatch: ' + restoredName);
    const restoredView = await page.evaluate(() => __R.active.view);
    if (restoredView !== 'edit') throw new Error('app should always land on the mesh editor on boot (even after restoring an autosave), got ' + restoredView);
    await page.evaluate(() => { __R.clearAutosave(); });
  });

  await page.evaluate(() => __R.setView('edit'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SP, 'mobile-edit.png') });
  await browser.close();
  server.close();

  console.log('\n==== RESULT ====');
  if (errors.length) { console.log('FAILURES (' + errors.length + '):'); errors.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('ALL CLEAN');
})().catch(e => { console.error('fatal:', e); process.exit(2); });
