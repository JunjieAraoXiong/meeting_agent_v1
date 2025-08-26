import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRAG } from "./src/hooks/useRAG";
import { RAGChat } from "./src/components/RAGChat";

/**
 * Feishu Text-Only Meeting Agent — MVP Demo (with History page)
 *
 * New in this build:
 * - A separate **History** page (hash route `#/history`) listing all saved meetings.
 * - **Save to history** button in the Agent header (stores title, date, participants, top terms, duration, transcript).
 * - Simple hash router (Agent ↔ History) with no external deps.
 * - LocalStorage-backed persistence with safe in-memory fallback.
 * - History actions: search, open (loads into Agent), delete, clear-all.
 * - Kept earlier fixes for Definition clicks + tests. Added two more tests (#14 #15) for UUID uniqueness and top-term ranking.
 */

// -----------------------------
// Types
// -----------------------------

type Segment = {
  idx: number; // sequential index
  t: number; // start time in seconds (derived or parsed)
  speaker: string;
  text: string;
};

type TermInfo = {
  term: string;
  count: number;
  firstIdx: number;
  occurrences: number[]; // segment indices
  contexts: string[]; // nearby sentences
};

type Meeting = {
  id: string;
  title: string;
  createdAt: string; // ISO
  transcript: string;
  segments: number;
  durationSec: number;
  participants: string[];
  topTerms: string[];
};

type TestResult = { name: string; pass: boolean; details?: string };

type Route = "agent" | "history";

// -----------------------------
// Utilities
// -----------------------------

const DEFAULT_REVEAL_SEC = 20; // reveal interval per line when timestamps absent
const HISTORY_KEY = "ftma_history_v1";
let MEM_HISTORY_CACHE: Meeting[] = [];

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function fmtTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

function fmtDate(ts: string) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Parse timestamps like [hh:mm:ss], hh:mm:ss, [mm:ss], mm:ss, with optional speaker:
// Examples:
// [00:01:23] Alice: text
// 00:03:10 Bob：中文：文本
// Speaker: text (no timestamp -> auto time)
const TS_REGEX = /\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?/;

function parseTimeToSeconds(str: string): number | null {
  const m = str.match(TS_REGEX);
  if (!m) return null;
  const h = m[3] ? parseInt(m[1], 10) : 0;
  const mm = m[3] ? parseInt(m[2], 10) : parseInt(m[1], 10);
  const ss = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10);
  return h * 3600 + mm * 60 + ss;
}

function parseTranscript(raw: string, defaultStep = DEFAULT_REVEAL_SEC): Segment[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const segs: Segment[] = [];
  let currentT = 0;

  // Pattern to match Feishu format: "说话人 1 00:01" or "汤欣钰 00:56"
  const feishuSpeakerPattern = /^(.+?)\s+(\d{1,2}:\d{2})$/;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines
    if (!line) continue;

    // Check if this is a Feishu speaker + timestamp line
    const feishuMatch = line.match(feishuSpeakerPattern);
    if (feishuMatch) {
      const speaker = feishuMatch[1].trim();
      const timestampStr = feishuMatch[2];
      const t = parseTimeToSeconds(timestampStr) || currentT;
      
      // Collect all content lines until next speaker or end
      let text = "";
      let j = i + 1;
      while (j < lines.length && lines[j] && !lines[j].match(feishuSpeakerPattern)) {
        if (text) text += " ";
        text += lines[j].trim();
        j++;
      }
      
      if (text) {
        segs.push({ idx: segs.length, t, speaker, text });
        currentT = t;
      }
      
      // Skip to the last processed line
      i = j - 1;
      continue;
    }

    // Fallback: try to parse original format [00:00:03] Speaker: content
    let t: number | null = null;
    let rest = line;

    const ts = line.match(TS_REGEX);
    if (ts) {
      const parsed = parseTimeToSeconds(line);
      if (parsed !== null) {
        t = parsed;
        // Remove the timestamp portion from the line display text
        rest = line.replace(TS_REGEX, "").replace(/^[-—\s]+/, "").trim();
      }
    }

    // Extract speaker if prefixed like "Alice:" or "张三："
    let speaker = "";
    let text = rest;
    const sp = rest.match(/^([A-Za-z0-9_\u4e00-\u9fa5 .\-（）()【】]+)\s*[:：]\s*(.*)$/);
    if (sp) {
      speaker = sp[1].trim();
      text = (sp[2] ?? "").trim();
    }

    if (t == null) {
      // Assign synthetic time based on prior + fixed step
      t = currentT === 0 && segs.length === 0 ? 0 : currentT + defaultStep;
    }

    if (text) {
      segs.push({ idx: segs.length, t, speaker, text });
      currentT = t;
    }
  }

  // Ensure strictly increasing time (for scrubber). If equal times exist, nudge slightly.
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].t <= segs[i - 1].t) segs[i].t = segs[i - 1].t + 1;
  }

  return segs;
}

