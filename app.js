// 학생 화면(index.html)과 선생님 화면(teacher.html)이 같이 쓰는 코드
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

// ▼ Supabase 대시보드 > Project Settings > API 에서 복사해 넣는다 (publishable/anon 키만. secret·service_role 키는 절대 넣지 않는다)
export const SUPABASE_URL = "https://phfpfzeyzwszeunkunjn.supabase.co";
export const SUPABASE_KEY = "sb_publishable_H2HjCXlkHi5dpinVZguX6g_SilOqI31";

pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
export const configured = !SUPABASE_URL.includes("YOUR-PROJECT");

export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const studentEmail = (c, n) => `1-${c}-${String(n).padStart(2, "0")}@student.local`;

export async function loadLessons() {
  const { data, error } = await sb.from("lessons").select("*").order("ord").order("id");
  if (error) throw error;
  return data;
}

const fileCache = new Map();
async function download(path) {
  if (!fileCache.has(path)) {
    fileCache.set(path, sb.storage.from("materials").download(path).then(({ data, error }) => {
      if (error) { fileCache.delete(path); throw error; }
      return data;
    }));
  }
  return fileCache.get(path);
}

// PDF 보기: 한 쪽씩 canvas 에 그린다. 쪽수를 알고 맞추기 위해 pdf.js 를 쓴다.
export class PdfView {
  constructor(canvas, layers = []) { this.canvas = canvas; this.layers = layers; this.doc = null; this.path = null; this.page = 1; this.task = null; }
  get pages() { return this.doc?.numPages ?? 0; }
  async open(path) {
    if (path === this.path) return;
    this.path = path; this.doc = null;
    if (path === BOARD) return void (this.doc = BLANK);
    const blob = await download(path);
    const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
    if (this.path === path) this.doc = doc;
  }
  async show(page) {
    if (!this.doc) return;
    this.page = Math.min(Math.max(1, page), this.pages);
    const p = await this.doc.getPage(this.page);
    const box = this.canvas.closest(".pdfbox");
    const base = p.getViewport({ scale: 1 });
    const scale = Math.min(box.clientWidth / base.width, box.clientHeight / base.height) || 1;
    const vp = p.getViewport({ scale: scale * devicePixelRatio });
    this.task?.cancel();
    Object.assign(this.canvas, { width: vp.width, height: vp.height });
    this.canvas.style.width = vp.width / devicePixelRatio + "px";
    this.layers.forEach((x) => x.fit(this.canvas));
    this.task = p.render({ canvasContext: this.canvas.getContext("2d"), viewport: vp });
    await this.task.promise.catch(() => {});
  }
}

// 화이트보드: 파일 없이 흰 쪽 2장(16:9). pdf.js 문서처럼 보이게 해서 PdfView·판서를 그대로 쓴다.
export const BOARD = "board";
const BLANK = {
  numPages: 2,
  getPage: async () => ({
    getViewport: ({ scale }) => ({ width: 1600 * scale, height: 900 * scale }),
    render: ({ canvasContext: g, viewport: v }) => { g.fillStyle = "#fff"; g.fillRect(0, 0, v.width, v.height); return { promise: Promise.resolve(), cancel() {} }; },
  }),
};

// 판서·밑줄 층 (PDF 쪽 위에 겹친 canvas). 좌표와 굵기는 쪽 크기에 대한 비율이라 화면 크기가 달라도 같은 자리에 보인다.
// 선 하나 = { c: 색, w: 굵기(쪽 너비 비율), p: [x, y, x, y, ...] }
export class Ink {
  constructor(canvas, onChange) {
    Object.assign(this, { cv: canvas, onChange, strokes: [], tool: { c: "#000", w: 0.004 }, erase: false, cur: null, dirty: false });
    this.enable(false);
    canvas.onpointerdown = (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.cur = this.erase ? "erase" : { ...this.tool, p: [] };
      if (!this.erase) this.strokes.push(this.cur);
      this.move(e);
    };
    canvas.onpointermove = (e) => this.cur && this.move(e);
    canvas.onpointerup = canvas.onpointercancel = () => {
      this.cur = null;
      if (this.dirty) { this.dirty = false; this.onChange?.(this.strokes); }
    };
  }
  enable(on) { this.on = on; this.cv.style.pointerEvents = on ? "auto" : "none"; this.cv.style.touchAction = on ? "none" : "auto"; }
  set(strokes) { this.strokes = Array.isArray(strokes) ? strokes : []; this.cur = null; this.draw(); }
  fit(src) { this.cv.width = src.width; this.cv.height = src.height; this.draw(); }
  move(e) {
    const r = this.cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (this.cur === "erase") { // 지우개: 닿은 선을 통째로 지운다
      const n = this.strokes.length;
      this.strokes = this.strokes.filter((s) => !near(s, x * r.width, y * r.height, r.width, r.height));
      if (this.strokes.length === n) return;
    } else this.cur.p.push(Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4);
    this.dirty = true;
    this.draw();
  }
  draw() {
    const g = this.cv.getContext("2d"), W = this.cv.width, H = this.cv.height;
    g.clearRect(0, 0, W, H);
    g.lineCap = g.lineJoin = "round";
    for (const s of this.strokes) {
      if (!s.p?.length) continue;
      g.strokeStyle = s.c; g.lineWidth = s.w * W;
      g.beginPath(); g.moveTo(s.p[0] * W, s.p[1] * H);
      for (let i = 2; i < s.p.length; i += 2) g.lineTo(s.p[i] * W, s.p[i + 1] * H);
      if (s.p.length === 2) g.lineTo(s.p[0] * W + 0.1, s.p[1] * H); // 콕 찍은 점도 보이게
      g.stroke();
    }
  }
}
// 점 (x, y)(화면 px)가 선 s 에 닿았는지: 선분까지 거리로 잰다 (빠르게 그어 점이 듬성듬성해도 맞게)
export function near(s, x, y, W, H, rad = 14) {
  const p = s.p ?? [], R = rad + (s.w * W) / 2;
  for (let i = 0; i < p.length; i += 2) {
    const ax = p[i] * W, ay = p[i + 1] * H, dx = (p[i + 2] ?? p[i]) * W - ax, dy = (p[i + 3] ?? p[i + 1]) * H - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) < R) return true;
  }
  return false;
}

// 펜 도구 막대 (#pen #color #size #eraser). 반투명 색(형광펜)은 4배 넓게.
export function wireTools(ink) {
  const set = (mode) => {
    const c = $("#color").value;
    ink.tool = { c, w: Number($("#size").value) * (c.length > 7 ? 4 : 1) };
    ink.erase = mode === "erase";
    ink.enable(mode !== "off");
    $("#pen").classList.toggle("on", mode === "pen");
    $("#eraser").classList.toggle("on", mode === "erase");
  };
  $("#pen").onclick = () => set($("#pen").classList.contains("on") ? "off" : "pen");
  $("#eraser").onclick = () => set($("#eraser").classList.contains("on") ? "off" : "erase");
  $("#color").onchange = $("#size").onchange = () => set("pen");
  set("off");
}

// 단원 HTML 은 고치지 않고 srcdoc 으로 넣는다. sandbox 로 사이트 로그인 정보와 분리한다.
export async function showHtml(iframe, path) {
  if (iframe.dataset.path === path) return;
  iframe.dataset.path = path;
  iframe.srcdoc = await (await download(path)).text();
}

// 받은 HTML 문자열을 파일로 내려받기
export function saveHtml(filename, html) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([html], { type: "text/html" })), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function printHtml(html) {
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300); // 글꼴이 그려질 틈을 준다
}

export const fmtTime = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
