// Headless verification of Roxy Animate (animate.html): boot, theme chrome, model bridge,
// Track/keyframe core (insertKey/sample), playback, scrub bar, anim autosave, mobile chrome,
// armatures (C1), FK axis constraints + rotation limits + CCD IK + pole targets (C3),
// Copy Location/Rotation + Track-To + Limit Rotation constraints on bones and objects (C4).
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
  ensureRig:ensureRig,uniqueBoneName:uniqueBoneName,serializeRigs:serializeRigs,setArmMode:setArmMode,
  solveIK:solveIK,applyPoleBend:applyPoleBend,buildIkChain:buildIkChain,ikSelectTip:ikSelectTip,setIkOn:setIkOn,
  setIkPoleOn:setIkPoleOn,setIkChainLen:setIkChainLen,runIkSolve:runIkSolve,clampBoneRotation:clampBoneRotation,
  setBoneLimit:setBoneLimit,applyAxisRotationStep:applyAxisRotationStep,setBoneEulerAxisDeg:setBoneEulerAxisDeg,
  boneEulerDeg:boneEulerDeg,renderPanel:renderPanel,
  ikHandles:function(){return {target:ikTargetMesh,pole:ikPoleMesh};},
  applyConstraints:applyConstraints,applyAllConstraints:applyAllConstraints,applyObjectConstraints:applyObjectConstraints,
  addConstraint:addConstraint,removeConstraint:removeConstraint,constraintListFor:constraintListFor,
  constraintTargetId:constraintTargetId,wouldCreateCycle:wouldCreateCycle,findBoneByTargetId:findBoneByTargetId,
  CONSTRAINT_LABELS:CONSTRAINT_LABELS};
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

  // ==== Wave C3: per-axis FK, rotation limits, CCD IK, pole targets ====

  await step('C3 FK: axis-constrained rotation only changes the chosen local-axis component (and the Free/X/Y/Z chips render)', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('AxisRig');
    const be = A.addBone(rig, 'AxisBone', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    be.bone.quaternion.identity();
    A.applyAxisRotationStep(be, 'z', 0.3);
    A.applyAxisRotationStep(be, 'z', 0.3); // second step must compose about the SAME local axis
    const e = new T.Euler().setFromQuaternion(be.bone.quaternion, 'XYZ');
    if (Math.abs(e.z - 0.6) > 1e-6) throw new Error('local-Z steps did not sum to 0.6 rad, got ' + e.z);
    if (Math.abs(e.x) > 1e-9 || Math.abs(e.y) > 1e-9) throw new Error('axis-constrained rotation leaked into X/Y: ' + e.x + ',' + e.y);
    // the Pose panel offers the Free/X/Y/Z axis chips as the touch UI for this
    A.setView('pose'); A.setArmMode('pose'); A.selectBone(rig, be.id); A.renderPanel();
    const texts = Array.from(document.querySelectorAll('#panelBody button')).map(b => b.textContent.trim());
    ['Free', 'X', 'Y', 'Z'].forEach(t => { if (!texts.includes(t)) throw new Error('axis chip "' + t + '" not rendered in the Pose panel'); });
    A.setArmMode('edit');
  }));

  await step('C3 FK: tap-to-type exact degrees sets the precise per-axis bone rotation', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('DegRig');
    const be = A.addBone(rig, 'DegBone', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    A.setBoneEulerAxisDeg(be, 'y', 45);
    A.setBoneEulerAxisDeg(be, 'x', -30); // must preserve the Y set before it
    const d = A.boneEulerDeg(be);
    if (Math.abs(d.y - 45) > 1e-4) throw new Error('typed 45° Y not applied exactly, got ' + d.y);
    if (Math.abs(d.x - -30) > 1e-4) throw new Error('typed -30° X not applied exactly, got ' + d.x);
    if (Math.abs(d.z) > 1e-4) throw new Error('Z should remain 0, got ' + d.z);
    const q = new T.Quaternion().setFromEuler(new T.Euler(-30 * Math.PI / 180, 45 * Math.PI / 180, 0, 'XYZ'));
    if (Math.abs(Math.abs(q.dot(be.bone.quaternion)) - 1) > 1e-6) throw new Error('quaternion does not match the typed euler exactly');
  }));

  // shared helper: build a fresh 3-bone chain straight up +Y, 0.5 per bone (total reach 1.5)
  const mkChain = `(function(){
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('IkRig' + Math.random().toString(36).slice(2, 7));
    const b1 = A.addBone(rig, 'C1', new T.Vector3(0, 0, 0), new T.Vector3(0, 0.5, 0), null);
    const b2 = A.addBone(rig, 'C2', new T.Vector3(0, 0.5, 0), new T.Vector3(0, 1, 0), b1.id);
    const b3 = A.addBone(rig, 'C3', new T.Vector3(0, 1, 0), new T.Vector3(0, 1.5, 0), b2.id);
    return { rig, chain: [b1, b2, b3] };
  })()`;

  await step('C3 IK: CCD brings a 3-bone chain tip within tolerance of a reachable target', () => page.evaluate((mk) => {
    const A = window.__A, T = window.THREE;
    const { rig, chain } = eval(mk);
    const target = new T.Vector3(0.6, 0.9, 0.3); // |target| ~1.12 < reach 1.5
    A.solveIK(chain, target, 100, { tolerance: 0.005 });
    rig.root.updateMatrixWorld(true);
    const tip = new T.Vector3(); chain[2].tailJoint.getWorldPosition(tip);
    const d = tip.distanceTo(target);
    if (d > 0.01) throw new Error('tip did not reach the target, dist=' + d);
    chain.forEach(be => { const q = be.bone.quaternion; [q.x, q.y, q.z, q.w].forEach(c => { if (!isFinite(c)) throw new Error('NaN in solved quaternion'); }); });
  }, mkChain));

  await step('C3 IK: unreachable target — chain straightens toward it (tip on the root-target ray, no NaNs)', () => page.evaluate((mk) => {
    const A = window.__A, T = window.THREE;
    const { rig, chain } = eval(mk);
    const target = new T.Vector3(2, 2, 0); // dist ~2.83 > reach 1.5
    A.solveIK(chain, target, 120, { tolerance: 0.005 });
    rig.root.updateMatrixWorld(true);
    const root = new T.Vector3(); chain[0].headJoint.getWorldPosition(root);
    const tip = new T.Vector3(); chain[2].tailJoint.getWorldPosition(tip);
    [tip.x, tip.y, tip.z].forEach(c => { if (!isFinite(c)) throw new Error('NaN in tip position'); });
    const dir = target.clone().sub(root).normalize();
    const v = tip.clone().sub(root);
    const offRay = v.clone().sub(dir.clone().multiplyScalar(v.dot(dir))).length(); // perpendicular distance from the root->target ray
    if (offRay > 0.05) throw new Error('tip is ' + offRay + ' off the root->target ray, chain did not straighten toward the target');
    if (Math.abs(v.length() - 1.5) > 0.05) throw new Error('straightened chain length should be ~1.5 (full reach), got ' + v.length());
  }, mkChain));

  await step('C3 IK: per-bone rotation limits are respected inside the solve (clamped joint never exceeds max)', () => page.evaluate((mk) => {
    const A = window.__A, T = window.THREE;
    const { rig, chain } = eval(mk);
    const lim = 0.2;
    A.setBoneLimit(chain[1], 'x', -lim, lim);
    A.setBoneLimit(chain[1], 'y', -lim, lim);
    A.setBoneLimit(chain[1], 'z', -lim, lim);
    A.solveIK(chain, new T.Vector3(0.7, 0.3, 0), 100, { tolerance: 0.005 }); // target needing sharp bends
    const e = new T.Euler().setFromQuaternion(chain[1].bone.quaternion, 'XYZ');
    ['x', 'y', 'z'].forEach(ax => {
      if (Math.abs(e[ax]) > lim + 1e-4) throw new Error('limited joint exceeded its clamp on ' + ax + ': ' + e[ax] + ' rad (limit ±' + lim + ')');
    });
    // and FK drags go through the same clamp
    A.applyAxisRotationStep(chain[1], 'z', 5);
    const e2 = new T.Euler().setFromQuaternion(chain[1].bone.quaternion, 'XYZ');
    if (Math.abs(e2.z) > lim + 1e-4) throw new Error('FK axis step escaped the limit: ' + e2.z);
  }, mkChain));

  await step('C3 IK: pole target flips the bend side of a 3-bone chain (mid-joint lands on the pole side)', () => page.evaluate((mk) => {
    const A = window.__A, T = window.THREE;
    const { rig, chain } = eval(mk);
    const target = new T.Vector3(0.3, 1.0, 0); // closer than full reach -> chain must bend somewhere
    const midZ = (pole) => {
      A.resetAllPose(rig);
      A.solveIK(chain, target, 80, { tolerance: 0.005, pole });
      rig.root.updateMatrixWorld(true);
      const root = new T.Vector3(); chain[0].headJoint.getWorldPosition(root);
      const tip = new T.Vector3(); chain[2].tailJoint.getWorldPosition(tip);
      const mid = new T.Vector3(); chain[1].headJoint.getWorldPosition(mid); // the chain's elbow joint
      const axis = tip.clone().sub(root).normalize();
      const v = mid.clone().sub(root);
      return v.sub(axis.multiplyScalar(v.dot(axis))).z; // signed off-axis Z of the elbow
    };
    const zPlus = midZ(new T.Vector3(0, 0.5, 1));
    const zMinus = midZ(new T.Vector3(0, 0.5, -1));
    if (!(zPlus > 0.01)) throw new Error('with pole at +Z the elbow should sit on +Z, got off-axis z=' + zPlus);
    if (!(zMinus < -0.01)) throw new Error('with pole at -Z the elbow should sit on -Z, got off-axis z=' + zMinus);
  }, mkChain));

  await step('C3 IK: interaction lifecycle — toggle arms target handle at the chain tip, chain length clamps 2-4, toggle-off clears', () => page.evaluate((mk) => {
    const A = window.__A, T = window.THREE;
    const { rig, chain } = eval(mk);
    A.setArmMode('pose');
    A.setIkChainLen(9); // must clamp to 4
    if (A.Arm.ikChainLen !== 4) throw new Error('chain length did not clamp to 4, got ' + A.Arm.ikChainLen);
    A.setIkChainLen(1); // must clamp to 2
    if (A.Arm.ikChainLen !== 2) throw new Error('chain length did not clamp to 2, got ' + A.Arm.ikChainLen);
    A.setIkChainLen(3);
    A.setIkOn(true);
    A.selectBone(rig, chain[2].id);
    A.ikSelectTip(rig, chain[2].id);
    if (!A.Arm.ikChainBoneIds || A.Arm.ikChainBoneIds.length !== 3) throw new Error('ikSelectTip did not build a 3-bone chain');
    if (A.Arm.ikChainBoneIds[2] !== chain[2].id || A.Arm.ikChainBoneIds[0] !== chain[0].id) throw new Error('chain is not root->tip ordered from the tapped tip');
    const h = A.ikHandles();
    if (!h.target || !h.target.visible) throw new Error('IK target handle not visible after selecting a tip');
    rig.root.updateMatrixWorld(true);
    const tip = new T.Vector3(); chain[2].tailJoint.getWorldPosition(tip);
    if (h.target.position.distanceTo(tip) > 1e-6) throw new Error('target handle did not spawn at the chain tip');
    // live-drag path: move the target and run the solver like dragIkMove does
    A.Arm.ikTargetPos.set(0.5, 1.0, 0.2);
    A.runIkSolve();
    rig.root.updateMatrixWorld(true);
    const tip2 = new T.Vector3(); chain[2].tailJoint.getWorldPosition(tip2);
    if (tip2.distanceTo(new T.Vector3(0.5, 1.0, 0.2)) > 0.05) throw new Error('runIkSolve did not pull the tip toward the dragged target');
    const solvedQ = chain[1].bone.quaternion.clone();
    A.setIkOn(false); // release-and-clear semantics
    if (A.Arm.ikChainBoneIds !== null || A.Arm.ikTargetPos !== null) throw new Error('toggle-off did not clear the chain/target state');
    if (A.ikHandles().target.visible) throw new Error('toggle-off did not hide the target handle');
    if (Math.abs(Math.abs(solvedQ.dot(chain[1].bone.quaternion)) - 1) > 1e-9) throw new Error('toggle-off must NOT reset the solved pose');
    A.setArmMode('edit');
  }, mkChain));

  await step('C3 IK: solved pose persists in bone quaternions and slerp-samples through Anim like any FK pose', () => page.evaluate((mk) => {
    const A = window.__A, T = window.THREE;
    A.Anim.tracks.length = 0;
    const { rig, chain } = eval(mk);
    A.solveIK(chain, new T.Vector3(0.6, 0.9, 0.3), 100, { tolerance: 0.005 });
    const solved = chain[1].bone.quaternion.clone();
    if (Math.abs(Math.abs(solved.dot(new T.Quaternion())) - 1) < 1e-6) throw new Error('solve left the mid bone at identity — nothing to key');
    const tid = A.boneTargetId(rig.id, chain[1].name);
    A.Anim.insertKey(tid, 'quaternion', 0);           // key the IK-solved pose
    A.resetBonePose(chain[1]);
    A.Anim.insertKey(tid, 'quaternion', 10);          // key identity
    A.Anim.sample(0);
    if (Math.abs(Math.abs(chain[1].bone.quaternion.dot(solved)) - 1) > 1e-4) throw new Error('sample(0) did not reproduce the keyed IK pose');
    A.Anim.sample(5);
    const mid = chain[1].bone.quaternion.clone();
    const angTotal = 2 * Math.acos(Math.min(1, Math.abs(solved.dot(new T.Quaternion()))));
    const angToStart = 2 * Math.acos(Math.min(1, Math.abs(mid.dot(solved))));
    if (Math.abs(angToStart - angTotal / 2) > 0.05) throw new Error('midpoint sample is not the slerp halfway pose (angle to start ' + angToStart + ', total ' + angTotal + ')');
  }, mkChain));

  await step('C3: rotation limits serialize through the anim autosave round-trip (current format, graceful)', async () => {
    await page.evaluate((mk) => {
      const A = window.__A, T = window.THREE;
      const { rig, chain } = eval(mk);
      rig.name = 'LimitSaveRig';
      A.Arm.rigId = rig.id;
      A.setBoneLimit(chain[1], 'z', -0.3, 0.3);
      A.doAnimAutosave();
    }, mkChain);
    const raw = await page.evaluate(() => localStorage.getItem(window.__A.ANIM_AUTOSAVE_KEY));
    const saved = JSON.parse(raw);
    if (saved.v !== 4) throw new Error('autosave should be format v4 (bumped by Wave C4), got ' + saved.v); // was v3 as of Wave C3; C4 bumped it additively
    const savedRig = saved.rigs.find(r => r.name === 'LimitSaveRig');
    const savedBone = savedRig && savedRig.bones.find(b => b.limits);
    if (!savedBone || !savedBone.limits.z) throw new Error('limits did not serialize into the autosave payload');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__A && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    const res = await page.evaluate(() => {
      const A = window.__A, T = window.THREE;
      const rig = Object.values(A.Rigs).find(r => r.name === 'LimitSaveRig');
      if (!rig) return { found: false };
      const be = rig.bones.find(b => b.name === 'C2');
      if (!be || !be.limits || !be.limits.z) return { found: true, hasLimit: false };
      // restored limits must still be functional: an over-limit pose gets clamped
      be.bone.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), 1.0);
      A.clampBoneRotation(be);
      const e = new T.Euler().setFromQuaternion(be.bone.quaternion, 'XYZ');
      return { found: true, hasLimit: true, lim: be.limits.z, clampedZ: e.z };
    });
    if (!res.found) throw new Error('LimitSaveRig did not survive reload');
    if (!res.hasLimit) throw new Error('restored bone lost its limits');
    if (Math.abs(res.lim[0] - -0.3) > 1e-9 || Math.abs(res.lim[1] - 0.3) > 1e-9) throw new Error('restored limit values wrong: ' + JSON.stringify(res.lim));
    if (Math.abs(res.clampedZ - 0.3) > 1e-6) throw new Error('restored limit is not enforced by clampBoneRotation, z=' + res.clampedZ);
    await page.evaluate(() => localStorage.removeItem(window.__A.ANIM_AUTOSAVE_KEY));
  });

  // ==== Wave C4: Constraints (Copy Location, Copy Rotation, Track-To, Limit Rotation) ====

  await step('C4 copyLoc: pins a bone world position to a moving target (influence 1)', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('C4CopyLocRig');
    const tgt = A.addBone(rig, 'C4Target', new T.Vector3(0, 0, 0), new T.Vector3(0, .5, 0), null);
    const src = A.addBone(rig, 'C4Src', new T.Vector3(2, 0, 0), new T.Vector3(2, .5, 0), null);
    const tgtTid = A.boneTargetId(rig.id, tgt.name), srcTid = A.boneTargetId(rig.id, src.name);
    const con = A.addConstraint(srcTid, 'copyLoc', tgtTid);
    if (!con) throw new Error('addConstraint returned null');
    // move the target
    tgt.head.set(1.3, 2.1, -0.4); tgt.tail.set(1.3, 2.6, -0.4); A.applyBoneEdit(tgt);
    A.applyConstraints(rig);
    rig.root.updateMatrixWorld(true);
    const w = new T.Vector3(); src.bone.getWorldPosition(w);
    if (w.distanceTo(new T.Vector3(1.3, 2.1, -0.4)) > 1e-4) throw new Error('copyLoc did not pin world position, got ' + JSON.stringify(w));
  }));

  await step('C4 copyRot: influence 0.5 blends halfway between current and target world rotation', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('C4CopyRotRig');
    const tgt = A.addBone(rig, 'RotTarget', new T.Vector3(0, 0, 0), new T.Vector3(0, .5, 0), null);
    const src = A.addBone(rig, 'RotSrc', new T.Vector3(1, 0, 0), new T.Vector3(1, .5, 0), null);
    tgt.bone.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2);
    src.bone.quaternion.identity();
    const tgtTid = A.boneTargetId(rig.id, tgt.name), srcTid = A.boneTargetId(rig.id, src.name);
    const con = A.addConstraint(srcTid, 'copyRot', tgtTid);
    con.influence = 0.5;
    A.applyConstraints(rig);
    rig.root.updateMatrixWorld(true);
    const wq = new T.Quaternion(); src.bone.getWorldQuaternion(wq);
    const startQ = new T.Quaternion(), endQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2);
    const angToStart = 2 * Math.acos(Math.min(1, Math.abs(wq.dot(startQ))));
    const angToEnd = 2 * Math.acos(Math.min(1, Math.abs(wq.dot(endQ))));
    if (Math.abs(angToStart - Math.PI / 4) > 0.05) throw new Error('halfway copyRot off from start, expected ~45deg, got ' + (angToStart * 180 / Math.PI));
    if (Math.abs(angToEnd - Math.PI / 4) > 0.05) throw new Error('halfway copyRot off from end, expected ~45deg, got ' + (angToEnd * 180 / Math.PI));
  }));

  await step('C4 trackTo: aims the bone axis at the target within tolerance', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('C4TrackRig');
    const src = A.addBone(rig, 'TrackSrc', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null); // along-bone axis = +Y at rest
    const tgtObj = new T.Object3D(); tgtObj.position.set(3, 1, 0);
    A.registerTarget('C4TrackTargetObj', tgtObj); // ad-hoc plain-object target, not rig-owned
    const srcTid = A.boneTargetId(rig.id, src.name);
    A.addConstraint(srcTid, 'trackTo', 'C4TrackTargetObj');
    A.applyConstraints(rig);
    rig.root.updateMatrixWorld(true);
    const worldQ = new T.Quaternion(); src.bone.getWorldQuaternion(worldQ);
    const aimWorld = new T.Vector3(0, 1, 0).applyQuaternion(worldQ).normalize();
    const srcWorld = new T.Vector3(); src.bone.getWorldPosition(srcWorld);
    const desired = tgtObj.position.clone().sub(srcWorld).normalize();
    const ang = Math.acos(Math.min(1, Math.max(-1, aimWorld.dot(desired))));
    if (ang > 0.02) throw new Error('trackTo aim off by ' + (ang * 180 / Math.PI) + ' degrees');
  }));

  await step('C4 limitRot: constraint row clamps identically to C3 direct limits, and toggling it off skips the render-pass reclamp', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('C4LimitRig');
    const be = A.addBone(rig, 'LimitBone', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    A.setBoneLimit(be, 'z', -0.2, 0.2);
    const tid = A.boneTargetId(rig.id, be.name);
    const con = A.addConstraint(tid, 'limitRot', null);
    if (!con || con.type !== 'limitRot') throw new Error('limitRot constraint not added');
    be.bone.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), 1.0); // well past the limit
    A.applyConstraints(rig);
    const e = new T.Euler().setFromQuaternion(be.bone.quaternion, 'XYZ');
    if (Math.abs(e.z - 0.2) > 1e-6) throw new Error('limitRot constraint row did not clamp to 0.2, got ' + e.z);
    con.enabled = false;
    be.bone.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), 1.0);
    A.applyConstraints(rig);
    const e2 = new T.Euler().setFromQuaternion(be.bone.quaternion, 'XYZ');
    if (Math.abs(e2.z - 1.0) > 1e-6) throw new Error('disabling the limitRot row should skip the render-pass reclamp, got z=' + e2.z);
  }));

  await step('C4: constraint cycle A->B->A is refused with no crash (self-targeting refused too)', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('C4CycleRig');
    const a = A.addBone(rig, 'CycA', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const b = A.addBone(rig, 'CycB', new T.Vector3(1, 0, 0), new T.Vector3(1, 1, 0), null);
    const aTid = A.boneTargetId(rig.id, a.name), bTid = A.boneTargetId(rig.id, b.name);
    const c1 = A.addConstraint(aTid, 'copyLoc', bTid);
    if (!c1) throw new Error('A->B copyLoc should be allowed');
    const c2 = A.addConstraint(bTid, 'copyLoc', aTid); // would close the cycle
    if (c2) throw new Error('B->A should have been refused as a cycle');
    if (A.constraintListFor(bTid).length !== 0) throw new Error('cycle-refused constraint should not have been added to B');
    const c3 = A.addConstraint(aTid, 'copyRot', aTid);
    if (c3) throw new Error('self-targeting should be refused');
    A.applyConstraints(rig); // must not throw / hang
  }));

  await step('C4: constraint influence is keyframeable through Anim (Registry con: path)', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    A.Anim.tracks.length = 0;
    const rig = A.newRig('C4InfluenceRig');
    const tgt = A.addBone(rig, 'InfTarget', new T.Vector3(2, 0, 0), new T.Vector3(2, 1, 0), null);
    const src = A.addBone(rig, 'InfSrc', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    const tgtTid = A.boneTargetId(rig.id, tgt.name), srcTid = A.boneTargetId(rig.id, src.name);
    const con = A.addConstraint(srcTid, 'copyLoc', tgtTid);
    const conTid = A.constraintTargetId(srcTid, con);
    if (!A.Registry[conTid]) throw new Error('constraint influence target not registered');
    con.influence = 0; A.Anim.insertKey(conTid, 'influence', 0);
    con.influence = 1; A.Anim.insertKey(conTid, 'influence', 10);
    A.Anim.sample(5);
    if (Math.abs(con.influence - 0.5) > 1e-6) throw new Error('sampled influence at midpoint expected 0.5, got ' + con.influence);
    A.applyConstraints(rig);
    rig.root.updateMatrixWorld(true);
    const w = new T.Vector3(); src.bone.getWorldPosition(w);
    if (Math.abs(w.x - 1.0) > 1e-3) throw new Error('halfway-influence copyLoc did not blend position, got x=' + w.x);
  }));

  await step('C4: constraints round-trip the anim autosave (v4) and old v3 saves still load fine', async () => {
    await page.evaluate(() => {
      const A = window.__A, T = window.THREE;
      A.Anim.tracks.length = 0;
      const rig = A.newRig('C4SaveRig');
      A.Arm.rigId = rig.id;
      const tgt = A.addBone(rig, 'SaveTarget', new T.Vector3(1, 0, 0), new T.Vector3(1, 1, 0), null);
      const src = A.addBone(rig, 'SaveSrc', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
      const tgtTid = A.boneTargetId(rig.id, tgt.name), srcTid = A.boneTargetId(rig.id, src.name);
      A.addConstraint(srcTid, 'copyRot', tgtTid);
      A.addConstraint(srcTid, 'limitRot', null);
      A.doAnimAutosave();
    });
    const raw = await page.evaluate(() => localStorage.getItem(window.__A.ANIM_AUTOSAVE_KEY));
    const saved = JSON.parse(raw);
    if (saved.v !== 4) throw new Error('autosave should be format v4, got ' + saved.v);
    const savedRig = saved.rigs.find(r => r.name === 'C4SaveRig');
    const savedSrc = savedRig && savedRig.bones.find(b => b.name === 'SaveSrc');
    if (!savedSrc || !savedSrc.constraints || savedSrc.constraints.length !== 2) throw new Error('constraints did not serialize: ' + JSON.stringify(savedSrc));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__A && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    const res = await page.evaluate(() => {
      const A = window.__A;
      const rig = Object.values(A.Rigs).find(r => r.name === 'C4SaveRig');
      if (!rig) return { found: false };
      const src = rig.bones.find(b => b.name === 'SaveSrc');
      return { found: true, count: (src && src.constraints ? src.constraints.length : -1),
        types: src && src.constraints ? src.constraints.map(c => c.type).sort() : [] };
    });
    if (!res.found) throw new Error('C4SaveRig did not survive reload');
    if (res.count !== 2) throw new Error('expected 2 restored constraints, got ' + res.count);
    if (res.types.join(',') !== 'copyRot,limitRot') throw new Error('restored constraint types wrong: ' + res.types.join(','));
    await page.evaluate(() => localStorage.removeItem(window.__A.ANIM_AUTOSAVE_KEY));

    // v3 (pre-C4) save still loads fine (no `constraints` field on bones at all)
    await page.evaluate(() => {
      const v3 = { v: 3, fps: 24, start: 0, end: 96, tracks: [], rigs: [
        { id: 'rigv3', name: 'V3Rig', bones: [
          { id: 'bv3', name: 'V3Bone', parentId: null, head: [0, 0, 0], tail: [0, 1, 0], quat: [0, 0, 0, 1] }
        ] }
      ] };
      localStorage.setItem(window.__A.ANIM_AUTOSAVE_KEY, JSON.stringify(v3));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__A && document.getElementById('boot').style.display === 'none', null, { timeout: 30000 });
    const res2 = await page.evaluate(() => {
      const A = window.__A;
      const rig = Object.values(A.Rigs).find(r => r.name === 'V3Rig');
      if (!rig) return { found: false };
      const be = rig.bones.find(b => b.name === 'V3Bone');
      return { found: true, constraints: be ? be.constraints : null };
    });
    if (!res2.found) throw new Error('v3 (no-constraints) save failed to load under C4 code');
    if (!Array.isArray(res2.constraints) || res2.constraints.length !== 0) throw new Error('v3-loaded bone should have an empty constraints array, got ' + JSON.stringify(res2.constraints));
    await page.evaluate(() => localStorage.removeItem(window.__A.ANIM_AUTOSAVE_KEY));
  });

  await step('C4 UI: Constraints section renders with type chips, Add flow creates a constraint end-to-end', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    const rig = A.newRig('C4UIRig');
    const other = A.addBone(rig, 'UIOther', new T.Vector3(1, 0, 0), new T.Vector3(1, 1, 0), null);
    const be = A.addBone(rig, 'UIBone', new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), null);
    A.Arm.rigId = rig.id;
    A.setView('pose'); A.setArmMode('pose'); A.selectBone(rig, be.id); A.renderPanel();
    let texts = Array.from(document.querySelectorAll('#panelBody button')).map(b => b.textContent.trim());
    ['Copy Loc', 'Copy Rot', 'Track To', 'Limit Rot'].forEach(t => { if (!texts.includes(t)) throw new Error('constraint type chip "' + t + '" not rendered'); });
    const chip = Array.from(document.querySelectorAll('#panelBody button')).find(b => b.textContent.trim() === 'Copy Loc');
    chip.click();
    const sel = document.querySelector('#panelBody select');
    if (!sel) throw new Error('target select did not appear after tapping a constraint type chip');
    sel.value = A.boneTargetId(rig.id, other.name);
    const addBtn = Array.from(document.querySelectorAll('#panelBody button')).find(b => b.textContent.trim() === 'Add');
    if (!addBtn) throw new Error('Add button not rendered in the target picker');
    addBtn.click();
    const list = A.constraintListFor(A.boneTargetId(rig.id, be.name));
    if (list.length !== 1 || list[0].type !== 'copyLoc') throw new Error('Add flow did not create the constraint, got ' + JSON.stringify(list));
    A.setArmMode('edit');
  }));

  await step('C4: object-level constraints on Registry (non-bone) targets evaluate via applyAllConstraints', () => page.evaluate(() => {
    const A = window.__A, T = window.THREE;
    A.buildDemoFigure();
    const head = A.Registry['demo.head'], torso = A.Registry['demo.torso'];
    head.position.set(0, 1.75, 0); torso.position.set(0.4, 1.2, 0.1);
    const con = A.addConstraint('demo.head', 'copyLoc', 'demo.torso');
    if (!con) throw new Error('object-level addConstraint failed');
    A.applyAllConstraints();
    const w = new T.Vector3(); head.getWorldPosition(w);
    const tw = new T.Vector3(); torso.getWorldPosition(tw);
    if (w.distanceTo(tw) > 1e-4) throw new Error('object-level copyLoc did not pin head to torso, dist=' + w.distanceTo(tw));
    A.removeConstraint('demo.head', con.id); // clean up so later assumptions about the shared demo figure aren't affected
  }));

  await browser.close();
  server.close();

  console.log('\n==== RESULT ====');
  if (errors.length) { console.log('FAILURES (' + errors.length + '):'); errors.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('ALL CLEAN');
})().catch(e => { console.error('fatal:', e); process.exit(2); });