// Basic tokenizer: splits English on non-word, keeps Chinese runs, strips trivial tokens.
function tokenize(s: string): string[] {
  // Split into sequences of CJK or word characters
  const tokens: string[] = [];
  const re = /([\u4e00-\u9fff]+)|([A-Za-z][A-Za-z0-9\-']+)|([A-Z]{2,6})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const tok = (m[1] || m[2] || m[3]).trim();
    if (!tok) continue;
    if (/^(the|and|for|with|this|that|是|的|了|在|我们|他们|一个|不是|如果)$/i.test(tok)) continue;
    tokens.push(tok);
  }
  return tokens;
}

// Heuristic term extraction: acronyms, Capitalized multi-words, codes like MI-123, and frequent proper-like tokens.
function extractTerms(segments: Segment[]): Map<string, TermInfo> {
  const map = new Map<string, TermInfo>();
  const addOcc = (term: string, idx: number, context: string) => {
    const key = term.trim();
    if (!key) return;
    const curr = map.get(key);
    if (curr) {
      curr.count += 1;
      curr.occurrences.push(idx);
      if (curr.contexts.length < 6) curr.contexts.push(context);
    } else {
      map.set(key, { term: key, count: 1, firstIdx: idx, occurrences: [idx], contexts: [context] });
    }
  };

  const multiWordRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z0-9\-]+){0,3})\b/g; // e.g., Project Atlas, Feishu Minutes
  const acronymRe = /\b([A-Z]{2,6})(?:\b|\d)\b/g; // e.g., OKR, KPI, LLM
  const codeRe = /\b([A-Z]{1,4}[\-_.]?[A-Z0-9]{2,6}|MI\-?\d{2,5})\b/g; // e.g., MI-123, P0, V2, TDS-42

  // Enhanced patterns for Chinese technical terms
  const techNumberRe = /(\d+\.?\d*[BM]?)\s*(模型|参数|版本)/g; // e.g., 1.5B模型, 参数
  const chineseCompoundRe = /([\u4e00-\u9fa5]{2,4})(项目|模型|模式|系统|平台|算法|方案|产品|设备|眼镜|手环|录音)/g; // e.g., 黑马项目, 端观测模型, 隐私模式
  const brandRe = /\b(Meta|Google|谷歌|苹果|小米|雷朋|Buzz|Take\s+Note|OA|Oakley|Oakland)\b/gi; // Brand names

  segments.forEach((seg) => {
    const { text, idx } = seg;

    // English Proper-like multi-words
    let m: RegExpExecArray | null;
    while ((m = multiWordRe.exec(text))) addOcc(m[1], idx, text);

    // Acronyms
    while ((m = acronymRe.exec(text))) addOcc(m[1], idx, text);

    // Codes
    while ((m = codeRe.exec(text))) addOcc(m[1], idx, text);

    // Technical numbers (e.g., 1.5B模型)
    while ((m = techNumberRe.exec(text))) addOcc(m[0], idx, text);

    // Chinese compound terms
    while ((m = chineseCompoundRe.exec(text))) addOcc(m[0], idx, text);

    // Brand names
    while ((m = brandRe.exec(text))) addOcc(m[0], idx, text);

    // Chinese noun-ish heuristic: pick 2-6 length CJK runs that repeat
    const cjkRe = /([\u4e00-\u9fa5]{2,6})/g;
    const seen = new Set<string>();
    while ((m = cjkRe.exec(text))) {
      const term = m[1];
      if (seen.has(term)) continue;
      seen.add(term);
      
      // Filter out common particles and connectors
      if (!/^(这个|那个|就是|然后|但是|如果|所以|因为|可能|应该|需要|觉得|知道|看到|听到|说的|做的|用的|有的|没有|不是|是的|对的|好的|行的|OK|ok)$/i.test(term)) {
        addOcc(term, idx, text);
      }
    }
  });

  // Post-filter: keep terms with count >= 2 OR that look like acronyms/codes/proper/brands
  for (const [k, v] of Array.from(map.entries())) {
    const looksImportant = 
      /^[A-Z]{2,6}$/.test(k) || // Acronyms
      /MI\-?\d{2,5}/.test(k) || // MI codes
      /[A-Z]{1,4}[\-_.]?[A-Z0-9]{2,6}/.test(k) || // Other codes
      /\s/.test(k) || // Multi-word terms
      /\d+\.?\d*[BM]/.test(k) || // Technical numbers
      /(项目|模型|模式|系统|平台|算法|方案|产品|设备|眼镜|手环|录音)$/.test(k) || // Chinese compound terms
      /^(Meta|Google|谷歌|苹果|小米|雷朋|Buzz|Take|Note|OA|Oakley|Oakland)$/i.test(k); // Brands
    
    if (v.count < 2 && !looksImportant) map.delete(k);
  }

  return map;
}

function buildDefinitions(terms: Map<string, TermInfo>, segments: Segment[]): Map<string, string> {
  const defs = new Map<string, string>();
  const hintPatterns = [
    /\b(is|are|aka|stands for|means)\b/i,
    /是|即|叫做|指(的)?是|简称/
  ];

  for (const [term, info] of terms.entries()) {
    // Search contexts for definitional hints
    let best: string | null = null;
    for (const ci of info.contexts) {
      if (hintPatterns.some((re) => re.test(ci) && ci.toLowerCase().includes(term.toLowerCase()))) {
        best = ci;
        break;
      }
    }
    if (!best) {
      // fallback: take the first occurrence line with a short summary from nearby words
      const firstSeg = segments[info.firstIdx];
      if (firstSeg) {
        const ctx = firstSeg.text;
        const snippet = ctx.length > 160 ? ctx.slice(0, 157) + "…" : ctx;
        best = `从上下文推断：${snippet}`;
      } else {
        best = "（暂无法从上下文提炼定义，可手动补充）";
      }
    }
    defs.set(term, best);
  }
  return defs;
}

