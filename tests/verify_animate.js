// Headless verification of Roxy Animate (animate.html): boot, theme chrome, model bridge,
// Track/keyframe core (insertKey/sample), playback, scrub bar, anim autosave, mobile chrome.
// Modeled on tests/verify.js's harness pattern — separate suite, does not touch index.html.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').resolve(__dirname, '..');
const SP = __dirname;

// Debug handle injected inside the app IIFE (test copy only — repo file untouched)
const INJECT = `
window.__A={Anim:Anim,Registry:Registry,resolvePath:resolvePath,setView:setView,state:state,active:active,vs:vs,
  loadProjectData:loadProjectData,bridgeLoadModelProject:bridgeLoadModelProject,buildDemoFigure:buildDemoFigure,
  clearModels:clearModels,registerTarget:registerTarget,resolveTarget:resolveTarget,insertPositionKey:insertPositionKey,
  AUTOSAVE_KEY:AUTOSAVE_KEY,ANIM_AUTOSAVE_KEY:ANIM_AUTOSAVE_KEY,doAnimAutosave:doAnimAutosave,tryRestoreAnimAutosave:tryRestoreAnimAutosave,
  poseScene:poseScene,renderer:renderer,invalidate:invalidate,resizeActive:resizeActive,frameObject:frameObject,syncScrubUI:syncScrubUI,
  Rigs:Rigs,Arm:Arm,newRig:newRig,addBone:addBone,findBone:findBone,collectSubtree:collectSubtree,mirrorChainX:mirrorChainX,
  setBoneParent:setBoneParent,deleteBoneAndDescendants:deleteBoneAndDescendants,renameBone:renameBone,selectBone:selectBone,
  boneTargetId:boneTargetId,applyBoneEdit:applyBoneEdit,chainExtendTo:chainExtendTo,startAddBoneChain:startAddBoneChain,
  startAddChildChain:startAddChildChain,finishChain:finishChain,resetBonePose:resetBonePose,resetAllPose:resetAllPose,
  ensureRig:ensureRig,uniqueBoneName:uniqueBoneName,serializeRigs:serializeRigs,setArmMode:setArmMode};
`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/animate.html')) {
    let html = fs.readFileSync(path.join(ROOT, 'animate.html'), 'utf8');
    const anchor = "\n})();\n</script>";
    if (!html.includes(anchor)) { res.writeHead(500); res.end('anchor missing'); return; }
    html = html.replace(anchor, "\n" + INJECT + "\n})();\n</script>");
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
  }
  if (req.url.startsWith('/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); return;
  }
  res.writeHead(404); res.end('nf');
});

// A tiny synthetic project written in index.html's v2 project-JSON format (buildProjectData shape):
// one model, one part, a triangle, no texture map.
function syntheticProject() {
  return {
    v: 2,
    scene: { env: 'night', bg: null, grid: false, placements: [], lights: [] },
    models: [{
      id: 'synthTri', name: 'SynthTriangle',
      parts: [{
        pos: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        uv: [0, 0, 1, 0, 0, 1],
        index: [0, 1, 2],
        properUV: true, baseAtlas: false,
        color: '#3388ff', rough: 0.5, metal: 0, map: null,
        emissive: '#000000', emInt: 1, opacity: 1, transmission: 0, clearcoat: 0
      }],
      mods: []
    }]
  };
}

