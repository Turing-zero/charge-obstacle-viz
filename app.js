import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (s) => document.querySelector(s);

// ---------- three.js ----------
const view = $("#view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101215);
const cam = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
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
const rgb = $("#rgb").getContext("2d");

// ---------- 组：data/index.json 列出所有组，每组 data/<id>/manifest.json ----------
const groups = await (await fetch("data/index.json")).json();
const hms = (id) => `${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}`;
$("#seq").innerHTML = groups.map((g, k) =>
  `<button role="tab" data-id="${g.id}"><b>场景 ${k + 1}</b><span>${hms(g.id)} · ${g.n} 帧</span></button>`).join("");
$("#seq").onclick = (e) => {
  const b = e.target.closest("button");
  if (b && b.dataset.id !== seq) openGroup(b.dataset.id);
};

let seq, F, cache, done, nDone, next, gen = 0, cur = 0, playing = false;

async function openGroup(id) {
  const g = ++gen;                 // 旧组的下载 / 播放看到 gen 变了就停
  playing = false;
  $("#play").textContent = "▶";
  const man = await (await fetch(`data/${id}/manifest.json`)).json();
  if (g !== gen) return;
  seq = id; F = man.frames;
  cache = new Map(); done = new Uint8Array(F.length); nDone = 0; next = 0;
  for (const b of $("#seq").children) b.setAttribute("aria-selected", b.dataset.id === id);
  history.replaceState(null, "", `#${id}`);
  const [, H] = man.camera.size, fy = man.camera.K[1];
  cam.fov = 2 * Math.atan(H / 2 / fy) * 180 / Math.PI;
  cam.updateProjectionMatrix();
  $("#frame").max = F.length - 1;
  drawBuffered();
  for (let k = 0; k < 8; k++) worker(g);
  show(0);
}

// ---------- 数据：打开一组就并行把全部帧拉下来，全留在内存 ----------
function load(i) {                 // → Promise<{pos, col, img}>
  if (!cache.has(i)) {
    const g = gen, c = cache, d = done, id = F[i].id, n = F[i].n;
    const img = new Image();       // RGB 一起缓冲，播放时图和点云同步
    img.src = `data/${seq}/img/${id}.jpg`;
    c.set(i, Promise.all([fetch(`data/${seq}/pc/${id}.bin`).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.arrayBuffer();
    }), img.decode()]).then(([buf]) => {
      const xyz = new Int16Array(buf, 0, 3 * n);
      const pos = new Float32Array(3 * n);
      for (let k = 0; k < n; k++) {  // OpenCV 相机系（x 右 y 下 z 前）→ three（x 右 y 上 z 后），mm → m
        pos[3 * k] = xyz[3 * k] / 1000; pos[3 * k + 1] = -xyz[3 * k + 1] / 1000; pos[3 * k + 2] = -xyz[3 * k + 2] / 1000;
      }
      if (g === gen) { d[i] = 1; nDone++; drawBuffered(); }
      return { pos, col: new Uint8Array(buf, 6 * n, 3 * n), img };
    }).catch((e) => { c.delete(i); throw e; }));
  }
  return cache.get(i);
}

async function worker(g) {         // 8 路并行按顺序拉
  while (g === gen && next < F.length) {
    const i = next++;
    if (done[i]) continue;
    try { await load(i); } catch { await new Promise((r) => setTimeout(r, 1000)); if (g === gen) next = Math.min(next, i); }
  }
}

function drawBuffered() {          // 时间轴底下：已缓冲的段亮色
  const stops = [];
  for (let i = 0; i < F.length;) {
    let j = i;
    while (j < F.length && done[j] === done[i]) j++;
    const c = done[i] ? "var(--accent)" : "var(--line)";
    stops.push(`${c} ${i / F.length * 100}%`, `${c} ${j / F.length * 100}%`);
    i = j;
  }
  $("#buf").style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  $("#bufn").textContent = nDone < F.length ? `缓冲 ${nDone}/${F.length}` : "";
}

async function show(i) {
  const g = gen;
  cur = i;
  $("#frame").value = i;
  $("#fid").textContent = `${F[i].t.toFixed(2)} s`;
  const d = await load(i);
  if (g !== gen || cur !== i) return;   // 拖得快 / 换了组：只画最后要的那帧
  geo.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(d.col, 3, true));
  geo.computeBoundingSphere();
  rgb.drawImage(d.img, 0, 0, 640, 360);   // 已解码的图，和点云同一帧画
}

// ---------- 播放（按录制时间） ----------
async function loop() {
  const g = gen;
  while (playing && g === gen) {
    const t0 = performance.now();
    const nx = (cur + 1) % F.length;
    await show(nx);
    const dt = nx ? (F[nx].t - F[nx - 1].t) * 1000 : 500;
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

const want = decodeURIComponent(location.hash.slice(1));
openGroup(groups.some((g) => g.id === want) ? want : groups[0].id);