// -----------------------------
// Search & highlight helpers
// -----------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Case-insensitive map lookup helper
function getTermInfo(term: string, map: Map<string, TermInfo>): TermInfo | undefined {
  if (map.has(term)) return map.get(term)!;
  const lower = term.toLowerCase();
  for (const [k, v] of map.entries()) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

// Safely highlight terms; clickable via data-term & data-term-key (URI-encoded lowercase)
function highlightTerms(text: string, terms: string[], active: string | null): string {
  if (!text) return "";
  if (!terms || terms.length === 0) return escapeHtml(text);

  const uniq = Array.from(new Set(terms.filter(Boolean)));
  const sorted = uniq.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map(escRegExp).join("|")})`, "gi");
  const lowerSet = new Set(sorted.map((t) => t.toLowerCase()));
  const activeLower = active ? active.toLowerCase() : null;

  const parts = text.split(pattern);
  return parts
    .map((part) => {
      if (lowerSet.has(part.toLowerCase())) {
        const isActive = activeLower && part.toLowerCase() === activeLower;
        const cls = isActive ? "bg-yellow-300 border border-yellow-400" : "bg-yellow-100 hover:bg-yellow-200 border border-yellow-200";
        const key = encodeURIComponent(part.toLowerCase());
        return `<mark data-term="${escapeHtml(part)}" data-term-key="${key}" class="px-1 py-0.5 rounded cursor-pointer transition-colors ${cls} font-medium">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

function scoreSegment(queryTokens: string[], seg: Segment): number {
  const textTokens = tokenize(seg.text.toLowerCase());
  let score = 0;
  for (const qt of queryTokens) {
    score += textTokens.filter((t) => t.toLowerCase() === qt.toLowerCase()).length;
  }
  // Mild boost for recency
  score += seg.idx * 0.01;
  return score;
}

function xNotBoilerplate(text: string): boolean {
  return !/(静音|mute|进出会议|录制开始|录制结束)/.test(text);
}

function topKRelevant(query: string, segments: Segment[], k = 5): Segment[] {
  const qts = tokenize(query);
  if (qts.length === 0) return [];
  const scored = segments.map((s) => ({ s, sc: scoreSegment(qts, s) }));
  scored.sort((a, b) => b.sc - a.sc);
  return scored
    .slice(0, k)
    .map((x) => x.s)
    .filter((s) => s.text.trim().length > 0 && xNotBoilerplate(s.text));
}

function getTopTerms(terms: Map<string, TermInfo>, n = 8): string[] {
  return Array.from(terms.values())
    .sort((a, b) => (b.count - a.count) || (a.firstIdx - b.firstIdx))
    .slice(0, n)
    .map((t) => t.term);
}

// -----------------------------
// LLM Definition (stubbed) + cache
// -----------------------------

function synthesizeDefinition(term: string, info: TermInfo | undefined, heuristic: string | undefined): string {
  const snippets = info?.contexts?.slice(0, 2).map((s) => (s.length > 120 ? s.slice(0, 117) + "…" : s)) || [];
  const cnLikely = (snippets.join("\n") + (heuristic || "")).match(/[\u4e00-\u9fff]/);
  const pre = cnLikely ? `${term}：` : `${term}: `;
  const core = heuristic && heuristic.replace(/^从上下文推断：/, "");
  const extra = snippets.length ? (cnLikely ? `依据上下文片段："${snippets[0]}"${snippets[1] ? `；"${snippets[1]}"` : ""}` : `Context hints: "${snippets[0]}"${snippets[1] ? `; "${snippets[1]}"` : ""}`) : (cnLikely ? "暂无更多上下文。" : "No additional context.");
  return `${pre}${core || (cnLikely ? "（等待模型给出更准确释义）" : "(awaiting model for precise definition)")}${cnLikely ? "。" : "."} ${extra}`;
}

// -----------------------------
// Persistence helpers
// -----------------------------

function loadHistory(): Meeting[] {
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(HISTORY_KEY) : null;
    if (s) {
      const arr = JSON.parse(s) as Meeting[];
      MEM_HISTORY_CACHE = arr;
      return arr;
    }
  } catch {}
  return MEM_HISTORY_CACHE || [];
}

function saveHistory(list: Meeting[]) {
  MEM_HISTORY_CACHE = list;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {}
}

// -----------------------------
// Sample transcript (mixed CN/EN)
// -----------------------------

const SAMPLE = `汤欣钰 00:00
猫戴在身上，然后又有定位，又有糖包与翻译。嗯，去年好像就有这个，好像就有一个，去年好像有一个类似的，就是也戴在什么身上啊？狗啊？对啊，那个网站的哪里啊？那个有没有总的那个 list？如果单独发一个，OK，我来发一个这种的 list，先，这个先到，我发也行，张老师不用发。

汤欣钰 00:56
然后，嗯，要不然我们先说，嗯，就明天，不是还是下午有那个周会嘛？嗯，对，就大家最近有没有什么困难？然后以及有没有识别到什么机会、想法的？然后其他的就是例行的，比如在会上就例行同步了。主要是我觉得大会前没有什么要决策的。对，一个是那个我知道的，一个是志旭那边，对吧？他手机测这个开发的资源，或者说这种能力我们还比较短缺一些，是吧？行，这个是已经知道了。

汤欣钰 01:36
对，我看这个黑马项目他们都有在全捷 OA 上部署一些 1.5B 的端观测模型。嗯，完全是比我们这个参数量要大得多，然后好像还行，那可以联系下他们，是吧？反正就是那个黑马，这个马拉松上，对，我觉得可能那些人也很重要，看哪些人有意思，然后跟他们聊一聊。

汤欣钰 02:04
你这个知道，然后我再问一下这边的 Buzz，是吧？然后我也留了。那个还有没有什么困难啊？有没有大家觉得遇到一些困难的？对。嗯，有个比较大的困难，就跟上头聊的那个隐私模式，其实感觉没有特别好的思路。嗯，但是我又回归到那个眼镜问题，因为之前谷歌他们不是也遇到很难解释的问题嘛？嗯，然后回顾了一下雷朋的解法，那个 Meta 的解法，但是到咱们这块，语音相关的那个人还没有特别好的一个。行，这个待会我们再说。行，这个同学大概知道了。

汤欣钰 02:55
我拿得到的哦。我已经在录了，我也把它操，我看我把这个分享到群里。

汤欣钰 03:25
你，所以你觉得你自己最，不是，你的目标，你想解决的是那个什么？你达到什么样的预期？今年达到一个预期，就是我可以再具体一点的，在那里面就是，其实录音笔这个形态本身很难让这个人放松那个戒备。就哪怕我跟他，嗯，开始跟我讲了，我现在只做那个信息的收集，不做原始近期的处理，我只做一些简要或者摘要，但是很难让别人信任。之后你都自由，不让你的，你就没有意愿。`;