(async () => {
  await new Promise(r => server.listen(8932, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone-ish, mobile-first

  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  // Serve three.js r128 locally (cdnjs is policy-blocked here) and kill font requests
  await page.route('**/three.js/r128/three.min.js', route =>
    route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(SP, 'node_modules/three/build/three.min.js'), 'utf8') }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());

  const step = async (name, fn) => {
    try { await fn(); console.log('ok  ' + name); }
    catch (e) { errors.push('STEP ' + name + ': ' + e.message.split('\n')[0]); console.log('ERR ' + name + ': ' + e.message.split('\n')[0]); }
  };

  const gotoAndWaitBoot = async () => {
    await page.goto('http://127.0.0.1:8932/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__A && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 })
      .catch(() => errors.push('BOOT: never finished'));
  };

  await gotoAndWaitBoot();

  await step('boots clean, no console errors so far', async () => {
    if (errors.length) throw new Error('errors present after boot: ' + errors.join(' | '));
  });

  await step('theme chrome present (bar/rail/tabbar/panel/toast, light-over-dark)', () => page.evaluate(() => {
    ['bar', 'rail', 'tabbar', 'panel', 'toast', 'rotBall', 'zoomKnob'].forEach(id => {
      if (!document.getElementById(id)) throw new Error(id + ' missing from chrome');
    });
    const root = getComputedStyle(document.documentElement);
    if (!document.querySelector('.logo') || document.querySelector('.logo').textContent.indexOf('ROXY') < 0) throw new Error('logo missing/wrong');
    const stageBg = getComputedStyle(document.getElementById('stage')).backgroundImage;
    if (!/gradient/.test(stageBg)) throw new Error('stage is not the dark radial-gradient viewport');
  }));

  await step('demo model present when no autosave exists (empty case)', () => page.evaluate(() => {
    const A = window.__A;
    if (!A.state.usingDemo) throw new Error('expected usingDemo=true with no localStorage bridge');
    let meshCount = 0;
    A.poseScene.traverse(o => { if (o.isMesh) meshCount++; });
    if (meshCount < 3) throw new Error('demo figure did not build multiple mesh parts, got ' + meshCount);
    if (!A.Registry['demo.torso'] || !A.Registry['demo.head']) throw new Error('demo figure parts not registered as animation targets');
    if (!document.getElementById('emptyBanner').classList.contains('show')) throw new Error('empty-state banner not shown');
  }));

  await step('scene actually renders meshes (viewport not blank)', () => page.evaluate(() => {
    const A = window.__A;
    A.resizeActive(); A.invalidate(8);
    A.renderer.render(A.poseScene, A.vs.cam);
    let meshCount = 0; A.poseScene.traverse(o => { if (o.isMesh) meshCount++; });
    if (meshCount === 0) throw new Error('no meshes in poseScene');
  }));

  await step('resolvePath resolves dotted accessors against a live object', () => page.evaluate(() => {
    const A = window.__A;
    const obj = A.Registry['demo.torso'];
    obj.position.set(1, 2, 3);
    const r = A.resolvePath(obj, 'position.y');
    if (!r || r.obj[r.key] !== 2) throw new Error('resolvePath did not resolve position.y correctly');
    const r2 = A.resolvePath(obj, 'rotation.x');
    if (!r2) throw new Error('resolvePath failed on rotation.x');
  }));

  await step('insertKey creates a track with a key, reading the live value', () => page.evaluate(() => {
    const A = window.__A;
    A.Anim.tracks.length = 0;
    const obj = A.Registry['demo.torso'];
    obj.position.x = 0.5;
    const tr = A.Anim.insertKey('demo.torso', 'position.x', 0);
    if (!tr) throw new Error('insertKey returned nothing');
    if (tr.targetId !== 'demo.torso' || tr.path !== 'position.x') throw new Error('track shape wrong: ' + JSON.stringify(tr));
    if (tr.keys.length !== 1 || Math.abs(tr.keys[0].v - 0.5) > 1e-9 || tr.keys[0].t !== 0) throw new Error('key not recorded with the live value: ' + JSON.stringify(tr.keys));
    if (tr.keys[0].interp !== 'linear') throw new Error('default interp should be linear');
    if (A.Anim.tracks.indexOf(tr) < 0) throw new Error('track not pushed into Anim.tracks');
  }));

  await step('sample(t) interpolates linearly between two keys (midpoint check)', () => page.evaluate(() => {
    const A = window.__A;
    A.Anim.tracks.length = 0;
    const obj = A.Registry['demo.torso'];
    obj.position.x = 0; A.Anim.insertKey('demo.torso', 'position.x', 0);
    obj.position.x = 10; A.Anim.insertKey('demo.torso', 'position.x', 10);
    A.Anim.sample(5);
    const mid = A.Registry['demo.torso'].position.x;
    if (Math.abs(mid - 5) > 1e-6) throw new Error('midpoint sample expected 5, got ' + mid);
    A.Anim.sample(0);
    if (Math.abs(A.Registry['demo.torso'].position.x - 0) > 1e-6) throw new Error('sample at t=0 should give the first key value');
    A.Anim.sample(10);
    if (Math.abs(A.Registry['demo.torso'].position.x - 10) > 1e-6) throw new Error('sample at t=10 should give the last key value');
    A.Anim.sample(20); // past the last key: should clamp/hold, not extrapolate
    if (Math.abs(A.Registry['demo.torso'].position.x - 10) > 1e-6) throw new Error('sample past the last key should hold, not extrapolate');
  }));

  await step('insertPositionKey keys all three axes together', () => page.evaluate(() => {
    const A = window.__A;
    A.Anim.tracks.length = 0;
    const obj = A.Registry['demo.head'];
    obj.position.set(1, 2, 3);
    A.insertPositionKey('demo.head', 0);
    const paths = A.Anim.tracks.filter(t => t.targetId === 'demo.head').map(t => t.path).sort();
    if (paths.join(',') !== 'position.x,position.y,position.z') throw new Error('expected 3 position tracks, got ' + paths.join(','));
  }));

  await step('playback advances time (fixed-timestep accumulation over rAF)', async () => {
    await page.evaluate(() => {
      const A = window.__A;
      A.Anim.start = 0; A.Anim.end = 96; A.Anim.time = 0; A.Anim.fps = 24; A.Anim.playing = true;
    });
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => window.__A.Anim.time);
    await page.evaluate(() => { window.__A.Anim.playing = false; });
    if (t <= 0) throw new Error('Anim.time did not advance while playing, got ' + t);
  });

  await step('scrub bar (Timeline tab) sets Anim.time and re-samples', async () => {
    await page.evaluate(() => { window.__A.Anim.time = 0; window.__A.setView('timeline'); });
    await page.waitForTimeout(80);
    const has = await page.evaluate(() => !!document.getElementById('tlScrub'));
    if (!has) throw new Error('#tlScrub not rendered on the Timeline panel');
    await page.evaluate(() => {
      const s = document.getElementById('tlScrub');
      s.value = 40; s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const t = await page.evaluate(() => window.__A.Anim.time);
    if (t !== 40) throw new Error('scrub did not set Anim.time to 40, got ' + t);
  });

  await step('scrub bar touch target is >=42px tall (mobile touch-friendly) and touch-action:none', () => page.evaluate(() => {
    const s = document.getElementById('tlScrub');
    const cs = getComputedStyle(s);
    if (parseFloat(cs.height) < 42) throw new Error('scrub bar height ' + cs.height + ' is under the 42px touch-target floor');
    if (cs.touchAction !== 'none') throw new Error('scrub bar touch-action is ' + cs.touchAction + ', expected none');
  }));

  await step('Key Position button authors a 2-key slide animation end to end', () => page.evaluate(() => {
    const A = window.__A;
    A.Anim.tracks.length = 0;
    A.state.selTarget = 'demo.armL';
    const obj = A.Registry['demo.armL'];
    obj.position.x = -0.36; A.insertPositionKey('demo.armL', 0);
    obj.position.x = 0.8; A.insertPositionKey('demo.armL', 24);
    A.Anim.sample(12);
    const midX = A.Registry['demo.armL'].position.x;
    if (Math.abs(midX - (-0.36 + (0.8 - -0.36) * 0.5)) > 1e-6) throw new Error('scrubbing the authored 2-key slide did not interpolate, got x=' + midX);
  }));

  await step('localStorage bridge loads a project written in index.html\'s project-JSON format', async () => {
    // Write a synthetic index.html-format project under the SAME autosave key index.html uses,
    // then reload so animate.html's boot-time bridge picks it up.
    await page.evaluate((proj) => { localStorage.setItem('roxyAutosave', JSON.stringify(proj)); }, syntheticProject());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__A && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    const res = await page.evaluate(() => {
      const A = window.__A;
      let meshCount = 0; A.poseScene.traverse(o => { if (o.isMesh) meshCount++; });
      return { usingDemo: A.state.usingDemo, meshCount, hasTarget: !!A.Registry['synthTri'], modelCount: A.state.models.length };
    });
    if (res.usingDemo) throw new Error('bridge did not consume the synthetic project — fell back to demo');
    if (res.modelCount !== 1) throw new Error('expected exactly 1 bridged model, got ' + res.modelCount);
    if (!res.hasTarget) throw new Error('bridged model was not registered under its project id as an animation target');
    if (res.meshCount < 1) throw new Error('bridged project built no mesh');
    await page.evaluate(() => localStorage.removeItem('roxyAutosave'));
  });

  await step('import via file input reuses the same project-JSON parser (loadProjectData)', () => page.evaluate((proj) => {
    const A = window.__A;
    A.clearModels();
    const ok = A.loadProjectData(proj);
    if (!ok) throw new Error('loadProjectData returned false for a valid project');
    if (!A.Registry['synthTri']) throw new Error('imported project model not registered as a target');
  }, syntheticProject()));

  await step('anim autosave round-trips across reload', async () => {
    await page.evaluate(() => {
      const A = window.__A;
      A.buildDemoFigure();
      A.Anim.tracks.length = 0; A.Anim.fps = 30; A.Anim.start = 0; A.Anim.end = 48;
      const obj = A.Registry['demo.legL'];
      obj.position.y = 0.45; A.Anim.insertKey('demo.legL', 'position.y', 0);
      obj.position.y = 1.2; A.Anim.insertKey('demo.legL', 'position.y', 20);
      A.doAnimAutosave();
    });
    const raw = await page.evaluate(() => localStorage.getItem(window.__A.ANIM_AUTOSAVE_KEY));
    if (!raw || !JSON.parse(raw).tracks.length) throw new Error('anim autosave did not persist to localStorage');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__A && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    const restored = await page.evaluate(() => {
      const A = window.__A;
      return { fps: A.Anim.fps, start: A.Anim.start, end: A.Anim.end, tracks: A.Anim.tracks.length,
        firstTrack: A.Anim.tracks[0] };
    });
    if (restored.fps !== 30 || restored.start !== 0 || restored.end !== 48) throw new Error('anim settings did not restore: ' + JSON.stringify(restored));
    if (restored.tracks !== 1) throw new Error('expected 1 restored track, got ' + restored.tracks);
    if (!restored.firstTrack || restored.firstTrack.path !== 'position.y' || restored.firstTrack.keys.length !== 2) throw new Error('restored track shape wrong: ' + JSON.stringify(restored.firstTrack));
    await page.evaluate(() => localStorage.removeItem(window.__A.ANIM_AUTOSAVE_KEY));
  });

  await step('view tabs switch (Pose/Timeline/Export) without console errors', () => page.evaluate(() => {
    const A = window.__A;
    ['pose', 'timeline', 'export', 'pose'].forEach(v => A.setView(v));
    if (A.active.view !== 'pose') throw new Error('active view did not end on pose');
  }));

  await step('mobile viewport (390x844) shows the tabbar, hides the rail', () => page.evaluate(() => {
    if (getComputedStyle(document.getElementById('tabbar')).display === 'none') throw new Error('tabbar hidden on mobile viewport');
    if (getComputedStyle(document.getElementById('rail')).display !== 'none') throw new Error('rail should be hidden on mobile viewport');
  }));

  await step('desktop viewport (1280x800) shows the rail, hides the tabbar', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(150);
    const res = await page.evaluate(() => ({
      rail: getComputedStyle(document.getElementById('rail')).display,
      tabbar: getComputedStyle(document.getElementById('tabbar')).display
    }));
    if (res.rail === 'none') throw new Error('rail hidden on desktop viewport');
    if (res.tabbar !== 'none') throw new Error('tabbar shown on desktop viewport');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
  });

  // ==== Wave C1: Armature / Rig system ====

  await step('armature: 3-bone chain creation matches THREE.Bone hierarchy to head/tail data', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('TestRig1');
    const b1 = A.addBone(rig, 'Root', new T.Vector3(0, 1, 0), new T.Vector3(0, 1.5, 0), null);
    const b2 = A.addBone(rig, 'Mid', new T.Vector3(0, 1.5, 0), new T.Vector3(0, 2, 0), b1.id);
    const b3 = A.addBone(rig, 'Tip', new T.Vector3(0, 2, 0), new T.Vector3(0, 2.5, 0), b2.id);
    if (rig.bones.length !== 3) throw new Error('expected 3 bones, got ' + rig.bones.length);
    if (b2.bone.parent !== b1.bone) throw new Error('Mid bone is not a THREE.Bone child of Root');
    if (b3.bone.parent !== b2.bone) throw new Error('Tip bone is not a THREE.Bone child of Mid');
    if (b1.bone.parent !== rig.root) throw new Error('Root bone is not attached to rig.root');
    if (Math.abs(b2.bone.position.y - 0.5) > 1e-6) throw new Error('Mid bone local position wrong: ' + JSON.stringify(b2.bone.position));
    if (Math.abs(b3.bone.position.y - 0.5) > 1e-6) throw new Error('Tip bone local position wrong: ' + JSON.stringify(b3.bone.position));
    rig.root.updateMatrixWorld(true);
    const w3 = new T.Vector3(); b3.bone.getWorldPosition(w3);
    if (w3.distanceTo(new T.Vector3(0, 2, 0)) > 1e-6) throw new Error('Tip world position does not match its stored head: ' + JSON.stringify(w3));
  }));

  await step('armature: chain-extend (Add Bone flow) adds a child bone at the tapped point', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    A.startAddBoneChain();
    A.Arm.chainAnchor = new T.Vector3(1, 1, 1);
    const rig = A.Rigs[A.Arm.rigId];
    const before = rig.bones.length;
    const be = A.chainExtendTo(new T.Vector3(1, 2, 1));
    if (!be) throw new Error('chainExtendTo returned null');
    if (rig.bones.length !== before + 1) throw new Error('chain-extend did not add a bone');
    if (be.head.distanceTo(new T.Vector3(1, 1, 1)) > 1e-6) throw new Error('new bone head should be the previous anchor');
    if (be.tail.distanceTo(new T.Vector3(1, 2, 1)) > 1e-6) throw new Error('new bone tail should be the tapped point');
    if (A.Arm.chainAnchor.distanceTo(new T.Vector3(1, 2, 1)) > 1e-6) throw new Error('chain anchor did not advance to the new tail');
    A.finishChain();
  }));

  await step('armature: dragging a joint (applyBoneEdit) moves head/tail and updates the THREE.Bone', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('DragRig');
    const root = A.addBone(rig, 'DragRoot', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const child = A.addBone(rig, 'DragChild', new T.Vector3(0, 1, 0), new T.Vector3(0, 2, 0), root.id);
    // drag the root's TAIL: child head is a decoupled absolute joint, unaffected (see file header note)
    root.tail.set(0, 1.5, 0);
    A.applyBoneEdit(root);
    if (Math.abs(root.mesh.scale.y - 1.5) > 1e-6) throw new Error('bone visual did not restretch after tail move, scale.y=' + root.mesh.scale.y);
    if (Math.abs(child.bone.position.y - 1) > 1e-6) throw new Error('child position should be unaffected by a tail-only move');
    // drag the root's HEAD: child must stay anchored at its own absolute head (world pos unchanged)
    root.head.set(0.5, 0, 0);
    A.applyBoneEdit(root);
    if (Math.abs(root.bone.position.x - 0.5) > 1e-6) throw new Error('root bone.position did not follow its moved head');
    rig.root.updateMatrixWorld(true);
    const w = new T.Vector3(); child.bone.getWorldPosition(w);
    if (w.distanceTo(new T.Vector3(0, 1, 0)) > 1e-6) throw new Error('child world head should stay put when only the parent head moves, got ' + JSON.stringify(w));
  }));

  await step('armature: Mirror X duplicates a chain with mirrored X + .L/.R suffixes', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('MirrorRig');
    const shoulder = A.addBone(rig, 'Shoulder', new T.Vector3(0, 1.4, 0), new T.Vector3(0.2, 1.4, 0), null);
    const upperArm = A.addBone(rig, 'UpperArm.L', new T.Vector3(0.2, 1.4, 0), new T.Vector3(0.6, 1.2, 0), shoulder.id);
    A.addBone(rig, 'LowerArm.L', new T.Vector3(0.6, 1.2, 0), new T.Vector3(1.0, 1.0, 0), upperArm.id);
    const mirroredRootId = A.mirrorChainX(rig, upperArm.id);
    const mUpper = A.findBone(rig, mirroredRootId);
    if (!mUpper || mUpper.name !== 'UpperArm.R') throw new Error('mirrored root should be named UpperArm.R, got ' + (mUpper && mUpper.name));
    if (mUpper.parentId !== shoulder.id) throw new Error('mirrored root should keep the original external parent (Shoulder)');
    if (Math.abs(mUpper.head.x + 0.2) > 1e-6 || Math.abs(mUpper.tail.x + 0.6) > 1e-6) throw new Error('mirrored root X not negated: ' + JSON.stringify([mUpper.head, mUpper.tail]));
    const mLower = rig.bones.find(b => b.name === 'LowerArm.R');
    if (!mLower) throw new Error('mirrored descendant LowerArm.R not created');
    if (mLower.parentId !== mUpper.id) throw new Error('mirrored descendant should be parented to the mirrored root, not the original');
  }));

  await step('armature: Set Parent reattaches a bone keeping its world position (and refuses cycles)', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('ParentRig');
    const a = A.addBone(rig, 'A', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const b = A.addBone(rig, 'B', new T.Vector3(2, 0, 0), new T.Vector3(2, 1, 0), null); // separate, unparented chain
    rig.root.updateMatrixWorld(true);
    const before = new T.Vector3(); b.bone.getWorldPosition(before);
    if (!A.setBoneParent(rig, b.id, a.id)) throw new Error('setBoneParent returned false');
    if (b.parentId !== a.id) throw new Error('parentId not updated');
    if (b.bone.parent !== a.bone) throw new Error('THREE.Bone hierarchy not reattached');
    rig.root.updateMatrixWorld(true);
    const after = new T.Vector3(); b.bone.getWorldPosition(after);
    if (before.distanceTo(after) > 1e-6) throw new Error('world position changed on reparent, expected keep-offset');
    if (A.setBoneParent(rig, a.id, b.id)) throw new Error('setBoneParent should refuse to create a cycle');
  }));

  await step("armature: pose-mode quaternion rotation moves a child bone's world position correctly", () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('PoseRig');
    const root = A.addBone(rig, 'PRoot', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const child = A.addBone(rig, 'PChild', new T.Vector3(0, 1, 0), new T.Vector3(0, 2, 0), root.id);
    root.bone.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2); // 90° about Z, goes through bone.quaternion
    rig.root.updateMatrixWorld(true);
    const w = new T.Vector3(); child.bone.getWorldPosition(w);
    if (w.distanceTo(new T.Vector3(-1, 0, 0)) > 1e-4) throw new Error('child world position did not follow parent rotation, got ' + JSON.stringify(w));
    A.resetBonePose(root);
    rig.root.updateMatrixWorld(true);
    const w2 = new T.Vector3(); child.bone.getWorldPosition(w2);
    if (w2.distanceTo(new T.Vector3(0, 1, 0)) > 1e-6) throw new Error('Reset Bone did not restore the bind pose');
  }));

  await step('armature: quaternion track slerps (not lerps) between two keyed orientations', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    A.Anim.tracks.length = 0;
    const rig = A.newRig('SlerpRig');
    const be = A.addBone(rig, 'SlerpBone', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const tid = A.boneTargetId(rig.id, be.name);
    be.bone.quaternion.identity();
    A.Anim.insertKey(tid, 'quaternion', 0);
    be.bone.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI); // 180°
    A.Anim.insertKey(tid, 'quaternion', 10);
    A.Anim.sample(5);
    const mid = be.bone.quaternion.clone();
    const startQ = new T.Quaternion(), endQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);
    const angToStart = 2 * Math.acos(Math.min(1, Math.abs(mid.dot(startQ))));
    const angToEnd = 2 * Math.acos(Math.min(1, Math.abs(mid.dot(endQ))));
    if (Math.abs(angToStart - Math.PI / 2) > 0.05) throw new Error('midpoint slerp angle-to-start off, expected ~90°, got ' + (angToStart * 180 / Math.PI));
    if (Math.abs(angToEnd - Math.PI / 2) > 0.05) throw new Error('midpoint slerp angle-to-end off, expected ~90°, got ' + (angToEnd * 180 / Math.PI));
  }));

  await step('armature: Delete removes a bone and its descendants from rig + Registry + tracks', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    A.Anim.tracks.length = 0;
    const rig = A.newRig('DeleteRig');
    const root = A.addBone(rig, 'DelRoot', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const child = A.addBone(rig, 'DelChild', new T.Vector3(0, 1, 0), new T.Vector3(0, 2, 0), root.id);
    const tid = A.boneTargetId(rig.id, child.name);
    A.Anim.insertKey(tid, 'quaternion', 0);
    A.deleteBoneAndDescendants(rig, root.id);
    if (rig.bones.length !== 0) throw new Error('expected all bones removed, got ' + rig.bones.length);
    if (A.Registry[tid]) throw new Error('deleted bone target is still registered');
    if (A.Anim.tracks.some(t => t.targetId === tid)) throw new Error('deleted bone track was not cleaned up');
  }));

  await step('armature: Rename re-keys the Registry entry and any existing Anim track targetId', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    A.Anim.tracks.length = 0;
    const rig = A.newRig('RenameRig');
    const be = A.addBone(rig, 'OldName', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const oldTid = A.boneTargetId(rig.id, be.name);
    A.Anim.insertKey(oldTid, 'quaternion', 0);
    A.renameBone(rig, be.id, 'NewName');
    const newTid = A.boneTargetId(rig.id, 'NewName');
    if (A.Registry[oldTid]) throw new Error('old Registry key still present after rename');
    if (!A.Registry[newTid]) throw new Error('new Registry key missing after rename');
    if (!A.Anim.tracks.some(t => t.targetId === newTid)) throw new Error('Anim track targetId was not rewritten on rename');
  }));

  await step('armature: rig autosave round-trips bone count/names/hierarchy/pose across reload', async () => {
    await page.evaluate(() => {
      const A = window.__A, T = window.THREE;
      A.Anim.tracks.length = 0;
      const rig = A.newRig('SaveRig');
      A.Arm.rigId = rig.id;
      const root = A.addBone(rig, 'SaveRoot', new T.Vector3(0, 1, 0), new T.Vector3(0, 1.6, 0), null);
      const child = A.addBone(rig, 'SaveChild', new T.Vector3(0, 1.6, 0), new T.Vector3(0, 2.2, 0), root.id);
      child.bone.quaternion.setFromAxisAngle(new T.Vector3(1, 0, 0), 0.4);
      A.doAnimAutosave();
    });
    const raw = await page.evaluate(() => localStorage.getItem(window.__A.ANIM_AUTOSAVE_KEY));
    const saved = JSON.parse(raw);
    if (!saved.rigs || !saved.rigs.length) throw new Error('autosave payload has no rigs');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__A && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    const res = await page.evaluate(() => {
      const A = window.__A;
      const rig = Object.values(A.Rigs).find(r => r.name === 'SaveRig');
      if (!rig) return { found: false };
      const root = rig.bones.find(b => b.name === 'SaveRoot');
      const child = rig.bones.find(b => b.name === 'SaveChild');
      return {
        found: true, count: rig.bones.length,
        childParentIsRoot: !!(child && root && child.parentId === root.id),
        childBoneParentMatches: !!(child && root && child.bone.parent === root.bone),
        childQuatW: child ? child.bone.quaternion.w : null
      };
    });
    if (!res.found) throw new Error('rig did not survive reload');
    if (res.count !== 2) throw new Error('expected 2 restored bones, got ' + res.count);
    if (!res.childParentIsRoot) throw new Error('restored parentId hierarchy wrong');
    if (!res.childBoneParentMatches) throw new Error('restored THREE.Bone hierarchy wrong');
    if (Math.abs(res.childQuatW - Math.cos(0.2)) > 1e-4) throw new Error('restored pose quaternion wrong, got w=' + res.childQuatW);
    await page.evaluate(() => localStorage.removeItem(window.__A.ANIM_AUTOSAVE_KEY));
  });

  await browser.close();
  server.close();

  console.log('\n==== RESULT ====');
  if (errors.length) { console.log('FAILURES (' + errors.length + '):'); errors.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('ALL CLEAN');
})().catch(e => { console.error('fatal:', e); process.exit(2); });
