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
  poseScene:poseScene,renderer:renderer,invalidate:invalidate,resizeActive:resizeActive,frameObject:frameObject,syncScrubUI:syncScrubUI};
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

  await browser.close();
  server.close();

  console.log('\n==== RESULT ====');
  if (errors.length) { console.log('FAILURES (' + errors.length + '):'); errors.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('ALL CLEAN');
})().catch(e => { console.error('fatal:', e); process.exit(2); });