// -----------------------------
// React Component (Router + Agent + History)
// -----------------------------

export default function FeishuTextOnlyAgentDemo() {
  // Router
  const [route, setRoute] = useState<Route>("agent");
  useEffect(() => {
    const sync = () => setRoute(location.hash === "#/history" ? "history" : "agent");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const goto = (r: Route) => { location.hash = r === "history" ? "#/history" : "#/"; };

  // History state
  const [history, setHistory] = useState<Meeting[]>(() => loadHistory());

  // Transcript state (Agent)
  const [raw, setRaw] = useState<string>(SAMPLE.trim());
  const [segments, setSegments] = useState<Segment[]>(() => parseTranscript(SAMPLE));

  // Player state
  const [play, setPlay] = useState(false);
  const [speed, setSpeed] = useState<number>(20); // seconds per line when synthetic
  const [playhead, setPlayhead] = useState<number>(0);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);

  // Paste modal state
  const [showPaste, setShowPaste] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");

  const maxT = segments.length ? segments[segments.length - 1].t + speed : 0;

  // Extract terms and build definitions from WHOLE transcript
  const termMap = useMemo(() => extractTerms(segments), [segments]);
  const definitions = useMemo(() => buildDefinitions(termMap, segments), [termMap, segments]);

  // Terms "introduced" by timeline; if none yet, fallback to ALL terms so clicking works immediately.
  const introducedTerms = useMemo(() => {
    const set = new Set<string>();
    for (const [term, info] of termMap.entries()) {
      if (info.firstIdx <= activeIdx) set.add(term);
    }
    const arr = Array.from(set);
    return arr.length > 0 ? arr : Array.from(termMap.keys());
  }, [termMap, activeIdx]);

  // Play loop
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => {
      setPlayhead((t) => Math.min(t + 1, maxT));
    }, 1000);
    return () => clearInterval(id);
  }, [play, maxT]);

  // Update activeIdx based on playhead
  useEffect(() => {
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].t <= playhead) idx = i; else break;
    }
    setActiveIdx(idx);
  }, [playhead, segments]);

  // Auto-scroll the transcript to keep the newest revealed line in view
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Native click listener for highlights (robust for innerHTML)
  useEffect(() => {
    const host = listRef.current;
    if (!host) return;
    const handler = (ev: MouseEvent) => {
      const rawTarget = ev.target as Node | null;
      if (!rawTarget) return;
      const el = (rawTarget.nodeType === 3 ? (rawTarget.parentElement as HTMLElement) : (rawTarget as HTMLElement));
      if (!el || !("closest" in el)) return;
      const mark = (el.closest('mark[data-term],mark[data-term-key]') as HTMLElement | null);
      if (!mark) return;
      ev.preventDefault();
      ev.stopPropagation();
      
      console.log('Term clicked:', mark); // Debug log
      
      let chosen = '';
      const keyAttr = mark.getAttribute('data-term-key');
      if (keyAttr) {
        try {
          const decoded = decodeURIComponent(keyAttr);
          for (const k of termMap.keys()) {
            if (k.toLowerCase() === decoded) { chosen = k; break; }
          }
        } catch {}
      }
      if (!chosen) chosen = mark.getAttribute('data-term') || mark.textContent || '';
      
      console.log('Chosen term:', chosen); // Debug log
      
      if (chosen) {
        console.log('Setting focus term:', chosen); // Debug log
        setActiveTerm(chosen);
        setFocusTerm(chosen);
        fetchLLMDefinition(chosen);
      }
    };
    host.addEventListener('click', handler, true); // Use capture phase
    return () => host.removeEventListener('click', handler, true);
  }, [termMap]);

  // Re-parse when speed (defaultStep) or raw changes (for synthetic times)
  useEffect(() => {
    const segs = parseTranscript(raw, speed);
    setSegments(segs);
    setPlayhead(0);
    setActiveIdx(-1);
    setFocusTerm(null);
    setActiveTerm(null);
    defCache.current.clear();
  }, [raw, speed]);

  // Modal keyboard close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowPaste(false); }
    if (showPaste) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPaste]);

  // Upload handler
  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result || ""));
    reader.readAsText(f);
  }

  // Copy current transcript
  async function copyTranscript() {
    try {
      await (navigator as any)?.clipboard?.writeText(raw);
      alert('Transcript copied to clipboard');
    } catch {
      alert('Clipboard not available');
    }
  }

  // Compute & save to history
  function saveCurrentToHistory() {
    const participants = Array.from(new Set(segments.map((s) => s.speaker).filter(Boolean))) as string[];
    const durationSec = segments.length > 0 ? Math.max(...segments.map((s) => s.t)) - Math.min(...segments.map((s) => s.t)) : 0;
    const defaultTitle = participants.length ? `${participants[0]} 等会议` : `Meeting`;
    const title = (typeof window !== 'undefined' && window.prompt) ? (window.prompt('会议标题（可修改）：', defaultTitle) || defaultTitle) : defaultTitle;
    const topTerms = getTopTerms(termMap, 8);
    const meeting: Meeting = {
      id: uuid(),
      title,
      createdAt: new Date().toISOString(),
      transcript: raw,
      segments: segments.length,
      durationSec: Math.max(0, durationSec),
      participants,
      topTerms,
    };
    setHistory((prev) => {
      const list = [meeting, ...prev];
      saveHistory(list);
      return list;
    });
    alert('Saved to History');
    goto('history');
  }

  // RAG system integration
  const { indexMeeting, setCurrentMeeting, status: ragStatus } = useRAG();
  
  // Auto-index meeting when segments change
  useEffect(() => {
    if (segments.length > 0) {
      const meetingId = `meeting_${Date.now()}`;
      setCurrentMeeting(meetingId);
      indexMeeting(meetingId, segments);
    }
  }, [segments, indexMeeting, setCurrentMeeting]);

  function jumpTo(idx: number) {
    const t = segments[idx]?.t ?? 0;
    setPlayhead(t);
    setPlay(true);
  }

  // Definition Focus Mode state
  const [focusTerm, setFocusTerm] = useState<string | null>(null);
  const [focusDef, setFocusDef] = useState<string>("");
  const [defLoading, setDefLoading] = useState<boolean>(false);
  const [defError, setDefError] = useState<string | null>(null);
  const defCache = useRef<Map<string, string>>(new Map());

  const fetchLLMDefinition = React.useCallback(async (term: string, force = false) => {
    setDefLoading(true);
    setDefError(null);
    try {
      if (!force && defCache.current.has(term)) {
        setFocusDef(defCache.current.get(term)!);
        return;
      }
      // Simulate LLM definition generation (replace with real API call)
      await new Promise((res) => setTimeout(res, 300));
      const info = getTermInfo(term, termMap);
      const heuristic = definitions.get(info?.term || term);
      const generated = synthesizeDefinition(info?.term || term, info, heuristic);
      defCache.current.set(term, generated);
      setFocusDef(generated);
    } catch (e: any) {
      setDefError(String(e?.message || e));
      // Fallback to heuristic
      const info = getTermInfo(term, termMap);
      setFocusDef(definitions.get(info?.term || term) || "（暂无定义）");
    } finally {
      setDefLoading(false);
    }
  }, [termMap, definitions]);

  function openFocus(t: string) {
    setActiveTerm(t);
    setFocusTerm(t);
    fetchLLMDefinition(t);
  }

  function closeFocus() {
    setFocusTerm(null);
    setDefError(null);
  }

  // Render helpers (Agent)
  function renderSegment(seg: Segment) {
    const html = highlightTerms(seg.text, introducedTerms, activeTerm);
    const isRevealed = seg.idx <= activeIdx;
    return (
      <div
        key={seg.idx}
        data-idx={seg.idx}
        className={`rounded-xl px-3 py-2 my-1 border ${isRevealed ? "bg-white" : "bg-gray-50 opacity-60"}`}
      >
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <span className="font-mono">{fmtTime(seg.t)}</span>
          {seg.speaker && <span className="px-2 py-0.5 bg-gray-100 rounded-full">{seg.speaker}</span>}
        </div>
        <div
          className="mt-1 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  // -----------------------------
  // Dev/Test Panel
  // -----------------------------

  const [tests, setTests] = useState<TestResult[]>([]);

  async function runTests() {
    const results: TestResult[] = [];

    // 1) parseTranscript monotonic & count
    try {
      const tsv = `00:00 Alice: hi\n00:00 Bob: same second\nBob: no ts line`;
      const segs = parseTranscript(tsv, 20);
      const mono = segs.every((s, i, arr) => (i === 0 ? true : s.t > arr[i - 1].t));
      results.push({ name: "parseTranscript monotonic", pass: mono, details: JSON.stringify(segs.map(s => s.t)) });
      results.push({ name: "parseTranscript length", pass: segs.length === 3, details: `${segs.length}` });
    } catch (e: any) {
      results.push({ name: "parseTranscript error", pass: false, details: String(e?.message || e) });
    }

    // 2) tokenize includes CJK
    const toks = tokenize("冷启动 提升 OKR");
    results.push({ name: "tokenize CJK+EN", pass: toks.includes("冷启动") && toks.includes("OKR"), details: toks.join(",") });

    // 3) extractTerms finds OKR / MI-231
    const segs2: Segment[] = [
      { idx: 0, t: 0, speaker: "A", text: "我们讨论 MI-231 的 OKR", },
      { idx: 1, t: 10, speaker: "B", text: "MI-231 进入 Q4，OKR 需要更新", },
    ];
    const terms = extractTerms(segs2);
    results.push({ name: "extractTerms OKR", pass: terms.has("OKR"), details: Array.from(terms.keys()).join(", ") });
    results.push({ name: "extractTerms MI-231", pass: Array.from(terms.keys()).some(k => k.includes("MI-231")), details: Array.from(terms.keys()).join(", ") });

    // 4) highlightTerms wraps with <mark>
    const hi = highlightTerms("包含 OKR 与 冷启动", ["OKR", "冷启动"], null);
    results.push({ name: "highlightTerms mark", pass: hi.includes("<mark") });

    // 5) topKRelevant returns non-empty for query
    const tk = topKRelevant("OKR", segs2, 2);
    results.push({ name: "topKRelevant basic", pass: tk.length > 0 });

    // 6) synthesizeDefinition contains term
    const info: TermInfo = { term: "OKR", count: 2, firstIdx: 0, occurrences: [0,1], contexts: ["OKR 是目标与关键结果", "更新 OKR 以匹配 Q4"] };
    const syn = synthesizeDefinition("OKR", info, "OKR 是 Objectives and Key Results 的简称");
    results.push({ name: "synthesizeDefinition contains term", pass: syn.includes("OKR"), details: syn.slice(0, 64) + "…" });

    // 7) highlightTerms has data-term attribute for clickability
    results.push({ name: "highlightTerms data-term", pass: /data-term=/.test(hi) });

    // 8) highlightTerms XSS safety (no onerror attribute in output)
    const hiXss = highlightTerms('<img src=x onerror=alert(1)> OKR', ["OKR"], null);
    results.push({ name: "highlightTerms XSS safe", pass: !/onerror\s*=/.test(hiXss), details: hiXss.slice(0, 80) + "…" });

    // 9) topKRelevant cap at k
    const tkCap = topKRelevant("OKR", segs2, 1);
    results.push({ name: "topKRelevant cap", pass: tkCap.length === 1 });

    // 10) highlightTerms has data-term-key attribute
    results.push({ name: "highlightTerms data-term-key", pass: /data-term-key=/.test(hi) });

    // 11) getTermInfo case-insensitive lookup
    const ti = getTermInfo("okr", terms);
    results.push({ name: "getTermInfo ci lookup", pass: !!ti && ti.term === "OKR" });

    // 12) data-term-key roundtrip
    const key = encodeURIComponent("OKR".toLowerCase());
    results.push({ name: "term-key roundtrip", pass: decodeURIComponent(key) === "okr" });

    // 13) highlightTerms has cursor-pointer class for affordance
    results.push({ name: "highlightTerms cursor", pass: /cursor-pointer/.test(hi) });

    // 14) uuid uniqueness
    const u1 = uuid(), u2 = uuid();
    results.push({ name: "uuid uniqueness", pass: u1 !== u2 && u1.length === 36 && u2.length === 36 });

    // 15) getTopTerms ranking by count then firstIdx
    const fake = new Map<string, TermInfo>([
      ["OKR", { term: "OKR", count: 5, firstIdx: 3, occurrences: [], contexts: [] }],
      ["MI-231", { term: "MI-231", count: 4, firstIdx: 0, occurrences: [], contexts: [] }],
      ["pgvector", { term: "pgvector", count: 4, firstIdx: 2, occurrences: [], contexts: [] }],
    ]);
    const tops = getTopTerms(fake, 3);
    results.push({ name: "getTopTerms ranking", pass: tops[0] === "OKR" && (tops[1] === "MI-231" || tops[1] === "pgvector") });

    setTests(results);
  }

  const passCount = tests.filter((t) => t.pass).length;

  // -----------------------------
  // Render
  // -----------------------------

  return (
    <div className="w-full min-h-screen bg-neutral-50 p-4 sm:p-6">
      {/* Header + Nav */}
      <div className="max-w-7xl mx-auto mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Feishu Text-Only Meeting Agent — Demo</h1>
            <nav className="flex items-center gap-1 text-sm">
              <button onClick={() => goto('agent')} className={`px-3 py-1.5 rounded-xl border ${route==='agent' ? 'bg-amber-50' : 'bg-white hover:shadow'}`}>Agent</button>
              <button onClick={() => goto('history')} className={`px-3 py-1.5 rounded-xl border ${route==='history' ? 'bg-amber-50' : 'bg-white hover:shadow'}`}>History</button>
            </nav>
          </div>
          {route === 'agent' ? (
            <div className="flex items-center gap-2">
              {ragStatus.isConfigured && (
                <div className="flex items-center gap-1 text-sm px-2 py-1 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-green-600">🤖</span>
                  <span className="text-green-700">RAG Ready</span>
                  {ragStatus.vectorCount > 0 && (
                    <span className="text-green-600 text-xs">({ragStatus.vectorCount})</span>
                  )}
                </div>
              )}
              <label className="inline-flex items-center gap-2 text-sm px-3 py-2 bg-white border rounded-xl cursor-pointer hover:shadow">
                <input type="file" accept=".txt,.md,.srt,.vtt,.csv" className="hidden" onChange={onUpload} />
                Upload .txt
              </label>
              <button className="text-sm px-3 py-2 bg-white border rounded-xl hover:shadow" onClick={() => setRaw(SAMPLE.trim())}>Load sample</button>
            </div>
          ) : (
            <div/>
          )}
        </div>
      </div>

      {route === 'agent' ? (
        <>
          {/* Agent Header row with paste/copy/save */}
          <div className="max-w-7xl mx-auto flex items-center gap-2 mb-3">
            <button className="text-sm px-3 py-2 bg-amber-50 border rounded-xl hover:shadow" onClick={() => { setPasteDraft(""); setShowPaste(true); }}>Paste</button>
            <button className="text-sm px-3 py-2 bg-white border rounded-xl hover:shadow" onClick={copyTranscript}>Copy</button>
            <button className="text-sm px-3 py-2 bg-white border rounded-xl hover:shadow" onClick={saveCurrentToHistory}>Save to history</button>
          </div>

          {/* Main layout */}
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left: FULL timeline */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-sm border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Simulated timeline</span>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Synthetic step</span>
                      <select
                        className="border rounded-xl px-2 py-1"
                        value={speed}
                        onChange={(e) => setSpeed(parseInt(e.target.value, 10))}
                      >
                        <option value={5}>5s</option>
                        <option value={10}>10s</option>
                        <option value={20}>20s</option>
                        <option value={30}>30s</option>
                        <option value={60}>1 minute</option>
                        <option value={120}>2 minutes</option>
                      </select>
                    </div>
                    <button
                      className={`px-3 py-1.5 rounded-xl text-sm border ${play ? "bg-red-50" : "bg-green-50"}`}
                      onClick={() => setPlay((p) => !p)}
                    >{play ? "Pause" : "Play"}</button>
                    <button className="px-3 py-1.5 rounded-xl text-sm border" onClick={() => { setPlay(false); setPlayhead(0); }}>Reset</button>
                  </div>
                </div>

                {/* Scrubber */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-500 w-12">{fmtTime(playhead)}</span>
                  <input type="range" min={0} max={Math.max(maxT, 1)} value={playhead} onChange={(e) => setPlayhead(parseInt(e.target.value, 10))} className="w-full" />
                  <span className="text-xs font-mono text-gray-500 w-12 text-right">{fmtTime(maxT)}</span>
                </div>

                {/* Transcript feed (taller) */}
                <div ref={listRef} className="mt-3 h-[72vh] overflow-auto pr-1">
                  {segments.map((seg) => renderSegment(seg))}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="lg:col-span-1 space-y-3">
              {/* Right-top: Definition-only */}
              <div className="bg-white rounded-2xl shadow-sm border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Definition {focusTerm && (<>
                      · <span className="font-semibold">{focusTerm}</span> <span className="ml-2 text-[11px] px-2 py-0.5 bg-amber-50 border rounded-full">Powered by LLM</span>
                    </>)}
                  </span>
                  {focusTerm && (
                    <div className="flex items-center gap-1">
                      <button className="text-xs px-2 py-1 border rounded-lg hover:bg-gray-50" onClick={() => setFocusTerm(null)}>Clear</button>
                      <button className="text-xs px-2 py-1 border rounded-lg hover:bg-gray-50" onClick={() => fetchLLMDefinition(focusTerm!, true)}>Retry</button>
                      {typeof navigator !== 'undefined' && (navigator as any).clipboard && (
                        <button className="text-xs px-2 py-1 border rounded-lg hover:bg-gray-50" onClick={() => (navigator as any).clipboard.writeText(`${focusTerm}: ${focusDef}`)}>Copy</button>
                      )}
                    </div>
                  )}
                </div>

                {/* Single definition view (or placeholder) */}
                <div className="mt-3">
                  {!focusTerm ? (
                    <div className="text-sm text-gray-500">点击左侧高亮术语查看定义。</div>
                  ) : defLoading ? (
                    <div className="text-sm text-gray-500">正在调用 LLM 生成定义…</div>
                  ) : (
                    <div>
                      {defError && <div className="text-xs text-red-600 mb-2">LLM 错误：{defError}（已回退到启发式定义）</div>}
                      <div className="border rounded-xl p-3">
                        <div className="text-sm leading-relaxed whitespace-pre-wrap">{focusDef}</div>
                      </div>
                      {/* 出现位置 chips (kept) */}
                      <div className="mt-2 text-xs text-gray-500">出现位置：</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(getTermInfo(focusTerm, termMap)?.occurrences || []).map((idx) => (
                          <button key={idx} className="text-[11px] px-2 py-0.5 border rounded-full hover:bg-gray-50" onClick={() => jumpTo(idx)}>
                            #{idx + 1} · {fmtTime(segments[idx]?.t || 0)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right-bottom: RAG Chat */}
              <RAGChat
                currentMeetingId={`meeting_${Date.now()}`}
                onJumpToSegment={jumpTo}
              />

              {/* Dev/Test Panel */}
              <div className="bg-white rounded-2xl shadow-sm border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Dev / Tests</span>
                  <button className="text-sm px-3 py-1.5 border rounded-xl hover:shadow" onClick={runTests}>Run tests</button>
                </div>
                
                {/* RAG Status */}
                <div className="mb-3 p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs font-medium text-gray-700 mb-1">RAG 系统状态:</div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>配置状态:</span>
                      <span className={ragStatus.isConfigured ? 'text-green-600' : 'text-orange-600'}>
                        {ragStatus.isConfigured ? '✓ 已配置' : '⚠️ 未配置'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>向量数量:</span>
                      <span className="font-mono">{ragStatus.vectorCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>处理状态:</span>
                      <span className={ragStatus.isLoading ? 'text-blue-600' : 'text-gray-600'}>
                        {ragStatus.processingMeeting ? `处理中: ${ragStatus.processingMeeting}` : 
                         ragStatus.isLoading ? '加载中...' : '就绪'}
                      </span>
                    </div>
                    {ragStatus.lastError && (
                      <div className="text-red-600 text-xs">
                        错误: {ragStatus.lastError}
                      </div>
                    )}
                  </div>
                </div>

                {tests.length === 0 ? (
                  <p className="text-xs text-gray-500">点击"Run tests"执行 15 个无依赖用例（解析、分词、术语、标注、检索、定义、点击属性、XSS、cap、term-key、CI 查找、roundtrip、cursor、uuid、topTerms）。</p>
                ) : (
                  <div>
                    <div className="text-xs mb-2">Passed {passCount}/{tests.length}</div>
                    <ul className="text-xs space-y-1">
                      {tests.map((t, i) => (
                        <li key={i} className={t.pass ? "text-green-600" : "text-red-600"}>
                          {t.pass ? "✓" : "✗"} {t.name}{t.details ? ` — ${t.details}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Paste Modal */}
          {showPaste && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowPaste(false)} />
              <div className="relative z-10 w-full max-w-2xl bg-white border rounded-2xl shadow-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Paste transcript</div>
                  <button className="text-xs px-2 py-1 border rounded-lg hover:bg-gray-50" onClick={() => setShowPaste(false)}>Close</button>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <button className="text-xs px-2 py-1 border rounded-lg hover:bg-gray-50" onClick={async () => { try { const txt = await (navigator as any)?.clipboard?.readText?.(); if (txt) setPasteDraft(txt); } catch {} }}>Paste from clipboard</button>
                  <span className="text-xs text-gray-500">or paste manually below</span>
                </div>
                <textarea className="w-full h-60 border rounded-xl p-3 font-mono text-xs bg-neutral-50" autoFocus placeholder="在此粘贴 Feishu 转录文本…" value={pasteDraft} onChange={(e) => setPasteDraft(e.target.value)} />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button className="text-sm px-3 py-2 bg-white border rounded-xl hover:shadow" onClick={() => setShowPaste(false)}>Cancel</button>
                  <button className="text-sm px-3 py-2 bg-amber-50 border rounded-xl hover:shadow" onClick={() => { if (pasteDraft.trim().length) setRaw(pasteDraft.trim()); setShowPaste(false); }}>Replace transcript</button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        // ---------------- History Page ----------------
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left: Meeting History */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-sm border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">History — All meetings</div>
                  <div className="flex items-center gap-2">
                    <button className="text-sm px-3 py-2 bg-white border rounded-xl hover:shadow" onClick={() => { if (confirm('Clear all history?')) { setHistory([]); saveHistory([]); } }}>Clear all</button>
                    <button className="text-sm px-3 py-2 bg-amber-50 border rounded-xl hover:shadow" onClick={() => goto('agent')}>New meeting</button>
                  </div>
                </div>

                {/* Search */}
                <HistoryList history={history} onOpen={(m) => { setRaw(m.transcript); goto('agent'); }} onDelete={(id) => { setHistory((prev) => { const list = prev.filter((x) => x.id !== id); saveHistory(list); return list; }); }} />
              </div>
            </div>

            {/* Right: Global RAG Chat */}
            <div className="lg:col-span-1">
              <RAGChat
                currentMeetingId={undefined} // No specific meeting - search across all
                onJumpToSegment={(segmentIndex) => {
                  // For global search, we need to navigate to the specific meeting
                  console.log('Jump to segment across meetings:', segmentIndex);
                }}
                className="h-[60vh]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Footer: hints */}
      <div className="max-w-7xl mx-auto mt-6 text-xs text-gray-500">
        <div className="bg-white border rounded-2xl p-3">
          <div className="font-medium mb-1">Wiring to LLM/RAG later</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>Swap <code>synthesizeDefinition</code> with your server endpoint (Qwen/DeepSeek/etc.). Cache responses by <code>term</code> and <code>meeting_id</code>.</li>
            <li>Include citations: map <code>TermInfo.occurrences</code> to original segments and attach source anchors.</li>
            <li>Optionally add a "promote to glossary" button to persist curated definitions to your org wiki.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// History List Component
// -----------------------------

function HistoryList({ history, onOpen, onDelete }: { history: Meeting[]; onOpen: (m: Meeting) => void; onDelete: (id: string) => void; }) {
  const [q, setQ] = useState("");
  const [filtered, setFiltered] = useState<Meeting[]>(history);
  const { indexMeeting, status: ragStatus } = useRAG();
  const [indexingStatus, setIndexingStatus] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (!term) { setFiltered(history); return; }
    setFiltered(history.filter((m) => {
      const hay = (m.title + "\n" + m.participants.join(" ") + "\n" + m.topTerms.join(" ")).toLowerCase();
      return hay.includes(term);
    }));
  }, [q, history]);

  const indexAllMeetings = async () => {
    for (const meeting of history) {
      if (indexingStatus[meeting.id]) continue; // Skip if already indexing
      
      setIndexingStatus(prev => ({ ...prev, [meeting.id]: true }));
      
      try {
        // Parse transcript to get segments
        const segments = parseTranscript(meeting.transcript);
        await indexMeeting(meeting.id, segments);
      } catch (error) {
        console.error(`Failed to index meeting ${meeting.id}:`, error);
      }
      
      setIndexingStatus(prev => ({ ...prev, [meeting.id]: false }));
    }
  };

  return (
    <div>
      <div className="mt-2 mb-3 flex items-center gap-2">
        <input className="flex-1 border rounded-xl px-3 py-2 text-sm" placeholder="搜索标题 / 参会人 / 术语…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-gray-500">{filtered.length}/{history.length}</span>
        {ragStatus.isConfigured && (
          <button
            onClick={indexAllMeetings}
            disabled={Object.values(indexingStatus).some(Boolean) || ragStatus.isLoading}
            className="px-3 py-2 text-sm bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50"
          >
            {Object.values(indexingStatus).some(Boolean) ? '🔄 索引中...' : '🤖 索引全部'}
          </button>
        )}
      </div>

      {ragStatus.isConfigured && ragStatus.vectorCount > 0 && (
        <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="text-sm text-blue-800">
            🤖 RAG 系统已就绪！已索引 <strong>{ragStatus.vectorCount}</strong> 个片段，可进行跨会议智能搜索。
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-sm text-gray-500">暂无历史数据。点击右上角 New meeting，或在 Agent 页点击 “Save to history”。</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((m) => (
            <div key={m.id} className="border rounded-2xl p-3 bg-white">
              <div className="flex items-center justify-between">
                <div className="font-medium truncate pr-4">{m.title}</div>
                <span className="text-xs text-gray-500">{fmtDate(m.createdAt)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">{m.participants.length ? `参会人：${m.participants.join(', ')}` : '参会人：未识别'}</div>
              <div className="mt-1 text-xs text-gray-500">时长：{fmtTime(m.durationSec)}</div>
              {m.topTerms.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.topTerms.map((t) => (
                    <span key={t} className="text-[11px] px-2 py-0.5 border rounded-full bg-amber-50/40">{t}</span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button className="text-sm px-3 py-1.5 border rounded-xl hover:bg-gray-50" onClick={() => onOpen(m)}>Open</button>
                <button className="text-sm px-3 py-1.5 border rounded-xl hover:bg-red-50" onClick={() => onDelete(m.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
