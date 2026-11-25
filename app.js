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
  constructor(canvas) { this.canvas = canvas; this.doc = null; this.path = null; this.page = 1; this.task = null; }
  get pages() { return this.doc?.numPages ?? 0; }
  async open(path) {
    if (path === this.path) return;
    this.path = path; this.doc = null;
    const blob = await download(path);
    const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
    if (this.path === path) this.doc = doc;
  }
  async show(page) {
    if (!this.doc) return;
    this.page = Math.min(Math.max(1, page), this.pages);
    const p = await this.doc.getPage(this.page);
    const box = this.canvas.parentElement;
    const base = p.getViewport({ scale: 1 });
    const scale = Math.min(box.clientWidth / base.width, box.clientHeight / base.height) || 1;
    const vp = p.getViewport({ scale: scale * devicePixelRatio });
    this.task?.cancel();
    Object.assign(this.canvas, { width: vp.width, height: vp.height });
    this.canvas.style.width = vp.width / devicePixelRatio + "px";
    this.task = p.render({ canvasContext: this.canvas.getContext("2d"), viewport: vp });
    await this.task.promise.catch(() => {});
  }
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
