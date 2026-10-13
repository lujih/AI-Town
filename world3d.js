// AI 小镇 — 3D 渲染层
// 职责：Three.js 场景、相机、光照、网格构建、拾取、渲染循环。
// 本模块 import three，但不含模拟规则；所有模拟状态通过参数注入。
// 对外暴露 createWorld3d(sim, hooks)。

import * as THREE from "three";

const DESIGN_W = 900, DESIGN_H = 560;   // 世界逻辑坐标
const WORLD_SCALE = 0.4;                 // 逻辑 → 场景单位

// 道路矩形（逻辑坐标），与下方 3D 道路一一对应；simulation 的空地判定也用它
const ROADS = [
  { x0: 0, x1: 900, y0: 340, y1: 370 },
  { x0: 320, x1: 350, y0: 0, y1: 560 },
  { x0: 560, x1: 584, y0: 0, y1: 560 },
];

const ROOF_STYLE = {
  cafe:    { wall: 0xd8b06a, roof: 0x8b3a1f, h: 34 },
  lib:     { wall: 0x4a6aa8, roof: 0x2f4570, h: 44 },
  park:    { wall: 0x4a7c3f, roof: 0x2f5a2a, h: 0 },
  home1:   { wall: 0xe8d08a, roof: 0xa85a2f, h: 26 },
  home2:   { wall: 0xd0c090, roof: 0x7a6a50, h: 52 },
  market:  { wall: 0xb070c0, roof: 0x6a3a8a, h: 22 },
};

