import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (s) => document.querySelector(s);
const man = await (await fetch("data/manifest.json")).json();
const F = man.frames;
const [, H] = man.camera.size, fy = man.camera.K[1];
$("#frame").max = F.length - 1;

// ---------- three.js ----------
const view = $("#view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101215);
const cam = new THREE.PerspectiveCamera(2 * Math.atan(H / 2 / fy) * 180 / Math.PI, 1, 0.01, 100);
const ctl = new OrbitControls(cam, renderer.domElement);
ctl.enableDamping = true;
const geo = new THREE.BufferGeometry();
scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true })));

function resetView() {             // 从相机位置看出去
  cam.position.set(0, 0, 0.001);
  ctl.target.set(0, 0, -2.5);
  ctl.update();
}
resetView();
new ResizeObserver(() => {
  const r = view.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  cam.aspect = r.width / Math.max(r.height, 1);
  cam.updateProjectionMatrix();
}).observe(view);
renderer.setAnimationLoop(() => { ctl.update(); renderer.render(scene, cam); });

// ---------- 数据 ----------
const cache = new Map();          // 帧序号 → Promise<{pos, col}>
function load(i) {
  if (!cache.has(i)) {
    cache.set(i, fetch(`data/pc/${F[i].id}.bin`).then((r) => r.arrayBuffer()).then((buf) => {
      const n = F[i].n, xyz = new Int16Array(buf, 0, 3 * n);
      const pos = new Float32Array(3 * n);
      for (let k = 0; k < n; k++) {  // OpenCV 相机系（x 右 y 下 z 前）→ three（x 右 y 上 z 后），mm → m
        pos[3 * k] = xyz[3 * k] / 1000; pos[3 * k + 1] = -xyz[3 * k + 1] / 1000; pos[3 * k + 2] = -xyz[3 * k + 2] / 1000;
      }
      return { pos, col: new Uint8Array(buf, 6 * n, 3 * n) };
    }));
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return cache.get(i);
}

let cur = 0;
async function show(i) {
  cur = i;
  $("#frame").value = i;
  $("#fid").textContent = `${F[i].t.toFixed(2)} s`;
  $("#rgb").src = `data/img/${F[i].id}.jpg`;
  const d = await load(i);
  if (cur !== i) return;           // 拖得快时只画最后一帧
  geo.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(d.col, 3, true));
  geo.computeBoundingSphere();
  for (let k = 1; k <= 4; k++) if (i + k < F.length) load(i + k);
}

// ---------- 播放（按录制时间） ----------
let playing = false;
async function loop() {
  while (playing) {
    const t0 = performance.now();
    const next = (cur + 1) % F.length;
    await show(next);
    const dt = next ? (F[next].t - F[next - 1].t) * 1000 : 500;
    await new Promise((r) => setTimeout(r, Math.max(0, dt - (performance.now() - t0))));
  }
}
function toggle() {
  playing = !playing;
  $("#play").textContent = playing ? "❚❚" : "▶";
  if (playing) loop();
}
$("#play").onclick = toggle;
$("#frame").oninput = (e) => show(+e.target.value);
$("#reset").onclick = resetView;
addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); toggle(); }
});

show(0);
