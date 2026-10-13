// AI 小镇 — 3D 版（Three.js 低多边形小镇）
// 世界窗口：WebGL 场景全屏铺满，HUD/字幕/抽屉悬浮其上
// 所有模拟逻辑（巡游/聊天/目标/名人榜/事件）保持不变，只把 2D Canvas 渲染换成 Three.js

import * as THREE from "three";

(() => {
  "use strict";

  // ---------- 3D 场景（低多边形小镇，等轴斜俯视） ----------
  const stage = document.getElementById("town3d");
  const DESIGN_W = 900, DESIGN_H = 560; // 世界逻辑坐标（米制缩放）

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d1330, 0.0009);

  // 等轴斜俯视相机（固定，不可拖拽 → 画面稳定）
  const WORLD_SCALE = 0.4; // 逻辑单位 → 场景单位
  // 相机放在小镇对角方向 ~54° 俯视，收得较紧让小镇充满画面
  const cam = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  const camDist = 420;
  const camPitch = 1.0; // 弧度，~57° 俯角
  cam.position.set(
    camDist * Math.sin(camPitch) * 0.7071,
    camDist * Math.cos(camPitch),
    camDist * Math.sin(camPitch) * 0.7071
  );
  cam.position.x += OX * 0.9;
  cam.position.z += OZ * 0.9;
  cam.lookAt(OX, 0, OZ);

  // 光照：主光（随昼夜移动）+ 环境光 + 路灯点光
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
  sun.position.set(300, 420, 220);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -300; sun.shadow.camera.right = 300;
  sun.shadow.camera.top = 300; sun.shadow.camera.bottom = -300;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 1200;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set((DESIGN_W / 2) * WORLD_SCALE, 0, (DESIGN_H / 2) * WORLD_SCALE);

  const hemi = new THREE.HemisphereLight(0x8fb8ff, 0x2f4a2a, 0.5);
  scene.add(hemi);

  // 路灯（夜间点亮的点光源，最多 4 个控制性能）
  const lampLights = [];
  const lampPositions = [
    { x: 240, z: 355 }, { x: 420, z: 355 },
    { x: 335, z: 220 }, { x: 572, z: 300 },
  ].map((p) => ({ x: p.x * WORLD_SCALE, z: p.z * WORLD_SCALE }));
  for (const p of lampPositions) {
    const pt = new THREE.PointLight(0xffb347, 0, 160, 1.8);
    pt.position.set(p.x, 18, p.z);
    scene.add(pt);
    lampLights.push(pt);
  }

  // 世界原点：逻辑 (0,0) 对应场景 ((DESIGN_W/2)*S, 0, (DESIGN_H/2)*S) 中心布局
  const OX = (DESIGN_W / 2) * WORLD_SCALE;
  const OZ = (DESIGN_H / 2) * WORLD_SCALE;
  // 逻辑坐标 → 场景坐标（X 右、Z 下）
  const toScene = (x, y) => new THREE.Vector3((x - DESIGN_W / 2) * WORLD_SCALE + OX, 0, (y - DESIGN_H / 2) * WORLD_SCALE + OZ);
  const toSceneX = (x) => (x - DESIGN_W / 2) * WORLD_SCALE + OX;
  const toSceneZ = (y) => (y - DESIGN_H / 2) * WORLD_SCALE + OZ;

  // 材质工厂（低多边形卡通风）
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
  // 横向路（逻辑 y=340, 高 30, 全长 900）
  const hroad = new THREE.Mesh(new THREE.BoxGeometry(DESIGN_W * WORLD_SCALE, 0.6, 30 * WORLD_SCALE), roadMat);
  hroad.position.set(OX, 0.3, toSceneZ(355));
  hroad.receiveShadow = true;
  scene.add(hroad);
  // 两条纵向路（逻辑 x=320 w=30, x=560 w=24）
  const vroad1 = new THREE.Mesh(new THREE.BoxGeometry(30 * WORLD_SCALE, 0.6, DESIGN_H * WORLD_SCALE), roadMat);
  vroad1.position.set(toSceneX(335), 0.3, OZ);
  vroad1.receiveShadow = true; scene.add(vroad1);
  const vroad2 = new THREE.Mesh(new THREE.BoxGeometry(24 * WORLD_SCALE, 0.6, DESIGN_H * WORLD_SCALE), roadMat);
  vroad2.position.set(toSceneX(572), 0.3, OZ);
  vroad2.receiveShadow = true; scene.add(vroad2);
  // 车道中线（细的浅色条）
  const lineMat = mat(0xffffff, { emissive: 0x555555, roughness: 1 });
  function addLaneLine(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.6), lineMat);
    m.position.set((x1 + x2) / 2, 0.66, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    scene.add(m);
  }
  addLaneLine(toSceneX(0), toSceneZ(355), toSceneX(900), toSceneZ(355));
  addLaneLine(toSceneX(335), toSceneZ(0), toSceneX(335), toSceneZ(560));
  addLaneLine(toSceneX(572), toSceneZ(0), toSceneX(572), toSceneZ(560));

  // ---------- 建筑（POI） ----------
  const ROOF_STYLE = {
    cafe:    { wall: 0xd8b06a, roof: 0x8b3a1f, h: 34 },
    lib:     { wall: 0x4a6aa8, roof: 0x2f4570, h: 44 },
    park:    { wall: 0x4a7c3f, roof: 0x2f5a2a, h: 0 },
    home1:   { wall: 0xe8d08a, roof: 0xa85a2f, h: 26 },
    home2:   { wall: 0xd0c090, roof: 0x7a6a50, h: 52 },
    market:  { wall: 0xb070c0, roof: 0x6a3a8a, h: 22 },
  };
  // 公园是开放绿地 + 几棵树，不是楼
  const POI_MESHES = {};
  for (const p of POIS) {
    const style = ROOF_STYLE[p.id];
    const cx = toSceneX(p.x + p.w / 2);
    const cz = toSceneZ(p.y + p.h / 2);
    const w = p.w * WORLD_SCALE, h = p.h * WORLD_SCALE;

    if (p.id === "park") {
      // 公园：抬高一点的绿地 + 低矮围栏 + 树
      const parkPlat = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, h), mat(0x5a8c3f));
      parkPlat.position.set(cx, 0.6, cz);
      parkPlat.receiveShadow = true; parkPlat.castShadow = true;
      scene.add(parkPlat);
      // 围栏
      const fence = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1.6, h + 2), mat(0x8a6a3a, { transparent: true, opacity: 0.45 }));
      fence.position.set(cx, 0.8, cz);
      scene.add(fence);
      addTrees(cx, cz, w, h, 4);
      POI_MESHES[p.id] = { group: parkPlat };
      continue;
    }

    // 楼体（长方体）+ 屋顶（斜四角锥台，用 4 面 + 平板顶）
    const wallH = style.h * WORLD_SCALE * 0.5;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, h), mat(style.wall));
    wall.position.set(cx, wallH / 2 + 0.6, cz);
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall);
    // 屋顶：用 4 个三角面拼（低多边形感）
    const roofH = Math.max(6, wallH * 0.45);
    const roofGeo = new THREE.ConeGeometry(Math.max(w, h) * 0.72, roofH, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, mat(style.roof));
    roof.position.set(cx, wallH + roofH / 2 + 0.6, cz);
    roof.castShadow = true;
    scene.add(roof);
    // 门窗（小色块贴在正面，增加细节）
    const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, wallH * 0.45, 0.5), mat(0x2a1a0a));
    door.position.set(cx, wallH * 0.25 + 0.6, cz + h / 2 + 0.1);
    scene.add(door);
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, wallH * 0.22, 0.5), mat(0xbfe0ff, { emissive: 0x334455 }));
    win1.position.set(cx - w * 0.28, wallH * 0.55, cz + h / 2 + 0.1);
    scene.add(win1);
    const win2 = win1.clone(); win2.position.x = cx + w * 0.28; scene.add(win2);
    POI_MESHES[p.id] = { wall, roof };
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

  // 路边零星树（让小镇不空）
  for (let i = 0; i < 10; i++) {
    const side = i % 2;
    const tx = side === 0 ? toSceneX(350 + Math.random() * 40) : toSceneX(600 + Math.random() * 60);
    const tz = toSceneZ(120 + Math.random() * 300);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 3.2, 5), mat(0x5a3a1a));
    trunk.position.set(tx, 1.6, tz); trunk.castShadow = true;
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + Math.random(), 0), mat(0x3f7c3f));
    leaf.position.set(tx, 4.4, tz); leaf.castShadow = true;
    scene.add(trunk); scene.add(leaf);
  }

  // ---------- 路灯（3D 柱体 + 夜间点光） ----------
  const lampMeshes = [];
  for (const p of lampPositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 16, 6), mat(0x3a4a58));
    pole.position.set(p.x, 8, p.z); pole.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), mat(0xffd27a, { emissive: 0xff9524, emissiveIntensity: 0.2 }));
    head.position.set(p.x, 16.6, p.z);
    head.userData.isLampHead = true;
    scene.add(pole); scene.add(head);
    lampMeshes.push(head);
  }

  // ---------- NPC（低多边形小人：圆角身体 + 头 + 表情贴片） ----------
  const NPC_GROUP = new THREE.Group();
  scene.add(NPC_GROUP);
  const nameSprites = {}; // npc.id -> sprite

  // 用 canvas 贴图做名字标牌 + 表情
  function makeTextSprite(text, { bg = "rgba(13,19,48,0.78)", color = "#e8ecff", size = 40, pad = 12 } = {}) {
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
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function buildNpcMesh(npc) {
    const g = new THREE.Group();
    // 身体（胶囊感：圆柱 + 顶球）
    const bodyMat = mat(new THREE.Color(npc.personality.color));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 4.4, 10), bodyMat);
    body.position.y = 2.6; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), mat(0xf0d8c0));
    head.position.y = 5.6; head.castShadow = true;
    // 表情（一个扁平的圆形贴片贴头上）
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 })
    );
    face.position.set(0, 5.7, 1.35);
    g.add(body); g.add(head); g.add(face);

    // 名字标牌
    const spr = makeTextSprite(npc.name, { color: "#ffffff", size: 44 });
    spr.position.y = 9;
    g.add(spr);
    nameSprites[npc.id] = spr;

    // 定位圈（名册点击时 1.6s 内脉冲）
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    ring.userData.isRing = true;
    g.add(ring);
    npc._ring = ring;

    NPC_GROUP.add(g);
    npc._mesh = g;
    g.position.set(toSceneX(npc.x), 0.6, toSceneZ(npc.y));
    return g;
  }

  // ---------- 昼夜光照系统 ----------
  function updateSun(light) {
    // 太阳高度 & 颜色随 light 变
    const sunH = 80 + light * 380;
    sun.position.set(300 - light * 180, sunH, 220 - light * 80);
    sun.intensity = 0.12 + light * 1.0;
    sun.color.setHSL(0.09, 0.5, 0.55 + light * 0.35);
    hemi.intensity = 0.18 + light * 0.5;
    // 天空色（通过 fog + 背景）
    const skyDay = new THREE.Color(0x8fd0ff);
    const skyDusk = new THREE.Color(0x3a568f);
    const skyNight = new THREE.Color(0x0a1030);
    const c = light > 0.5 ? skyDay.clone().lerp(skyDusk, (0.5 - (light - 0.5)) * 2) : skyDusk.clone().lerp(skyNight, (0.5 - light) * 2);
    scene.background = c;
    scene.fog.color.copy(c);
    // 路灯 & 库存窗光
    const lampOn = light < 0.45 ? (0.45 - light) / 0.45 : 0;
    for (const pt of lampLights) pt.intensity = lampOn * 2.4;
    for (const m of lampMeshes) m.material.emissiveIntensity = 0.2 + lampOn * 1.4;
    // 夜晚地面整体压暗（材质 color 不逐帧改，用 hemi + 太阳已经够）
  }

  function updateVeil() {
    const light = daylight();
    updateSun(light);
    // DOM 蒙层保留（HUD 可读性）
    const veilOpacity = light < 0.6 ? (0.6 - light) * 0.9 : 0;
    nightveil.style.opacity = Math.min(0.5, veilOpacity).toFixed(3);
  }

  // ---------- 渲染循环（每帧重绘 3D） ----------
  function draw() {
    // NPC 位置 + 朝向
    for (const npc of npcs) {
      if (!npc._mesh) continue;
      npc._mesh.position.x = toSceneX(npc.x);
      npc._mesh.position.z = toSceneZ(npc.y);
      // 朝目标点转
      if (npc.target && !npc.chatOpen) {
        const tx = toSceneX(npc.target.x + npc.target.w / 2);
        const tz = toSceneZ(npc.target.y + npc.target.h / 2);
        npc._mesh.rotation.y = Math.atan2(tx - npc._mesh.position.x, tz - npc._mesh.position.z);
      }
      // 走路上下轻微起伏
      const t = performance.now() * 0.004;
      npc._mesh.position.y = 0.6 + (npc.target && !npc.chatOpen ? Math.abs(Math.sin(t + npc.id)) * 0.4 : 0);
      // 定位圈脉冲
      const locAge = npc._locateT ? (performance.now() - npc._locateT) : Infinity;
      if (npc._ring) {
        if (locAge < 1600) {
          const p = locAge / 1600;
          npc._ring.material.opacity = 0.9 * (1 - p);
          const s = 1 + p * 2.2;
          npc._ring.scale.setScalar(s);
        } else npc._ring.material.opacity = 0;
      }
    }
    updateVeil();
    renderer.render(scene, cam);
  }

  // 屏幕坐标 → 场景坐标 → 逻辑坐标（用于点击拾取）
  const _ray = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  function screenToLogic(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _ray.setFromCamera(_ndc, cam);
    const hit = _ray.intersectObject(ground)[0];
    if (!hit) return null;
    const wx = (hit.point.x - OX) / WORLD_SCALE + DESIGN_W / 2;
    const wy = (hit.point.z - OZ) / WORLD_SCALE + DESIGN_H / 2;
    return { x: wx, y: wy };
  }
  function logicToScreen(npc) {
    const v = toScene(npc.x, npc.y);
    v.y = 6; // 取 NPC 头部高度做投影
    v.project(cam);
    return {
      x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
      y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight,
    };
  }

  // ---------- 响应式 ----------
  function resize() {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  // ---------- 世界时间 ----------
  const DAY_LENGTH = 2400;
  const TICK_MS = 100;
  const MINUTES_PER_TICK = 4;
  let gameTime = 9 * 60;
  let dayCount = 1;
  let paused = false;
  let speed = clampSpeed(Number(localStorage.getItem("aitown_speed")) || 1);
  function clampSpeed(s) { return s === 2 || s === 4 ? s : 1; }
  let lastActive = null;
  let activeNpc = null;

  // ---------- 地点（POI） ----------
  const POIS = [
    { id: "cafe", name: "咖啡馆", x: 70, y: 90, w: 150, h: 110, color: "#8b5a2b", icon: "☕", price: 30, stock: 50 },
    { id: "lib", name: "图书馆", x: 700, y: 80, w: 150, h: 110, color: "#3b5998", icon: "📚", price: 0, stock: 0 },
    { id: "park", name: "公园", x: 350, y: 380, w: 200, h: 130, color: "#4a7c3f", icon: "🌳", price: 10, stock: 30 },
    { id: "home1", name: "小住宅", x: 90, y: 400, w: 130, h: 90, color: "#c9a227", icon: "🏠", price: 0, stock: 0 },
    { id: "home2", name: "公寓", x: 640, y: 380, w: 150, h: 110, color: "#c9a227", icon: "🏢", price: 0, stock: 0 },
    { id: "market", name: "集市", x: 380, y: 70, w: 180, h: 120, color: "#7b3f99", icon: "🛒", price: 20, stock: 40 },
  ];
  function poiAt(x, y) {
    for (const p of POIS) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
    return null;
  }

  // ---------- NPC ----------
  const NAMES = ["小北", "阿澈", "柚子", "老周", "林可", "豆豆", "阿凯", "苏苏"];
  const JOBS = ["咖啡师", "图书管理员", "园艺师", "矿工", "记者", "快递员", "店主", "学生"];
  let startPointsRef = null;
  // 初始库存：price=0 的 POI（lib/home1/home2）取 0 仅作兜底，restock 会跳过它们。
  const POI_INITIAL_STOCK = { cafe: 50, lib: 0, park: 30, home1: 0, home2: 0, market: 40 };
  const PERSONALITIES = [
    { key: "saver", label: "节俭型", color: "#4ade80",
      likes: ["公园"], dislikes: ["咖啡馆"],
      chat: ["又存了点钱，感觉生活很踏实。", "今天没去咖啡馆，省下的咖啡钱够买一周的面包了。", "公园的椅子很便宜，坐着看云也很舒服。"] },
    { key: "social", label: "社交型", color: "#38bdf8",
      likes: ["咖啡馆", "集市"], dislikes: ["图书馆"],
      chat: ["刚才在咖啡馆认识了一个新邻居，聊得超开心！", "集市上那家水果铺今天人好多，下次一起去？", "我话多吗？我觉得小镇上大家都挺爱聊天的。"] },
    { key: "nerd", label: "学术型", color: "#c084fc",
      likes: ["图书馆"], dislikes: ["集市"],
      chat: ["新读到一本书，讲小镇经济循环的，很有意思。", "今天花 30 金币买了杯咖啡，但我觉得图书馆更值。", "你信玄学吗？我最近在读一本关于概率的书。"] },
    { key: "adventurer", label: "冒险型", color: "#fb923c",
      likes: ["集市", "公园"], dislikes: ["小住宅"],
      chat: ["今天去了集市最北边，看到了一家新开的面包房！", "冒险不是去哪，是愿意多走一步。", "今晚在公园散步的时候看到一只猫，超可爱。"] },
  ];

  function makeNpcs() {
    const npcs = [];
    const startPoints = [
      { x: 150, y: 450 }, { x: 700, y: 430 }, { x: 450, y: 130 }, { x: 430, y: 420 },
      { x: 470, y: 410 }, { x: 140, y: 150 }, { x: 690, y: 140 }, { x: 420, y: 430 },
    ];
    startPointsRef = startPoints;
    NAMES.forEach((name, i) => {
      const p = PERSONALITIES[i % PERSONALITIES.length];
      npcs.push({
        id: i, name, personality: p,
        job: JOBS[i % JOBS.length],
        x: startPoints[i].x, y: startPoints[i].y, r: 10,
        target: null, speed: 1.5 + Math.random() * 1.5, // 步速：世界单位 / 游戏分钟
        gold: 50 + Math.floor(Math.random() * 80),
        home: POIS[i % 2 === 0 ? 3 : 4],
        lastActionAt: gameTime, mood: "normal",
        emoji: ["🙂", "😄", "😎", "🤓"][i % 4],
        chatOpen: false, chatLines: p.chat,
        dailyGoal: null,      // 玩家给设定的"今日目标"
        goalBoost: null,      // 目标解析出的临时偏好
        stats: { spend: 0, social: 0, chats: 0, arrived: 0 },
      });
    });
    return npcs;
  }
  const npcs = makeNpcs();

  // ---------- 巡游 ----------
  // 把玩家给的"今日目标"解析成临时行为偏好（规则式，不依赖 LLM）
  function parseGoal(npc, text) {
    const t = text.toLowerCase();
    const likes = [];
    const dislike = null;
    let spendCap = null;
    let socialBias = false;
    let saveBias = false;
    let workBias = false;

    if (/(赚钱|打工|工作|赚金币|攒钱)/.test(t)) { workBias = true; }
    if (/(咖啡|cafe)/.test(t)) likes.push("咖啡馆");
    if (/(集市|购物|买东西)/.test(t)) likes.push("集市");
    if (/(公园|散步|锻炼|休息)/.test(t)) likes.push("公园");
    if (/(图书馆|读书|学习)/.test(t)) likes.push("图书馆");
    if (/(朋友|社交|聊天|交朋友)/.test(t)) { socialBias = true; likes.push("咖啡馆"); likes.push("集市"); }
    if (/(省钱|节俭|别花)/.test(t)) { saveBias = true; }
    if (/(少去|别去)/.test(t) && /(咖啡馆)/.test(t)) { /* 简单起见忽略否定 */ }

    npc.dailyGoal = text;
    npc.goalBoost = { likes, spendCap, socialBias, saveBias, workBias, t };
    // 新目标生效时，立刻按偏好选个目标
    if (npc.target && !npc.chatOpen) pickNextTarget(npc);
  }

  // 目标驱动的选点：优先 goal.likes，其次性格 likes，再次随机，最后回家
  function pickNextTarget(npc) {
    const boost = npc.goalBoost;
    const homeChance = 0.1;

    // 社交偏置：聊天中不抢目标
    if (npc.chatOpen) return;

    // 优先级 1：玩家目标 likes
    if (boost && boost.likes && boost.likes.length && Math.random() < 0.6) {
      npc.target = POIS.find((p) => boost.likes.includes(p.name)) || null;
      if (npc.target) { addEvent(`${npc.name} 按目标前往「${npc.target.name}」`, "move"); return; }
    }
    // 优先级 2：性格 likes
    if (Math.random() < 0.5) {
      const likes = POIS.filter((p) => npc.personality.likes.includes(p.name));
      npc.target = likes.length ? likes[Math.floor(Math.random() * likes.length)] : null;
      if (npc.target) { addEvent(`${npc.name} 前往「${npc.target.name}」`, "move"); return; }
    }
    // 优先级 3：回家
    if (Math.random() < homeChance) {
      npc.target = npc.home;
      npc.lastActionAt = gameTime;
      addEvent(`${npc.name} 回家了`, "move");
      return;
    }
    // 优先级 4：随机
    const pool = POIS.filter((p) => p !== npc.home);
    npc.target = pool[Math.floor(Math.random() * pool.length)];
    addEvent(`${npc.name} 前往「${npc.target.name}」`, "move");
  }

  function moveToward(npc, gameMin) {
    if (!npc.target || npc.chatOpen) return;
    // 确定性目标点：POI 中心，避免每 tick 随机抖动
    const tx = npc.target.x + npc.target.w / 2;
    const ty = npc.target.y + npc.target.h / 2;
    const dx = tx - npc.x, dy = ty - npc.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) { arrivePoi(npc); return; }
    // 步距 = 个人步速 × 本 tick 推进的游戏分钟（不超过剩余距离，避免越过后抖动）
    const step = Math.min(npc.speed * gameMin, dist);
    npc.x += (dx / dist) * step;
    npc.y += (dy / dist) * step;
    npc.x = Math.max(npc.r, Math.min(DESIGN_W - npc.r, npc.x));
    npc.y = Math.max(npc.r + 30, Math.min(DESIGN_H - npc.r, npc.y));
  }

  function arrivePoi(npc) {
    const poi = npc.target;
    npc.target = null;
    npc.stats.arrived++;
    // 消费概率：节俭型 / 目标省钱时降低
    let buyChance = 0.7;
    if (npc.goalBoost && npc.goalBoost.saveBias) buyChance = 0.2;
    if (npc.personality.key === "saver") buyChance = 0.4;
    if (poi.price > 0 && Math.random() < buyChance) consume(npc, poi);
    else say(npc, randomFrom(npc.personality.chat));
    // 社交偏置：更常闲聊
    if (npc.goalBoost && npc.goalBoost.socialBias && Math.random() < 0.5) {
      npc.stats.social++;
      say(npc, "刚才认识的新朋友，聊得真开心！");
    }
    if (Math.random() < 0.4) pickNextTarget(npc);
  }

  function consume(npc, poi) {
    if (npc.gold < poi.price) { say(npc, "金币不够，这次不买了。"); return; }
    npc.gold -= poi.price;
    npc.stats.spend += poi.price;
    poi.stock = Math.max(0, poi.stock - 1);
    addEvent(`${npc.name} 在${poi.name}花了 ${poi.price} 金币`, "money");
    say(npc, `在${poi.name}买了一份，感觉不错！`);
  }

  // ---------- 说话 / 气泡（跟随说话者，投影到屏幕） ----------
  const speechEl = document.getElementById("speech");
  function say(npc, text) {
    lastActive = npc;
    speechEl.textContent = `${npc.name}：${text}`;
    // 气泡锚定到 NPC 头顶（3D 投影到屏幕）
    const s = logicToScreen(npc);
    const elW = renderer.domElement.clientWidth;
    const elH = renderer.domElement.clientHeight;
    speechEl.style.left = `${Math.max(140, Math.min(elW - 140, s.x))}px`;
    speechEl.style.top = `${Math.max(70, s.y - 64)}px`;
    speechEl.classList.remove("hidden");
    clearTimeout(say._t);
    say._t = setTimeout(() => { speechEl.classList.add("hidden"); lastActive = null; }, 2800);
    addEvent(`${npc.name} 说：${text}`, "speak");
  }
  function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---------- 事件：字幕条 + 全日志 ----------
  const tickerTrack = document.getElementById("tickerTrack");
  const tickerLog = document.getElementById("tickerLog");
  const tickerExpand = document.getElementById("tickerExpand");
  const events = []; // 全量缓冲（最近 60 条）
  let tickerLogBody = null;

  function addEvent(text, kind = "") {
    const time = clockText();
    events.unshift({ time, text, kind });
    if (events.length > 60) events.pop();
    renderTicker();
    if (tickerLog.classList.contains("open")) renderLog();
  }

  // 字幕条：新事件从右滑入（CSS 动画），旧事件左移。
  // 维护固定 3 个 slot，仅更新文本，避免整段重建导致布局抖动。
  function renderTicker() {
    const items = events.slice(0, 3);
    while (tickerTrack.children.length < 3) tickerTrack.appendChild(makeTickerItem(items[2] || null));
    for (let i = 0; i < 3; i++) {
      const slot = tickerTrack.children[i];
      const e = items[i];
      if (!e) { slot.style.visibility = "hidden"; continue; }
      slot.style.visibility = "";
      const label = slot.lastElementChild;
      if (label.textContent !== e.text) {
        label.textContent = e.text;
        slot.className = `ticker-item ${e.kind}`;
        // 只对新出现的第一条重放滑入动画
        if (i === 0) {
          slot.style.animation = "none";
          void slot.offsetWidth;
          slot.style.animation = "";
        }
      }
    }
  }

  function makeTickerItem(e) {
    const el = document.createElement("span");
    el.className = `ticker-item ${e ? e.kind : ""}`;
    const dot = document.createElement("i");
    dot.className = "dot";
    const label = document.createElement("span");
    if (e) label.textContent = e.text;
    el.appendChild(dot); el.appendChild(label);
    return el;
  }

  function renderLog() {
    if (!tickerLogBody) {
      tickerLogBody = document.createElement("div");
      tickerLogBody.className = "log-body";
      tickerLog.appendChild(tickerLogBody);
    }
    tickerLogBody.innerHTML = "";
    for (const e of events) {
      const li = document.createElement("li");
      li.className = e.kind;
      const dot = document.createElement("i");
      dot.className = "dot";
      const t = document.createElement("span");
      t.className = "log-time";
      t.textContent = e.time;
      const msg = document.createElement("span");
      msg.textContent = e.text;
      li.appendChild(dot); li.appendChild(t); li.appendChild(msg);
      tickerLogBody.appendChild(li);
    }
    tickerLogBody.scrollTop = 0;
  }

  tickerExpand.addEventListener("click", () => {
    const open = tickerLog.classList.toggle("open");
    tickerExpand.textContent = open ? "⌃" : "⌄";
    tickerExpand.setAttribute("aria-label", open ? "收起全部事件" : "展开全部事件");
    if (open) renderLog();
  });

  // ---------- 时钟 / 昼夜 ----------
  const clockEl = document.getElementById("clock");
  const dayLabelEl = document.getElementById("daylabel");
  const nightveil = document.getElementById("nightveil");

  function clockText() {
    const totalMin = Math.floor(gameTime) % DAY_LENGTH;
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // 昼夜等级 0..1（连续，用于蒙层与配色插值）
  function daylight() {
    const t = (gameTime / 60) % 24;
    if (t < 5) return 0.12;
    if (t < 7) return 0.12 + (t - 5) / 2 * 0.88;   // 清晨 5→7
    if (t < 17) return 1.0;                          // 白天
    if (t < 20) return 1.0 - (t - 17) / 3 * 0.8;      // 黄昏 17→20
    if (t < 21.5) return 0.2 - (t - 20) / 1.5 * 0.08;  // 入夜
    return 0.12;
  }

  function updateVeil() {
    const light = daylight();
    // 夜晚蒙层：light 越低越暗
    const veilOpacity = light < 0.6 ? (0.6 - light) * 1.1 : 0;
    nightveil.style.opacity = Math.min(0.85, veilOpacity).toFixed(3);
  }

  // ---------- 旧 2D 绘制已移除（改用上面的 Three.js draw） ----------

  // ---------- 聊天（抽屉 chat tab） ----------
  const chatMeta = document.getElementById("chatMeta");
  const chatLog = document.getElementById("chatLog");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const goalForm = document.getElementById("goalForm");
  const goalInput = document.getElementById("goalInput");
  const drawer = document.getElementById("drawer");
  let drawerOpen = false;

  function setDrawer(open) {
    drawerOpen = open;
    document.body.classList.toggle("drawer-open", open);
    if (open) { renderRosterGold(); renderEconomy(); }
  }

  function openChat(npc) {
    activeNpc = npc;
    npc.chatOpen = true;
    chatMeta.textContent = `${npc.emoji} ${npc.name} · ${npc.personality.label} · ${npc.job}`;
    chatForm.classList.remove("hidden");
    goalForm.classList.remove("hidden");
    goalInput.value = npc.dailyGoal || "";
    goalInput.dataset.npc = npc.id;
    chatLog.innerHTML = "";
    addChatMsg("npc", `你好，我是${npc.name}，镇上${npc.job}。今天天气${lightOf()}，要不要聊两句？`);
    // 开抽屉 + 切到 chat tab
    setDrawer(true);
    switchTab("chat");
    highlightRoster(npc);
    chatLog.scrollTop = chatLog.scrollHeight;
    chatInput.focus();
  }

  function closeChat() {
    if (activeNpc) activeNpc.chatOpen = false;
    activeNpc = null;
    chatMeta.textContent = "点击居民或名册开始对话";
    chatForm.classList.add("hidden");
    goalForm.classList.add("hidden");
    chatLog.innerHTML = "";
    unhighlightRoster();
  }

  function lightOf() {
    const d = daylight();
    return d > 0.75 ? "很好" : d > 0.45 ? "有点凉" : d > 0.2 ? "挺安静" : "夜深了";
  }

  function addChatMsg(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !activeNpc) return;
    chatInput.value = "";
    activeNpc.stats.chats++;
    addChatMsg("user", text);
    activeNpc.chatOpen = true;
    const reply = respond(activeNpc, text);
    setTimeout(() => { addChatMsg("npc", reply); say(activeNpc, reply); }, 400 + Math.random() * 400);
  });

  // 玩家设定"今日目标" → 规则式解析成行为偏好
  goalForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const npc = npcs[Number(goalInput.dataset.npc)];
    if (!npc) return;
    const text = goalInput.value.trim();
    if (!text) {
      npc.dailyGoal = null;
      npc.goalBoost = null;
      addEvent(`${npc.name} 的目标清空了`, "day");
      return;
    }
    parseGoal(npc, text);
    addEvent(`${npc.name} 的新目标：${text}`, "day");
    addChatMsg("npc", `收到，我今天就按这个方向来：「${text}」。`);
    goalInput.value = npc.dailyGoal;
  });

  // 规则式回复
  // 规则式回复：职业 + 目标 + 关键词
  const JOB_STYLE = {
    "咖啡师": "刚擦完吧台，",
    "图书管理员": "从书架后探出身子，",
    "园艺师": "手上还沾着泥，",
    "矿工": "背着工具包，",
    "记者": "手里拿着笔记本，",
    "快递员": "刚送完一趟，",
    "店主": "站在自家铺子门口，",
    "学生": "书包还没放下，",
  };
  function respond(npc, text) {
    const t = text.toLowerCase();
    const p = npc.personality;
    const jobGreeting = JOB_STYLE[npc.job] || "";
    if (/(你好|hi|hello|嗨)/i.test(t)) {
      return `${jobGreeting}嗨，我是${npc.name}！${randomFrom(p.chat)}`;
    }
    if (/(目标|打算|计划|今天干嘛|要做什么)/i.test(t)) {
      if (npc.dailyGoal) return `我今天打算：${npc.dailyGoal}。你帮我把把关？`;
      return "今天没特别打算，走两步再说。要不你帮我定个？";
    }
    if (/(工作|上班|职业|做什么|营生)/i.test(t)) {
      return `我是镇上${npc.job}。日子过得去，攒钱要紧。`;
    }
    if (/(钱|金币|gold)/i.test(t)) {
      if (p.key === "saver") return `我现在 ${npc.gold} 金币，已花 ${npc.stats.spend}。打算攒着。`;
      if (p.key === "social") return `我现在 ${npc.gold} 金币，够请你看杯咖啡了！`;
      return `我现在 ${npc.gold} 金币，够生活，也能偶尔奢侈一下。`;
    }
    if (/(咖啡|cafe|咖啡馆)/i.test(t)) {
      if (p.dislikes.includes("咖啡馆")) return "我不太喜欢咖啡馆，更喜欢安静待着。";
      return "咖啡馆不错，我常去。要不要一起？";
    }
    if (/(图书馆|读书|书)/i.test(t)) {
      if (p.key === "nerd") return "图书馆是我最爱的地方，我读得正入迷呢。";
      if (p.dislikes.includes("图书馆")) return "图书馆太安静了，我坐不住。";
      return "图书馆挺舒服的，偶尔也去看看。";
    }
    if (/(天气|今天)/i.test(t)) {
      return `今天${lightOf()}。小镇上的日子就是平凡而美好。`;
    }
    if (/(公园|散步|走)/i.test(t)) {
      if (p.likes.includes("公园")) return "公园是我每天必去的地方！";
      return "公园不错，有空去走走。";
    }
    if (/(集市|买东西)/i.test(t)) {
      const market = POIS.find((p) => p.id === "market");
      return `集市的库存剩 ${market.stock} 份，要不要看看？`;
    }
    // 兜底：性格 + 职业风格
    return `${jobGreeting}${randomFrom(p.chat)}`;
  }

  // ---------- 抽屉 / Tab ----------
  const drawerTab = document.getElementById("drawerTab");
  const drawerClose = document.getElementById("drawerClose");
  const tabs = document.querySelectorAll(".drawer-tabs .tab");

  drawerTab.addEventListener("click", () => setDrawer(true));
  drawerClose.addEventListener("click", () => setDrawer(false));

  function switchTab(name) {
    document.querySelectorAll(".drawer .tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    document.querySelectorAll(".drawer .tab-pane").forEach((pn) => pn.classList.toggle("is-active", pn.dataset.pane === name));
    if (name === "chat") renderRosterGold();
  }
  tabs.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // ---------- 居民名册 ----------
  const roster = document.getElementById("roster");
  function buildRoster() {
    roster.innerHTML = "";
    for (const n of npcs) {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.dataset.id = n.id;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.style.background = n.personality.color;
      avatar.textContent = n.emoji;
      const nm = document.createElement("div");
      const nameEl = document.createElement("div");
      nameEl.className = "r-name";
      nameEl.textContent = n.name;
      const typeEl = document.createElement("div");
      typeEl.className = "r-type";
      typeEl.textContent = `${n.job} · ${n.personality.label}`;
      nm.appendChild(nameEl); nm.appendChild(typeEl);
      const gold = document.createElement("span");
      gold.className = "r-gold";
      gold.dataset.npc = n.id;
      gold.textContent = `${n.gold} 金`;
      li.appendChild(avatar); li.appendChild(nm); li.appendChild(gold);
      li.addEventListener("click", () => { openChat(n); locateNpc(n); });
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChat(n); locateNpc(n); } });
      roster.appendChild(li);
    }
  }
  function renderRosterGold() {
    roster.querySelectorAll(".r-gold").forEach((el) => {
      const n = npcs[Number(el.dataset.npc)];
      if (n) el.textContent = `${n.gold} 金`;
    });
  }
  function highlightRoster(npc) {
    roster.querySelectorAll("li").forEach((li) => li.classList.toggle("is-chatted", Number(li.dataset.id) === npc.id));
  }
  function unhighlightRoster() {
    roster.querySelectorAll("li").forEach((li) => li.classList.remove("is-chatted"));
  }
  function locateNpc(npc) {
    // 在 3D 场景上高亮该 NPC：临时标记，draw 中消费（暖橙定位圈脉冲）
    npc._locateT = performance.now();
  }

  // ---------- 经济面板 ----------
  const totalGoldEl = document.getElementById("totalGold");
  const shopCafeEl = document.getElementById("shopCafe");
  const shopParkEl = document.getElementById("shopPark");
  const shopMarketEl = document.getElementById("shopMarket");
  const leaderboard = document.getElementById("leaderboard");
  const rankMeta = document.getElementById("rankMeta");
  function renderEconomy() {
    totalGoldEl.textContent = npcs.reduce((s, n) => s + n.gold, 0);
    // 库存/价格一起显示，让用户知道"花多少"
    const cafe = POIS[0], park = POIS[2], market = POIS[5];
    shopCafeEl.textContent = `${cafe.stock} 份 · ${cafe.price}金`;
    shopParkEl.textContent = `${park.stock} 份 · ${park.price}金`;
    shopMarketEl.textContent = `${market.stock} 份 · ${market.price}金`;
    renderLeaderboard();
  }

  // 小镇名人榜：按"活跃分"排序（消费 + 社交 + 聊天 加权）
  function npcScore(n) {
    return n.stats.spend * 1 + n.stats.social * 20 + n.stats.chats * 15 + n.stats.arrived * 5;
  }
  function renderLeaderboard() {
    if (!leaderboard) return;
    const ranked = npcs
      .map((n) => ({ n, score: npcScore(n) }))
      .sort((a, b) => b.score - a.score);
    leaderboard.innerHTML = "";
    ranked.forEach((row, i) => {
      const li = document.createElement("li");
      li.className = "lb-item";
      const rank = document.createElement("span");
      rank.className = "lb-rank";
      rank.textContent = i + 1;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.style.background = row.n.personality.color;
      avatar.textContent = row.n.emoji;
      const name = document.createElement("span");
      name.className = "lb-name";
      name.textContent = `${row.n.name} · ${row.n.job}`;
      const score = document.createElement("span");
      score.className = "lb-score";
      score.textContent = `${row.score} 分`;
      li.appendChild(rank); li.appendChild(avatar); li.appendChild(name); li.appendChild(score);
      li.addEventListener("click", () => { openChat(row.n); locateNpc(row.n); });
      leaderboard.appendChild(li);
    });
    if (rankMeta) {
      const top = ranked[0];
      rankMeta.textContent = top ? `今日最活跃：${top.n.name}（${top.score} 分）` : "";
    }
  }

  // ---------- 3D 场景点击（raycast 拾取 NPC） ----------
  renderer.domElement.addEventListener("click", (e) => {
    const hit = screenToLogic(e.clientX, e.clientY);
    if (!hit) { closeChat(); return; }
    const wx = hit.x, wy = hit.y;
    // 找最近的 NPC（3D 视角下拾取半径放宽一点）
    let best = null, bestD = 26;
    for (const n of npcs) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) {
      if (activeNpc === best) { closeChat(); locateNpc(best); }
      else openChat(best);
    } else closeChat();
  });

  // ---------- HUD 控制 ----------
  const pauseBtn = document.getElementById("pauseBtn");
  const speedBtn = document.getElementById("speedBtn");
  const resetBtn = document.getElementById("resetBtn");

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "▶" : "⏸";
    pauseBtn.setAttribute("aria-label", paused ? "继续" : "暂停");
  });

  speedBtn.addEventListener("click", () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    speedBtn.textContent = `${speed}x`;
    try { localStorage.setItem("aitown_speed", String(speed)); } catch (_) {}
  });

  resetBtn.addEventListener("click", () => {
    if (!confirm("重置小镇？NPC 状态、金币、库存将还原到初始。")) return;
    for (const n of npcs) {
      n.x = startPointsRef[n.id].x;
      n.y = startPointsRef[n.id].y;
      n.target = null;
      n.gold = 50 + Math.floor(Math.random() * 80);
      n.chatOpen = false;
      n.emoji = ["🙂", "😄", "😎", "🤓"][n.id % 4];
      n.dailyGoal = null;
      n.goalBoost = null;
      n.stats = { spend: 0, social: 0, chats: 0, arrived: 0 };
    }
    for (const p of POIS) p.stock = POI_INITIAL_STOCK[p.id] ?? 0;
    gameTime = 9 * 60;
    dayCount = 1;
    dayLabelEl.textContent = "第 1 天";
    clockEl.textContent = clockText();
    events.length = 0;
    tickerLogBody && (tickerLogBody.innerHTML = "");
    speed = 1;
    speedBtn.textContent = "1x";
    paused = false;
    pauseBtn.textContent = "⏸";
    try { localStorage.removeItem("aitown_speed"); } catch (_) {}
    closeChat();
    renderTicker();
    addEvent("小镇已重置", "day");
    renderEconomy();
    draw();
  });

  // ---------- 经济/补货 ----------
  let restockTick = 0;
  const RESTOCK_LOG_EVERY = 5;
  function restock() {
    restockTick++;
    const shouldLog = restockTick % RESTOCK_LOG_EVERY === 0;
    for (const p of POIS) {
      if (p.price <= 0) continue;
      const cap = POI_INITIAL_STOCK[p.id] ?? 30;
      if (p.stock < cap) {
        p.stock = Math.min(cap, p.stock + 3);
        if (shouldLog) addEvent(`「${p.name}」补货至 ${p.stock}`, "money");
      }
    }
  }

  function nightCheck(npc) {
    if (npc.chatOpen) return;
    const t = (gameTime / 60) % 24;
    if ((t >= 22 || t < 6) && !npc.target) pickNextTarget(npc);
  }

  // 性能：只在抽屉打开时才全量刷新名册金币 / 经济面板
  function renderPanels() {
    if (drawerOpen) { renderRosterGold(); renderEconomy(); }
  }

  // ---------- 主循环 ----------
  function tick() {
    if (paused) return;
    const gameMin = MINUTES_PER_TICK * speed; // 本 tick 推进的游戏分钟
    gameTime += gameMin;
    if (gameTime >= DAY_LENGTH) {
      gameTime -= DAY_LENGTH;
      dayCount++;
      dayLabelEl.textContent = `第 ${dayCount} 天`;
      for (const n of npcs) {
        n.gold += 20;
        // 新的一日：目标失效 + 统计清零（名人榜按天算）
        n.dailyGoal = null;
        n.goalBoost = null;
        n.stats = { spend: 0, social: 0, chats: 0, arrived: 0 };
      }
      addEvent(`新的一天，津贴到账`, "day");
      restock();
    }
    for (const n of npcs) { nightCheck(n); moveToward(n, gameMin); }
    clockEl.textContent = clockText();
    renderPanels();
    draw();
  }

  // ---------- 启动 ----------
  for (const n of npcs) buildNpcMesh(n); // 建 3D 小人
  resize();
  buildRoster();
  dayLabelEl.textContent = `第 ${dayCount} 天`;
  clockEl.textContent = clockText();
  speedBtn.textContent = `${speed}x`;
  renderTicker();
  renderEconomy();
  draw();
  setInterval(tick, TICK_MS);

  // 预热 10 次，让 NPC 有初始动态
  for (let i = 0; i < 10; i++) {
    gameTime += MINUTES_PER_TICK;
    for (const n of npcs) { nightCheck(n); moveToward(n, MINUTES_PER_TICK); }
    if (gameTime >= DAY_LENGTH) gameTime -= DAY_LENGTH;
  }
  clockEl.textContent = clockText();
  addEvent("小镇开张了。点右下角「居民」开面板，或直接点居民开聊。", "day");
  draw();
})();