export function createWorld3d(sim, hooks = {}) {
  const H = {
    onNpcClick: hooks.onNpcClick || (() => {}),
    onGroundClick: hooks.onGroundClick || (() => {}),
    draw: hooks.draw || (() => {}),
  };

  const stage = document.getElementById("town3d");
  const nightveil = document.getElementById("nightveil");

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d1330, 0.0009);

  // 逻辑坐标 → 场景坐标
  const OX = (DESIGN_W / 2) * WORLD_SCALE;
  const OZ = (DESIGN_H / 2) * WORLD_SCALE;
  const toSceneX = (x) => (x - DESIGN_W / 2) * WORLD_SCALE + OX;
  const toSceneZ = (y) => (y - DESIGN_H / 2) * WORLD_SCALE + OZ;

  // ---------- 相机 ----------
  const cam = new THREE.PerspectiveCamera(38, 1, 1, 4000);
  let camDist = 420;
  const camPitch = 1.0;   // ~57° 俯角
  function applyCam() {
    cam.position.set(
      camDist * Math.sin(camPitch) * 0.7071,
      camDist * Math.cos(camPitch),
      camDist * Math.sin(camPitch) * 0.7071
    );
    cam.position.x += OX * 0.9;
    cam.position.z += OZ * 0.9;
    cam.lookAt(OX, 0, OZ);
  }
  applyCam();

  // ---------- 光照 ----------
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
  sun.position.set(300, 420, 220);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -300; sun.shadow.camera.right = 300;
  sun.shadow.camera.top = 300; sun.shadow.camera.bottom = -300;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 1200;
  sun.shadow.bias = -0.0004;
  scene.add(sun); scene.add(sun.target);
  sun.target.position.set((DESIGN_W / 2) * WORLD_SCALE, 0, (DESIGN_H / 2) * WORLD_SCALE);

  const hemi = new THREE.HemisphereLight(0x8fb8ff, 0x2f4a2a, 0.5);
  scene.add(hemi);

  const lampLights = [];
  const lampMeshes = [];
  const lampPositions = [
    { x: 240, z: 355 }, { x: 420, z: 355 }, { x: 335, z: 220 }, { x: 572, z: 300 },
  ].map((p) => ({ x: p.x * WORLD_SCALE, z: p.z * WORLD_SCALE }));

  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0.0, flatShading: true, ...opts,
  });

  // ---------- 地面 + 道路 ----------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(DESIGN_W * WORLD_SCALE * 1.3, DESIGN_H * WORLD_SCALE * 1.3),
    mat(0x6a9c45)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(OX, 0, OZ);
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = mat(0x5a6a78);
  const hroad = new THREE.Mesh(new THREE.BoxGeometry(DESIGN_W * WORLD_SCALE, 0.6, 30 * WORLD_SCALE), roadMat);
  hroad.position.set(OX, 0.3, toSceneZ(355));
  hroad.receiveShadow = true; scene.add(hroad);
  const vroad1 = new THREE.Mesh(new THREE.BoxGeometry(30 * WORLD_SCALE, 0.6, DESIGN_H * WORLD_SCALE), roadMat);
  vroad1.position.set(toSceneX(335), 0.3, OZ);
  vroad1.receiveShadow = true; scene.add(vroad1);
  const vroad2 = new THREE.Mesh(new THREE.BoxGeometry(24 * WORLD_SCALE, 0.6, DESIGN_H * WORLD_SCALE), roadMat);
  vroad2.position.set(toSceneX(572), 0.3, OZ);
  vroad2.receiveShadow = true; scene.add(vroad2);

  const lineMat = mat(0xffffff, { emissive: 0x555555, roughness: 1 });
  const LANE_Y = 0.68;   // 道路顶面 0.6 之上，加 polygonOffset 防 z-fighting
  function addLaneLine(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.6), lineMat);
    m.position.set((x1 + x2) / 2, LANE_Y, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    m.material.polygonOffset = true;
    m.material.polygonOffsetFactor = -2;
    m.material.polygonOffsetUnits = -2;
    scene.add(m);
  }
  addLaneLine(toSceneX(0), toSceneZ(355), toSceneX(900), toSceneZ(355));
  addLaneLine(toSceneX(335), toSceneZ(0), toSceneX(335), toSceneZ(560));
  addLaneLine(toSceneX(572), toSceneZ(0), toSceneX(572), toSceneZ(560));

  // ---------- 空地判定 ----------
  const rectsOverlap = (a, b) => !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
  function isFreeGround(x, y, half = 3) {
    const box = { x0: x - half, x1: x + half, y0: y - half, y1: y + half };
    if (x - half < 0 || x + half > DESIGN_W || y - half < 0 || y + half > DESIGN_H) return false;
    for (const r of ROADS) if (rectsOverlap(box, r)) return false;
    for (const p of sim.POIS) if (rectsOverlap(box, { x0: p.x, x1: p.x + p.w, y0: p.y, y1: p.y + p.h })) return false;
    return true;
  }
  function findFreeGround(half = 3, tries = 60) {
    for (let i = 0; i < tries; i++) {
      const x = 10 + Math.random() * (DESIGN_W - 20);
      const y = 10 + Math.random() * (DESIGN_H - 20);
      if (isFreeGround(x, y, half)) return { x, y };
    }
    return null;
  }

  // ---------- 建筑 ----------
  for (const p of sim.POIS) {
    const style = ROOF_STYLE[p.id];
    const cx = toSceneX(p.x + p.w / 2), cz = toSceneZ(p.y + p.h / 2);
    const w = p.w * WORLD_SCALE, h = p.h * WORLD_SCALE;

    if (p.id === "park") {
      const parkPlat = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, h), mat(0x5a8c3f));
      parkPlat.position.set(cx, 0.6, cz);
      parkPlat.receiveShadow = true; parkPlat.castShadow = true;
      scene.add(parkPlat);
      const fence = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1.6, h + 2), mat(0x8a6a3a, { transparent: true, opacity: 0.45 }));
      fence.position.set(cx, 0.8, cz);
      scene.add(fence);
      addTrees(cx, cz, w, h, 4);
      continue;
    }

    const wallH = style.h * WORLD_SCALE * 0.5;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, h), mat(style.wall));
    wall.position.set(cx, wallH / 2 + 0.6, cz);
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall);
    const roofH = Math.max(6, wallH * 0.45);
    const roofGeo = new THREE.ConeGeometry(Math.max(w, h) * 0.72, roofH, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, mat(style.roof));
    roof.position.set(cx, wallH + roofH / 2 + 0.6, cz);
    roof.castShadow = true;
    scene.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, wallH * 0.45, 0.5), mat(0x2a1a0a));
    door.position.set(cx, wallH * 0.25 + 0.6, cz + h / 2 + 0.1);
    scene.add(door);
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, wallH * 0.22, 0.5), mat(0xbfe0ff, { emissive: 0x334455 }));
    win1.position.set(cx - w * 0.28, wallH * 0.55, cz + h / 2 + 0.1);
    scene.add(win1);
    const win2 = win1.clone(); win2.position.x = cx + w * 0.28; scene.add(win2);
  }

  function addTrees(cx, cz, w, h, count) {
    for (let i = 0; i < count; i++) {
      const tx = cx + (Math.random() - 0.5) * w * 0.8;
      const tz = cz + (Math.random() - 0.5) * h * 0.8;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 4, 5), mat(0x6a4a2a));
      trunk.position.set(tx, 2 + 1.2, tz); trunk.castShadow = true;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(2.4 + Math.random() * 1.2, 5 + Math.random() * 2, 6), mat(0x3f7c3f));
      leaf.position.set(tx, 5 + 1.2, tz); leaf.castShadow = true;
      scene.add(trunk); scene.add(leaf);
    }
  }

  // 路边零星树（只落在空地）
  for (let i = 0; i < 10; i++) {
    const spot = findFreeGround(4);
    if (!spot) continue;
    const tx = toSceneX(spot.x), tz = toSceneZ(spot.y);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 3.2, 5), mat(0x5a3a1a));
    trunk.position.set(tx, 1.6, tz); trunk.castShadow = true;
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + Math.random(), 0), mat(0x3f7c3f));
    leaf.position.set(tx, 4.4, tz); leaf.castShadow = true;
    scene.add(trunk); scene.add(leaf);
  }

  // ---------- 路灯 ----------
  for (const p of lampPositions) {
    const pt = new THREE.PointLight(0xffb347, 0, 90, 1.6);
    pt.position.set(p.x, 18, p.z);
    scene.add(pt); lampLights.push(pt);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 16, 6), mat(0x3a4a58));
    pole.position.set(p.x, 8, p.z); pole.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), mat(0xffd27a, { emissive: 0xff9524, emissiveIntensity: 0.2 }));
    head.position.set(p.x, 16.6, p.z);
    head.userData.isLampHead = true;
    scene.add(pole); scene.add(head); lampMeshes.push(head);
  }

  // ---------- A4 装饰物 ----------
  const DECOR_BUILDERS = {
    flower: (x, z) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.6, 8), mat(0x8a6a3a));
      base.position.y = 0.3;
      const f1 = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), mat(0xff6b8a));
      f1.position.set(-0.5, 1.1, 0);
      const f2 = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), mat(0xffd97a));
      f2.position.set(0.6, 0.9, 0.3);
      g.add(base, f1, f2);
      g.position.set(x, 0.6, z);
      return g;
    },
    bench: (x, z) => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1.4), mat(0x8a5a2a));
      seat.position.y = 1.1;
      const back = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 0.25), mat(0x8a5a2a));
      back.position.set(0, 1.7, -0.6);
      g.add(seat, back);
      g.position.set(x, 0.6, z);
      return g;
    },
    lamp: (x, z) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 9, 6), mat(0x3a4a58));
      pole.position.y = 4.5; pole.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), mat(0xffd27a, { emissive: 0xff9524, emissiveIntensity: 0.4 }));
      head.position.y = 9.4;
      const light = new THREE.PointLight(0xffb347, 0, 60, 1.5);
      light.position.y = 9.4;
      g.add(pole, head, light);
      g.userData.isDecorLamp = light;
      g.position.set(x, 0.6, z);
      return g;
    },
    fountain: (x, z) => {
      const g = new THREE.Group();
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 1.2, 12), mat(0x9aa5b5));
      basin.position.y = 0.6;
      const water = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.3, 12), mat(0x6ab8e0, { transparent: true, opacity: 0.8 }));
      water.position.y = 1.2;
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.6, 8), mat(0x9aa5b5));
      spout.position.y = 2.3;
      g.add(basin, water, spout);
      g.position.set(x, 0.6, z);
      return g;
    },
    statue: (x, z) => {
      const g = new THREE.Group();
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), mat(0x8a8a9a));
      plinth.position.y = 1.2;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 3, 8), mat(0xd8c08a));
      body.position.y = 3.9;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), mat(0xd8c08a));
      head.position.y = 5.9;
      g.add(plinth, body, head);
      g.position.set(x, 0.6, z);
      return g;
    },
  };

  const decorGroup = new THREE.Group();
  scene.add(decorGroup);
  function syncDecors() {
    decorGroup.clear();
    for (const d of sim.decors) {
      const build = DECOR_BUILDERS[d.type];
      if (!build) continue;
      const mesh = build(toSceneX(d.x), toSceneZ(d.y));
      mesh.userData.decorId = d.id;
      decorGroup.add(mesh);
    }
  }
  syncDecors();
  // 注：sim 的 onDecorsChanged hook 由 app.js 接到 syncDecors，此处不重复注册

  // ---------- NPC 网格 ----------
  const NPC_GROUP = new THREE.Group();
  scene.add(NPC_GROUP);

  function makeTextSprite(text, { bg = "rgba(13,19,48,0.78)", color = "#e8ecff", size = 40 } = {}) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 96;
    const c = cv.getContext("2d");
    c.fillStyle = bg;
    roundRectC(c, 4, 4, cv.width - 8, cv.height - 8, 20);
    c.fill();
    c.strokeStyle = "rgba(255,179,71,0.5)"; c.lineWidth = 3;
    roundRectC(c, 4, 4, cv.width - 8, cv.height - 8, 20);
    c.stroke();
    c.font = `700 ${size}px "Noto Sans SC", sans-serif`;
    c.fillStyle = color;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(text, cv.width / 2, cv.height / 2 - 10, cv.width - 20);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(16, 6, 1);
    sp.renderOrder = 999;
    return sp;
  }
  function roundRectC(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y, x, x + w, y);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function buildNpcMesh(npc) {
    const g = new THREE.Group();
    g.userData.npcId = npc.id;          // raycast 命中子 mesh 后沿父链找回 NPC
    g.userData.isVisitor = !!npc.isVisitor;

    const bodyMat = mat(new THREE.Color(npc.personality.color));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 4.4, 10), bodyMat);
    body.position.y = 2.6; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), mat(0xf0d8c0));
    head.position.y = 5.6; head.castShadow = true;
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 })
    );
    face.position.set(0, 5.7, 1.35);
    g.add(body, head, face);

    const spr = makeTextSprite(npc.name, { color: "#ffffff", size: 44 });
    spr.position.y = 9;
    g.add(spr);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    ring.userData.isRing = true;
    g.add(ring);

    npc._mesh = g;
    npc._ring = ring;
    NPC_GROUP.add(g);
    g.position.set(toSceneX(npc.x), 0.6, toSceneZ(npc.y));
    return g;
  }

  // ---------- 昼夜 ----------
  function updateSun(light) {
    const sunH = 80 + light * 380;
    sun.position.set(300 - light * 180, sunH, 220 - light * 80);
    sun.intensity = 0.12 + light * 1.0;
    sun.color.setHSL(0.09, 0.5, 0.55 + light * 0.35);
    hemi.intensity = 0.18 + light * 0.5;
    const skyDay = new THREE.Color(0x8fd0ff);
    const skyDusk = new THREE.Color(0x3a568f);
    const skyNight = new THREE.Color(0x0a1030);
    const c = light > 0.5
      ? skyDay.clone().lerp(skyDusk, (0.5 - (light - 0.5)) * 2)
      : skyDusk.clone().lerp(skyNight, (0.5 - light) * 2);
    scene.background = c;
    scene.fog.color.copy(c);
    const lampOn = light < 0.45 ? (0.45 - light) / 0.45 : 0;
    for (const pt of lampLights) pt.intensity = lampOn * 2.4;
    for (const m of lampMeshes) m.material.emissiveIntensity = 0.2 + lampOn * 1.4;
    // A4 装饰路灯夜间也亮
    decorGroup.traverse((o) => {
      if (o.userData && o.userData.isDecorLamp) o.userData.isDecorLamp.intensity = lampOn * 1.8;
    });
  }

  // 唯一的 updateVeil：同时驱动 DOM 蒙层与 3D 光照。
  // 注意：不要再定义同名函数——函数提升会让后者覆盖前者，导致 updateSun 静默失效。
  function updateVeil() {
    const light = sim.daylight();
    updateSun(light);
    const veilOpacity = light < 0.6 ? (0.6 - light) * 0.9 : 0;
    nightveil.style.opacity = Math.min(0.5, veilOpacity).toFixed(3);
  }

  // ---------- 渲染循环 ----------
  function draw() {
    for (const npc of sim.allNpcs) {
      if (!npc._mesh) continue;
      npc._mesh.position.x = toSceneX(npc.x);
      npc._mesh.position.z = toSceneZ(npc.y);
      if (npc.target && !npc.chatOpen) {
        const tx = toSceneX(npc.target.x + npc.target.w / 2);
        const tz = toSceneZ(npc.target.y + npc.target.h / 2);
        npc._mesh.rotation.y = Math.atan2(tx - npc._mesh.position.x, tz - npc._mesh.position.z);
      }
      const t = performance.now() * 0.004;
      npc._mesh.position.y = 0.6 + (npc.target && !npc.chatOpen ? Math.abs(Math.sin(t + npc.id)) * 0.4 : 0);
      const locAge = npc._locateT ? performance.now() - npc._locateT : Infinity;
      if (npc._ring) {
        if (locAge < 1600) {
          // 定位脉冲（点击名册后）
          const p = locAge / 1600;
          npc._ring.material.opacity = 0.9 * (1 - p);
          npc._ring.scale.setScalar(1 + p * 2.2);
        } else if (npc._hover) {
          // hover 提示环：静止的暖橙细环，告诉用户"这个可以点"
          npc._ring.material.opacity = 0.55;
          npc._ring.scale.setScalar(1.15);
        } else {
          npc._ring.material.opacity = 0;
        }
      }
    }
    updateVeil();
    renderer.render(scene, cam);
  }

  // ---------- 拾取 ----------
  const _pickRay = new THREE.Raycaster();
  const _pickNdc = new THREE.Vector2();

  // 触摸设备上放宽拾取：3D 小目标手指点不中
  const COARSE_POINTER = window.matchMedia ? window.matchMedia("(hover: none)").matches : false;
  const HOVER_PAD = COARSE_POINTER ? 1.8 : 1;

  function toNdc(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    _pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return _pickNdc;
  }

  // 命中任意 NPC 子 mesh 后，沿父链找回所属 NPC
  function resolveNpc(hits) {
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && obj.userData.npcId === undefined) obj = obj.parent;
    if (!obj) return null;
    return sim.allNpcs[obj.userData.npcId] || null;
  }

  function pickNpcAt(clientX, clientY) {
    _pickRay.setFromCamera(toNdc(clientX, clientY), cam);
    const targets = sim.allNpcs.map((n) => n._mesh).filter(Boolean);
    // 触摸设备：加一个放大的隐形拾取球，命中身体/头都算
    const hits = _pickRay.intersectObjects(targets, true);
    const npc = resolveNpc(hits);
    if (npc || HOVER_PAD === 1) return npc;
    // 粗指针兜底：按屏幕距离找最近的 NPC（在 60px 内即算命中）
    let best = null, bestD = 60;
    for (const n of sim.allNpcs) {
      if (!n._mesh) continue;
      const s = logicToScreen(n);
      const d = Math.hypot(s.x - (clientX - renderer.domElement.getBoundingClientRect().left),
                           s.y - (clientY - renderer.domElement.getBoundingClientRect().top));
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function pickGroundAt(clientX, clientY) {
    _pickRay.setFromCamera(toNdc(clientX, clientY), cam);
    const hit = _pickRay.intersectObject(ground)[0];
    if (!hit) return null;
    return {
      x: (hit.point.x - OX) / WORLD_SCALE + DESIGN_W / 2,
      y: (hit.point.z - OZ) / WORLD_SCALE + DESIGN_H / 2,
    };
  }

  // ---------- hover 高亮：让"这些小人可以点"这件事显眼 ----------
  // 这是全站唯一让 UI 变显眼的地方——可读性优先于低调。
  let hoveredNpc = null;
  function updateHover(clientX, clientY) {
    const npc = pickNpcAt(clientX, clientY);
    if (npc === hoveredNpc) return;
    // 旧的取消高亮
    if (hoveredNpc && hoveredNpc._ring) {
      hoveredNpc._ring.material.opacity = 0;
      hoveredNpc._hover = false;
    }
    hoveredNpc = npc;
    if (npc) {
      npc._hover = true;
      renderer.domElement.classList.add("npc-hover");
    } else {
      renderer.domElement.classList.remove("npc-hover");
    }
  }
  function clearHover() {
    if (hoveredNpc && hoveredNpc._ring) hoveredNpc._ring.material.opacity = 0;
    hoveredNpc = null;
    renderer.domElement.classList.remove("npc-hover");
  }

  // ---------- 响应式 ----------
  const WORLD_R = Math.hypot(DESIGN_W, DESIGN_H) * WORLD_SCALE / 2 + 24;
  function fitCamDist(aspect) {
    const vFov = (cam.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const need = WORLD_R / Math.max(Math.sin(camPitch), 0.35);
    let lo = 100, hi = 2000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (Math.min(Math.tan(vFov / 2) * mid, Math.tan(hFov / 2) * mid) >= need) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  function resize() {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    const aspect = w / h;
    cam.aspect = aspect;
    camDist = fitCamDist(aspect);
    applyCam();
    cam.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  // ---------- 对外 ----------
  return {
    renderer, scene, cam, ground,
    draw, resize, syncDecors,
    buildNpcMesh,
    removeNpcMesh(npc) { if (npc._mesh) NPC_GROUP.remove(npc._mesh); },
    pickNpcAt, pickGroundAt, isFreeGround,
    updateHover, clearHover,
    logicToScreen(npc) {
      const v = new THREE.Vector3(toSceneX(npc.x), 6, toSceneZ(npc.y));
      v.project(cam);
      return {
        x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
        y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight,
      };
    },
    locateNpc(npc) { npc._locateT = performance.now(); },
    get domElement() { return renderer.domElement; },
  };
}

export { ROADS, DESIGN_W, DESIGN_H, WORLD_SCALE };
