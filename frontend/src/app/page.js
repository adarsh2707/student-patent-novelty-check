"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Footer from "../components/Footer";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const PINNED_HISTORY_KEY = "spnc_pinned_history_ids";

/* ----------------- helpers ----------------- */
function pct(score) {
  const p = Math.round((score || 0) * 100);
  return Math.max(0, Math.min(100, p));
}

function apiUrl(path) {
  const clean = (path || "").startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${clean}`;
}

function patentUrl(pub) {
  const clean = (pub || "").trim();
  if (!clean) return null;
  return `https://patents.google.com/patent/${encodeURIComponent(clean)}`;
}

function confidenceLabel(p) {
  if (p >= 75) {
    return {
      label: "High confidence",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      dot: "bg-emerald-500",
      expl: "Very similar wording + concepts in title/abstract, with stronger overall support.",
    };
  }
  if (p >= 55) {
    return {
      label: "Medium confidence",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      dot: "bg-amber-500",
      expl: "Some overlap in the core idea. Worth checking claims and summary support.",
    };
  }
  return {
    label: "Low confidence",
    tone: "border-slate-200 bg-slate-50 text-slate-700",
    dot: "bg-slate-400",
    expl: "Weaker overlap. Could still matter if claims or summary contain your mechanism.",
  };
}

function modePill(mode) {
  const m = (mode || "").toLowerCase();
  if (m.includes("live") || m.includes("patentsview")) {
    return { label: "LIVE", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (m.includes("error")) {
    return { label: "ERROR", tone: "border-rose-200 bg-rose-50 text-rose-700" };
  }
  if (m.includes("mock")) {
    return { label: "MOCK", tone: "border-slate-200 bg-slate-50 text-slate-700" };
  }
  return { label: "MODE", tone: "border-slate-200 bg-slate-50 text-slate-700" };
}

function getCpcMatchMeta(score) {
  const s = Number(score || 0);

  if (s >= 0.88) {
    return {
      label: "Strong CPC match",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }

  if (s >= 0.68) {
    return {
      label: "Related CPC match",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    };
  }

  if (s >= 0.42) {
    return {
      label: "Broad CPC match",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  return {
    label: "Weak CPC match",
    tone: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

function fmtPct01(score) {
  const n = Number(score || 0);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function splitCsvOrLines(s) {
  return (s || "")
    .split(/[\n,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitCommaList(s) {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function truncateText(s, n = 180) {
  const t = (s || "").trim();
  if (!t) return "";
  if (t.length <= n) return t;
  return `${t.slice(0, n).trim()}…`;
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function readPinnedHistoryIds() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_HISTORY_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map((x) => Number(x)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function writePinnedHistoryIds(ids) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_HISTORY_KEY, JSON.stringify(ids));
  } catch {}
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return res;
}

async function pollSearchJob(
  jobId,
  {
    maxMs = 120000,
    intervalMs = 1200,
    onUpdate = () => {},
  } = {}
) {
  const started = Date.now();

  while (Date.now() - started < maxMs) {
    const statusRes = await fetchJson(apiUrl(`/search/jobs/${jobId}`));

    if (!statusRes.ok) {
      const txt = await statusRes.text();
      throw new Error(`Failed to read job status: ${txt || statusRes.status}`);
    }

    const statusData = await statusRes.json();

    onUpdate(statusData);

    if (statusData.status === "completed") {
      const resultRes = await fetchJson(apiUrl(`/search/jobs/${jobId}/result`));

      if (!resultRes.ok) {
        const txt = await resultRes.text();
        throw new Error(`Failed to fetch job result: ${txt || resultRes.status}`);
      }

      const resultData = await resultRes.json();
      return resultData.result;
    }

    if (statusData.status === "failed") {
      throw new Error(statusData.error || "Search job failed");
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("Search timed out. Please try again.");
}

function normalizePatent(patent) {
  const sectionHits = patent?.section_hits || {};
  const matchedSections = Object.keys(sectionHits).filter((k) => Array.isArray(sectionHits[k]) && sectionHits[k].length > 0);

  const matchedKeywords = [];
  const claimSupportList = Array.isArray(patent?.claim_support) ? patent.claim_support : [];

  let claimSupport = "None";
  if (claimSupportList.length >= 2) claimSupport = "Strong";
  else if (claimSupportList.length === 1) claimSupport = "Moderate";

  return {
    ...patent,
    matched_sections: matchedSections,
    matched_keywords: matchedKeywords,
    confidence_explanation: patent?.why_similar || [],
    claim_support_level: claimSupport,
    claim_support_list: claimSupportList,
  };
}

/* ----------------- highlighting ----------------- */
function escapeRegExp(str) {
  return (str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightNodes(text, terms) {
  const t = (text || "").toString();
  const cleanTerms = (terms || []).map((x) => (x || "").trim()).filter(Boolean);
  if (!t || cleanTerms.length === 0) return t;

  const sorted = [...cleanTerms].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${sorted.map(escapeRegExp).join("|")})`, "gi");
  const parts = t.split(re);

  return parts.map((p, i) => {
    const isHit = sorted.some((term) => term.toLowerCase() === (p || "").toLowerCase());
    if (!isHit) return <span key={i}>{p}</span>;
    return (
      <mark
        key={i}
        className="rounded-md px-1 py-0.5 bg-fuchsia-100 text-slate-900 border border-fuchsia-200"
      >
        {p}
      </mark>
    );
  });
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightTermsHtml(text, terms) {
  let out = escapeHtml(text || "");
  const uniq = [...new Set((terms || []).map((t) => (t || "").trim()).filter(Boolean))];
  uniq
    .sort((a, b) => b.length - a.length)
    .forEach((term) => {
      const safe = escapeRegExp(term);
      out = out.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
    });
  return out;
}

/* ----------------- CPC hierarchy helpers ----------------- */
function normCpc(code) {
  return (code || "").toString().trim().toUpperCase().replace(/\s+/g, "");
}

function getSection(code) {
  const c = normCpc(code);
  return c ? c[0] : "";
}

function getClass(code) {
  const c = normCpc(code);
  return c.length >= 3 ? c.slice(0, 3) : "";
}

function getSubclass(code) {
  const c = normCpc(code);
  return c.length >= 4 ? c.slice(0, 4) : "";
}

function parseSlash(code) {
  const c = normCpc(code);
  const idx = c.indexOf("/");
  if (idx === -1) return { hasSlash: false, before: c, after: "" };
  return { hasSlash: true, before: c.slice(0, idx), after: c.slice(idx + 1) };
}

function isGroup(code) {
  const c = normCpc(code);
  const { hasSlash, after } = parseSlash(c);
  if (!hasSlash) return false;
  return after.length === 2;
}

function isSubgroup(code) {
  const c = normCpc(code);
  const { hasSlash, after } = parseSlash(c);
  if (!hasSlash) return false;
  return after.length > 2;
}

function groupPrefix(groupCode) {
  const c = normCpc(groupCode);
  const idx = c.indexOf("/");
  if (idx === -1) return c;
  return c.slice(0, idx + 1);
}

function sectionLabel(sec) {
  const map = {
    A: "A — Human necessities",
    B: "B — Performing operations; Transporting",
    C: "C — Chemistry; Metallurgy",
    D: "D — Textiles; Paper",
    E: "E — Fixed constructions",
    F: "F — Mechanical engineering; Lighting; Heating; Weapons; Blasting",
    G: "G — Physics",
    H: "H — Electricity",
    Y: "Y — Emerging cross-sectional technologies",
  };
  return map[sec] || (sec ? `Section ${sec}` : "All sections");
}

/* ----------------- theme helpers ----------------- */
function softShadow() {
  return "shadow-[0_10px_35px_-18px_rgba(2,6,23,0.25)]";
}

function glassCard() {
  return [
    "rounded-3xl border border-white/40 bg-white/65 backdrop-blur-xl",
    "shadow-[0_10px_40px_-22px_rgba(2,6,23,0.35)]",
  ].join(" ");
}

function GlowLine() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-300/70 to-transparent" />
  );
}

function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-600 mt-1">{subtitle}</p>}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

/* ----------------- UI bits ----------------- */
function Chip({ children, tone = "default" }) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm transition";
  const tones = {
    default: "border-slate-200 bg-white/80 text-slate-700 hover:bg-white",
    brand: "border-fuchsia-200 bg-fuchsia-50/70 text-fuchsia-800",
    aqua: "border-cyan-200 bg-cyan-50/70 text-cyan-800",
    lime: "border-lime-200 bg-lime-50/70 text-lime-800",
  };
  return <span className={`${base} ${tones[tone] || tones.default}`}>{children}</span>;
}

function TogglePill({ label, checked, onChange, helper }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={[
        "group w-full flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left transition",
        checked
          ? "border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 to-cyan-50 text-slate-900 shadow-sm"
          : "border-slate-200 bg-white/80 text-slate-700 hover:bg-white",
      ].join(" ")}
      aria-pressed={checked}
      title={helper || ""}
    >
      <div className="min-w-0">
        <div className="font-semibold text-sm">{label}</div>
        {helper ? <div className="text-[11px] text-slate-500 truncate">{helper}</div> : null}
      </div>

      <span
        className={[
          "h-5 w-5 rounded-xl border transition grid place-items-center flex-shrink-0",
          checked ? "border-fuchsia-200 bg-white" : "border-slate-200 bg-white",
        ].join(" ")}
      >
        <span
          className={[
            "h-2.5 w-2.5 rounded-full transition",
            checked ? "bg-gradient-to-r from-fuchsia-500 to-cyan-500" : "bg-slate-200",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className={`${glassCard()} p-5 animate-pulse`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="h-5 w-3/4 bg-slate-200/70 rounded mb-2" />
          <div className="h-4 w-1/2 bg-slate-200/70 rounded mb-3" />
          <div className="flex gap-2">
            <div className="h-6 w-28 bg-slate-200/70 rounded-full" />
            <div className="h-6 w-20 bg-slate-200/70 rounded-full" />
          </div>
        </div>
        <div className="w-40">
          <div className="h-3 w-24 bg-slate-200/70 rounded mb-2" />
          <div className="h-7 w-16 bg-slate-200/70 rounded mb-3" />
          <div className="h-2 w-full bg-slate-200/70 rounded-full" />
        </div>
      </div>
      <div className="mt-4">
        <div className="h-4 w-40 bg-slate-200/70 rounded mb-2" />
        <div className="h-3 w-full bg-slate-200/70 rounded mb-2" />
        <div className="h-3 w-5/6 bg-slate-200/70 rounded mb-2" />
        <div className="h-3 w-2/3 bg-slate-200/70 rounded" />
      </div>
    </div>
  );
}

function SummaryLine({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <span className="text-xs text-slate-800 text-right">{value}</span>
    </div>
  );
}

/* ----------------- suggestions ----------------- */
const SUGGESTIONS = [
  {
    label: "Wearable HF early-warning",
    text: "Wearable + smartphone system to reduce heart-failure readmissions using continuous vitals monitoring and early-warning ML.",
    tone: "brand",
  },
  {
    label: "Student study helper",
    text: "AI assistant that helps students plan assignments and study schedules by parsing syllabi, deadlines, and course materials.",
    tone: "aqua",
  },
  {
    label: "Drone crop health",
    text: "Drone-based crop health monitoring using multispectral imaging to detect disease early across large fields.",
    tone: "lime",
  },
  {
    label: "Factory defect vision",
    text: "Computer vision system for detecting manufacturing defects on a conveyor belt with real-time alerts and explainability.",
    tone: "brand",
  },
];

/* ----------------- Search Overlay ----------------- */
function SearchOverlay({ open, onClose, value, setValue, onRun, suggestions = [], isLoading }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
    }, 40);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onMouseDown={onClose} />

      <div className="absolute inset-x-0 top-16 sm:top-20 mx-auto w-[92%] max-w-2xl">
        <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-slate-950/40 backdrop-blur-xl shadow-[0_30px_120px_-40px_rgba(0,0,0,0.7)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-300/70 to-transparent" />
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-white/70">
                Search • <span className="text-white/50">Press Enter to run • Esc to close</span>
              </div>
              <div className="text-[11px] font-semibold text-white/60 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                Ctrl/Cmd + K
              </div>
            </div>

            <div className="mt-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 text-sm">⌕</span>
                <input
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onRun();
                    }
                  }}
                  placeholder="Describe your idea…"
                  className={[
                    "w-full rounded-2xl border border-white/15 bg-white/10 text-white/90",
                    "pl-9 pr-24 py-3 text-sm outline-none",
                    "focus:ring-2 focus:ring-fuchsia-400/40",
                  ].join(" ")}
                />

                <button
                  type="button"
                  onClick={onRun}
                  disabled={isLoading || (value || "").trim().length < 10}
                  className={[
                    "absolute right-2 top-1/2 -translate-y-1/2 rounded-2xl px-4 py-2 text-sm font-semibold text-white transition",
                    isLoading || (value || "").trim().length < 10
                      ? "bg-white/15 cursor-not-allowed"
                      : "bg-gradient-to-r from-fuchsia-600 to-cyan-500 hover:from-fuchsia-500 hover:to-cyan-400",
                    "shadow-[0_14px_40px_-18px_rgba(236,72,153,0.55)]",
                  ].join(" ")}
                >
                  {isLoading ? "Searching…" : "Search"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-white/70 mb-2">Try an example</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setValue(s.text)}
                    className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 hover:bg-white/15"
                    title="Click to fill"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 text-[11px] text-white/55">Tip: fill a suggestion → tweak → press Enter.</div>
            </div>
          </div>

          <div className="h-10 bg-gradient-to-r from-fuchsia-500/10 via-cyan-400/10 to-lime-400/10" />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const formRef = useRef(null);

  const [problem, setProblem] = useState("");
  const [whatItDoes, setWhatItDoes] = useState([]);
  const [domain, setDomain] = useState("Software");
  const [technologies, setTechnologies] = useState([]);
  const [novelty, setNovelty] = useState("");
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStage, setJobStage] = useState("");

  const [keywords, setKeywords] = useState("");
  const [excludeKeywords, setExcludeKeywords] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [maxResults, setMaxResults] = useState(10);

  const [searchHistory, setSearchHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [historyReplayMode, setHistoryReplayMode] = useState("edit");
  const [pinnedHistoryIds, setPinnedHistoryIds] = useState([]);

  const [sectionKeywords, setSectionKeywords] = useState("");
  const [sectionScopes, setSectionScopes] = useState(["abstract", "claims"]);

  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [inputSummary, setInputSummary] = useState("");
  const [cpcUsed, setCpcUsed] = useState([]);
  const [backendMode, setBackendMode] = useState("");
  const [openWhy, setOpenWhy] = useState({});
  const [openAbstract, setOpenAbstract] = useState({});
  const [cpcStats, setCpcStats] = useState({});
  const [cpcHumanMap, setCpcHumanMap] = useState({});
  const [openEvidence, setOpenEvidence] = useState({});

  const [lastIdea, setLastIdea] = useState(null);
  const [lastCpcSuggestions, setLastCpcSuggestions] = useState([]);

  const [hasSearched, setHasSearched] = useState(false);
  const [stickyQuery, setStickyQuery] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayQuery, setOverlayQuery] = useState("");

  const [sortBy, setSortBy] = useState("relevance");
  const [minSim, setMinSim] = useState(0);
  const [showAbstractPreview, setShowAbstractPreview] = useState(true);

  const [showAdvanced, setShowAdvanced] = useState(true);
  const [feedback, setFeedback] = useState({});

  const [selSection, setSelSection] = useState("");
  const [selClass, setSelClass] = useState("");
  const [selSubclass, setSelSubclass] = useState("");
  const [selGroup, setSelGroup] = useState("");
  const [selSubgroup, setSelSubgroup] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    setPinnedHistoryIds(readPinnedHistoryIds());
  }, []);

  useEffect(() => {
    writePinnedHistoryIds(pinnedHistoryIds);
  }, [pinnedHistoryIds]);

  useEffect(() => {
    const onKey = (e) => {
      const isK = (e.key || "").toLowerCase() === "k";
      const metaOrCtrl = e.metaKey || e.ctrlKey;
      if (metaOrCtrl && isK) {
        e.preventDefault();
        setOverlayQuery((stickyQuery || problem || "").trim());
        setOverlayOpen(true);
      }
      if (!metaOrCtrl && e.key === "/" && !overlayOpen) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        setOverlayQuery((stickyQuery || problem || "").trim());
        setOverlayOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [problem, stickyQuery, overlayOpen]);

  const canSubmit = useMemo(() => problem.trim().length >= 10, [problem]);

  const normalizedResults = useMemo(() => (results || []).map(normalizePatent), [results]);

  const visibleResults = useMemo(() => {
    const filtered = normalizedResults.filter((r) => pct(r.similarity_score) >= Number(minSim || 0));
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "newest") return (b.year || 0) - (a.year || 0);
      if (sortBy === "oldest") return (a.year || 0) - (b.year || 0);
      return (b.similarity_score || 0) - (a.similarity_score || 0);
    });
    return sorted;
  }, [normalizedResults, sortBy, minSim]);

  const sortedHistory = useMemo(() => {
    const pinnedSet = new Set((pinnedHistoryIds || []).map(Number));
    return [...searchHistory].sort((a, b) => {
      const aPinned = pinnedSet.has(Number(a.id)) ? 1 : 0;
      const bPinned = pinnedSet.has(Number(b.id)) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return Number(b.id || 0) - Number(a.id || 0);
    });
  }, [searchHistory, pinnedHistoryIds]);

  const scrollToForm = () => {
    if (!formRef.current) return;
    formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const makeSearchSummaryText = () => {
    const kw = splitCsvOrLines(keywords).slice(0, 12).join(", ");
    const ex = splitCsvOrLines(excludeKeywords).slice(0, 12).join(", ");
    const tech = (technologies || []).join(", ");
    const does = (whatItDoes || []).join(", ");
    const filter = selSubgroup || selGroup || selSubclass || "";
    const secK = splitCsvOrLines(sectionKeywords).slice(0, 12).join(", ");
    const scopes = (sectionScopes || []).join(", ");

    return [
      `Problem: ${problem.trim()}`,
      does ? `What it does: ${does}` : null,
      novelty.trim() ? `Novelty: ${novelty.trim()}` : null,
      tech ? `Technologies: ${tech}` : null,
      domain ? `Domain: ${domain}` : null,
      kw ? `Keywords: ${kw}` : null,
      ex ? `Exclude: ${ex}` : null,
      secK ? `Section keywords: ${secK}` : null,
      secK ? `Section scopes: ${scopes}` : null,
      assigneeFilter.trim() ? `Assignee: ${assigneeFilter.trim()}` : null,
      yearFrom ? `Year from: ${yearFrom}` : null,
      yearTo ? `Year to: ${yearTo}` : null,
      backendMode ? `Mode: ${backendMode}` : null,
      filter ? `CPC refine filter: ${filter}` : null,
      `API_BASE: ${API_BASE}`,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(makeSearchSummaryText());
    } catch {}
  };

  const downloadResultsReport = async () => {
    try {
      setIsDownloading(true);

      const activeResults = visibleResults || [];
      const title = `Patent_Novelty_Report_${new Date().toISOString().slice(0, 10)}`;

      const querySummary = {
        problem,
        whatItDoes,
        domain,
        technologies,
        novelty,
        keywords: splitCsvOrLines(keywords),
        excludeKeywords: splitCsvOrLines(excludeKeywords),
        sectionKeywords: splitCsvOrLines(sectionKeywords),
        sectionScopes,
        assigneeFilter,
        yearFrom,
        yearTo,
        backendMode,
        totalResults: activeResults.length,
      };

      const cardsHtml = activeResults
        .map((patent, idx) => {
          const p = pct(patent.similarity_score);
          const terms = splitCsvOrLines(sectionKeywords);
          const abstractHtml = patent.abstract_snippet
            ? highlightTermsHtml(patent.abstract_snippet, terms)
            : "";
          const summaryHtml = patent.summary_snippet
            ? highlightTermsHtml(patent.summary_snippet, terms)
            : "";
          const claimHtml = patent.claim_excerpt
            ? highlightTermsHtml(patent.claim_excerpt, terms)
            : "";

          return `
            <section class="card">
              <div class="rank">#${idx + 1}</div>
              <h2>${escapeHtml(patent.title || "")}</h2>
              <div class="meta">
                <span>${escapeHtml(patent.publication_number || "")}</span>
                <span>${escapeHtml(String(patent.year || ""))}</span>
                <span>${escapeHtml(patent.assignee || "")}</span>
                <span>${escapeHtml(patent.cpc_label || "")}</span>
                <span>${p}% similarity</span>
              </div>

              ${patent.cpc_human ? `<div class="pill">${escapeHtml(patent.cpc_human)}</div>` : ""}

              <div class="block">
                <h3>Section evidence</h3>
                <p>${escapeHtml((patent.matched_sections || []).join(", ") || "None")}</p>
              </div>

              ${
                (patent.confidence_explanation || []).length
                  ? `<div class="block">
                      <h3>Why similar</h3>
                      <ul>${patent.confidence_explanation.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
                    </div>`
                  : ""
              }

              ${abstractHtml ? `<div class="block"><h3>Abstract</h3><p>${abstractHtml}</p></div>` : ""}
              ${summaryHtml ? `<div class="block"><h3>Brief summary</h3><p>${summaryHtml}</p></div>` : ""}
              ${claimHtml ? `<div class="block"><h3>Claims support</h3><p>${claimHtml}</p></div>` : ""}

              ${
                patent.google_patents_url
                  ? `<div class="block"><a href="${escapeHtml(
                      patent.google_patents_url
                    )}" target="_blank">Open in Google Patents</a></div>`
                  : ""
              }
            </section>
          `;
        })
        .join("");

      const html = `
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8" />
          <title>${title}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 32px;
              color: #1f2937;
              background: #f8fafc;
            }
            h1 { margin-bottom: 8px; }
            .sub { color: #475569; margin-bottom: 20px; }
            .summary, .card {
              background: white;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 18px;
              margin-bottom: 18px;
            }
            .meta {
              display: flex;
              flex-wrap: wrap;
              gap: 10px;
              font-size: 13px;
              color: #475569;
              margin-bottom: 12px;
            }
            .rank {
              display: inline-block;
              background: #eef2ff;
              color: #4338ca;
              font-weight: 700;
              border-radius: 999px;
              padding: 4px 10px;
              margin-bottom: 10px;
            }
            .pill {
              display: inline-block;
              background: #ecfeff;
              border: 1px solid #a5f3fc;
              color: #155e75;
              border-radius: 999px;
              padding: 4px 10px;
              font-size: 12px;
              margin-bottom: 12px;
            }
            .block {
              margin-top: 14px;
            }
            .block h3 {
              margin: 0 0 6px 0;
              font-size: 14px;
            }
            .block p, li {
              font-size: 13px;
              line-height: 1.5;
            }
            mark {
              background: #fde68a;
              padding: 0 2px;
              border-radius: 3px;
            }
            a { color: #2563eb; }
          </style>
        </head>
        <body>
          <h1>Patent Novelty Check Report</h1>
          <div class="sub">Generated on ${new Date().toLocaleString()}</div>

          <section class="summary">
            <h2>Search summary</h2>
            <p><b>Problem:</b> ${escapeHtml(querySummary.problem || "")}</p>
            <p><b>What it does:</b> ${escapeHtml((querySummary.whatItDoes || []).join(", "))}</p>
            <p><b>Domain:</b> ${escapeHtml(querySummary.domain || "")}</p>
            <p><b>Technologies:</b> ${escapeHtml((querySummary.technologies || []).join(", "))}</p>
            <p><b>Novelty:</b> ${escapeHtml(querySummary.novelty || "")}</p>
            <p><b>Keywords:</b> ${escapeHtml((querySummary.keywords || []).join(", "))}</p>
            <p><b>Exclude:</b> ${escapeHtml((querySummary.excludeKeywords || []).join(", "))}</p>
            <p><b>Section keywords:</b> ${escapeHtml((querySummary.sectionKeywords || []).join(", "))}</p>
            <p><b>Section scopes:</b> ${escapeHtml((querySummary.sectionScopes || []).join(", "))}</p>
            <p><b>Assignee:</b> ${escapeHtml(querySummary.assigneeFilter || "")}</p>
            <p><b>Year range:</b> ${escapeHtml(
              `${querySummary.yearFrom || ""}${querySummary.yearFrom || querySummary.yearTo ? " - " : ""}${querySummary.yearTo || ""}`
            )}</p>
            <p><b>Mode:</b> ${escapeHtml(querySummary.backendMode || "")}</p>
            <p><b>Total visible results:</b> ${activeResults.length}</p>
          </section>

          ${cardsHtml || "<p>No results available to export.</p>"}
        </body>
        </html>
      `;

      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

  const buildIdeaFromState = (overrideProblem) => {
    return {
      problem: (overrideProblem ?? problem).trim(),
      what_it_does: whatItDoes,
      domain,
      technologies,
      novelty: novelty.trim() || undefined,
      keywords: splitCsvOrLines(keywords),
      exclude_keywords: splitCsvOrLines(excludeKeywords),
      assignee_filter: assigneeFilter.trim() || undefined,
      year_from: yearFrom ? Number(yearFrom) : undefined,
      year_to: yearTo ? Number(yearTo) : undefined,
      max_results: Number(maxResults) || 10,
      section_scopes: sectionScopes,
      section_keywords: splitCsvOrLines(sectionKeywords),
    };
  };

  const applySearchDataToState = (searchData, { markSearched = false } = {}) => {
    setInputSummary(searchData.input_summary || "");
    setCpcUsed(searchData.cpc_used || []);
    setBackendMode(searchData.backend_mode || "");
    setResults(searchData.results || []);
    setCpcStats(searchData.cpc_stats || {});
    setCpcHumanMap(searchData.cpc_human_map || {});

    if (markSearched) {
      setHasSearched(true);
    }

    if (searchData.results?.[0]) {
      const k = `${searchData.results[0].publication_number}-0`;
      setOpenWhy((prev) => ({ ...prev, [k]: true }));
    }
  };

  const resetCpcDropdown = () => {
    setSelSection("");
    setSelClass("");
    setSelSubclass("");
    setSelGroup("");
    setSelSubgroup("");
  };

  const applyHistoryDetailToInputs = (detail) => {
    const nextProblem = detail?.problem_preview || "";
    const nextDomain = detail?.domain || "Software";
    const nextTechnologies = splitCommaList(detail?.technologies || "");
    const nextNovelty = detail?.novelty_preview || "";

    setProblem(nextProblem);
    setStickyQuery(nextProblem);
    setOverlayQuery(nextProblem);
    setDomain(nextDomain || "Software");
    setTechnologies(nextTechnologies);
    setNovelty(nextNovelty);

    return {
      problem: nextProblem,
      domain: nextDomain || "Software",
      technologies: nextTechnologies,
      novelty: nextNovelty,
      what_it_does: whatItDoes,
      keywords: splitCsvOrLines(keywords),
      exclude_keywords: splitCsvOrLines(excludeKeywords),
      assignee_filter: assigneeFilter.trim() || undefined,
      year_from: yearFrom ? Number(yearFrom) : undefined,
      year_to: yearTo ? Number(yearTo) : undefined,
      max_results: Number(maxResults) || 10,
      section_scopes: sectionScopes,
      section_keywords: splitCsvOrLines(sectionKeywords),
    };
  };

  const togglePinnedHistory = (historyId) => {
    const idNum = Number(historyId);
    setPinnedHistoryIds((prev) => {
      const has = prev.includes(idNum);
      return has ? prev.filter((x) => x !== idNum) : [idNum, ...prev];
    });
  };

  const runFullSearch = async (idea) => {
	  setIsLoading(true);
	  setError(null);
	  setResults([]);
	  setInputSummary("");
	  setCpcUsed([]);
	  setBackendMode("");
	  setOpenWhy({});
	  setOpenAbstract({});
	  setCpcStats({});
	  setCpcHumanMap({});
	  setOpenEvidence({});
	  resetCpcDropdown();

	  setJobId(null);
	  setJobStatus("starting");
	  setJobProgress(0);
	  setJobStage("Preparing search...");

	  try {
		const parseRes = await postJson(apiUrl("/parse-input"), idea);
		if (!parseRes.ok) throw new Error(`Parse input failed (${parseRes.status})`);

		const parseData = await parseRes.json();
		const cpcSuggestions = parseData.cpc_suggestions || [];

		setLastIdea(idea);
		setLastCpcSuggestions(cpcSuggestions);

		const jobRes = await postJson(apiUrl("/search/jobs"), {
		  idea,
		  cpc_suggestions: cpcSuggestions,
		  cpc_filters: [],
		});

		if (!jobRes.ok) {
		  const txt = await jobRes.text();
		  throw new Error(`Search queue failed: ${txt}`);
		}

		const jobData = await jobRes.json();

		setJobId(jobData.job_id);
		setJobStatus(jobData.status || "queued");
		setJobProgress(0);
		setJobStage("Queued");

		const searchData = await pollSearchJob(jobData.job_id, {
		  onUpdate: (statusData) => {
			setJobStatus(statusData.status || "");
			setJobProgress(Number(statusData.progress || 0));
			setJobStage(statusData.stage || "");
		  },
		});

		applySearchDataToState(searchData, { markSearched: true });

		setJobStatus("completed");
		setJobProgress(100);
		setJobStage("Completed");

		if (currentUser) {
		  await loadSearchHistory();
		}
	  } catch (err) {
		console.error(err);
		setError(err?.message || "Something went wrong talking to the backend.");
		setJobStatus("failed");
		setJobStage(err?.message || "Search failed");
	  } finally {
		setIsLoading(false);
	  }
  };

  const runSearchWithCpcFilter = async (cpcFilter) => {
	  if (!lastIdea || isLoading) return;

	  const filter = normCpc(cpcFilter);
	  const filters = filter ? [filter] : [];

	  setIsLoading(true);
	  setError(null);
	  setResults([]);
	  setOpenWhy({});
	  setOpenAbstract({});
	  setOpenEvidence({});

	  setJobId(null);
	  setJobStatus("starting");
	  setJobProgress(0);
	  setJobStage("Preparing filtered search...");

	  try {
		const jobRes = await postJson(apiUrl("/search/jobs"), {
		  idea: lastIdea,
		  cpc_suggestions: lastCpcSuggestions,
		  cpc_filters: filters,
		});

		if (!jobRes.ok) {
		  const txt = await jobRes.text();
		  throw new Error(`Search queue failed: ${txt}`);
		}

		const jobData = await jobRes.json();

		setJobId(jobData.job_id);
		setJobStatus(jobData.status || "queued");
		setJobProgress(0);
		setJobStage("Queued");

		const searchData = await pollSearchJob(jobData.job_id, {
		  onUpdate: (statusData) => {
			setJobStatus(statusData.status || "");
			setJobProgress(Number(statusData.progress || 0));
			setJobStage(statusData.stage || "");
		  },
		});

		applySearchDataToState(searchData);

		setJobStatus("completed");
		setJobProgress(100);
		setJobStage("Completed");
	  } catch (err) {
		console.error(err);
		setError(err?.message || "Something went wrong talking to the backend.");
		setJobStatus("failed");
		setJobStage(err?.message || "Filtered search failed");
	  } finally {
		setIsLoading(false);
	  }
  };

  const runOverlay = async () => {
    if (authRequired && !currentUser) {
      setError("Please login before running a search.");
      return;
    }

    const q = (overlayQuery || "").trim();
    if (q.length < 10) return;
    setOverlayOpen(false);
    setProblem(q);
    setStickyQuery(q);
    const idea = buildIdeaFromState(q);
    await runFullSearch(idea);
  };
  const handleSubmit = async (e) => {
	  e.preventDefault();

	  if (!currentUser) {
		setError("Please login before running a search.");
		return;
	  }

	  const idea = buildIdeaFromState();
	  if (!idea.problem || idea.problem.length < 10) return;

	  setStickyQuery(idea.problem);
	  setOverlayQuery(idea.problem);

	  await runFullSearch(idea);
  };
  
  const runSticky = async () => {
	  if (authRequired && !currentUser) {
		setError("Please login before running a search.");
		return;
	  }

	  const q = (stickyQuery || "").trim();
	  if (q.length < 10) return;

	  setProblem(q);
	  const idea = buildIdeaFromState(q);
	  await runFullSearch(idea);
  };

  const useSuggestion = async (text, autoRun = true) => {
    setProblem(text);
    setStickyQuery(text);
    setOverlayQuery(text);
    if (autoRun && text.trim().length >= 10) {
      const idea = buildIdeaFromState(text);
      await runFullSearch(idea);
      return;
    }
    scrollToForm();
  };

  const setVote = (key, vote) => {
    setFeedback((prev) => ({
      ...prev,
      [key]: {
        vote,
        comment: prev[key]?.comment || "",
        submitted: false,
        status: prev[key]?.status || "",
      },
    }));
  };

  const setComment = (key, comment) => {
    setFeedback((prev) => ({
      ...prev,
      [key]: {
        vote: prev[key]?.vote || null,
        comment,
        submitted: prev[key]?.submitted || false,
        status: prev[key]?.status || "",
      },
    }));
  };

  const submitFeedback = async (key, patent) => {
    const fb = feedback[key];
    if (!fb?.vote) return;

    setFeedback((prev) => ({
      ...prev,
      [key]: { ...prev[key], status: "Saving..." },
    }));

    try {
      const res = await postJson(apiUrl("/feedback"), {
        idea_problem: (lastIdea?.problem || problem || "").trim(),
        idea_domain: domain,
        cpc_used: cpcUsed,
        publication_number: patent.publication_number,
        patent_title: patent.title,
        vote: fb.vote,
        comment: fb.comment || "",
      });

      if (!res.ok) throw new Error(`Feedback endpoint not available (${res.status})`);

      setFeedback((prev) => ({
        ...prev,
        [key]: { ...prev[key], submitted: true, status: "Saved ✅" },
      }));
    } catch {
      setFeedback((prev) => ({
        ...prev,
        [key]: { ...prev[key], submitted: true, status: "Saved locally ✅ (backend not enabled)" },
      }));
    }
  };

  const cpcEntries = useMemo(() => {
    const entries = Object.entries(cpcStats || {});
    return entries
      .map(([k, v]) => [normCpc(k), Number(v || 0)])
      .filter(([k, v]) => k && v > 0);
  }, [cpcStats]);

  const sectionOptions = useMemo(() => {
    const agg = {};
    for (const [code, count] of cpcEntries) {
      const sec = getSection(code);
      if (!sec) continue;
      agg[sec] = (agg[sec] || 0) + count;
    }
    return Object.entries(agg).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [cpcEntries]);

  const classOptions = useMemo(() => {
    if (!selSection) return [];
    const agg = {};
    for (const [code, count] of cpcEntries) {
      if (getSection(code) !== selSection) continue;
      const cls = getClass(code);
      if (!cls) continue;
      agg[cls] = (agg[cls] || 0) + count;
    }
    return Object.entries(agg).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [cpcEntries, selSection]);

  const subclassOptions = useMemo(() => {
    if (!selClass) return [];
    const agg = {};
    for (const [code, count] of cpcEntries) {
      if (getClass(code) !== selClass) continue;
      const sc = getSubclass(code);
      if (!sc) continue;
      agg[sc] = (agg[sc] || 0) + count;
    }
    return Object.entries(agg).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [cpcEntries, selClass]);

  const groupOptions = useMemo(() => {
    if (!selSubclass) return [];
    const agg = {};
    for (const [code, count] of cpcEntries) {
      if (getSubclass(code) !== selSubclass) continue;
      if (!isGroup(code)) continue;
      agg[code] = (agg[code] || 0) + count;
    }
    return Object.entries(agg).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [cpcEntries, selSubclass]);

  const subgroupOptions = useMemo(() => {
    if (!selGroup) return [];
    const pref = groupPrefix(selGroup);
    const agg = {};
    for (const [code, count] of cpcEntries) {
      if (!isSubgroup(code)) continue;
      if (!code.startsWith(pref)) continue;
      agg[code] = (agg[code] || 0) + count;
    }
    return Object.entries(agg).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [cpcEntries, selGroup]);

  const mode = modePill(backendMode);
  const sectionTerms = useMemo(() => splitCsvOrLines(sectionKeywords), [sectionKeywords]);

  const toggleScope = (scope) => {
    setSectionScopes((prev) => {
      const has = prev.includes(scope);
      if (has) return prev.filter((x) => x !== scope);
      return [...prev, scope];
    });
  };

  const loadAuthMe = async () => {
    try {
      const res = await fetchJson(apiUrl("/auth/me"));
      if (!res.ok) {
        throw new Error(`Auth check failed (${res.status})`);
      }

      const data = await res.json();
      setAuthRequired(!!data.auth_required);
      setCurrentUser(data.authenticated ? data.user : null);
      setAuthError("");
    } catch (err) {
      console.error(err);
      setAuthError("Could not verify authentication status.");
    } finally {
      setAuthChecked(true);
    }
  };

  const loadSearchHistory = async () => {
    if (!currentUser) {
      setSearchHistory([]);
      setHistoryError("");
      return;
    }

    setHistoryLoading(true);
    setHistoryError("");

    try {
      const res = await fetchJson(apiUrl("/history/searches"));

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Failed to load history (${res.status})`);
      }

      const data = await res.json();
      setSearchHistory(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      console.error(err);
      setHistoryError(err?.message || "Could not load search history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleHistoryClick = async (item) => {
	  console.log("history clicked", item);
	  setSelectedHistoryId(item.id);
	  setHistoryError("");

	  try {
		const res = await fetchJson(apiUrl(`/history/searches/${item.id}`));
		console.log("history detail response status", res.status);

		if (!res.ok) {
		  const txt = await res.text();
		  throw new Error(txt || `Failed to load history detail (${res.status})`);
		}

		const data = await res.json();
		console.log("history detail data", data);

		if (historyReplayMode === "edit") {
		  console.log("edit mode branch");
		  setProblem(item.problem_preview || "");
		  setStickyQuery(item.problem_preview || "");
		  setOverlayQuery(item.problem_preview || "");
		  if (item.domain) setDomain(item.domain);
		  if (item.technologies) setTechnologies(splitCsvOrLines(item.technologies));
		  if (item.novelty_preview) setNovelty(item.novelty_preview);
		  applySearchDataToState(data.response || {}, { markSearched: true });
		  scrollToForm();
		  return;
		}

		if (historyReplayMode === "run") {
		  console.log("run mode branch");
		  const rerunIdea = {
			problem: item.problem_preview || "",
			what_it_does: whatItDoes,
			domain: item.domain || domain,
			technologies: item.technologies ? splitCsvOrLines(item.technologies) : [],
			novelty: item.novelty_preview || undefined,
			keywords: splitCsvOrLines(keywords),
			exclude_keywords: splitCsvOrLines(excludeKeywords),
			assignee_filter: assigneeFilter.trim() || undefined,
			year_from: yearFrom ? Number(yearFrom) : undefined,
			year_to: yearTo ? Number(yearTo) : undefined,
			max_results: Number(maxResults) || 10,
			section_scopes: sectionScopes,
			section_keywords: splitCsvOrLines(sectionKeywords),
		  };

		  setProblem(rerunIdea.problem || "");
		  setStickyQuery(rerunIdea.problem || "");
		  setOverlayQuery(rerunIdea.problem || "");
		  if (rerunIdea.domain) setDomain(rerunIdea.domain);
		  setTechnologies(rerunIdea.technologies || []);
		  setNovelty(rerunIdea.novelty || "");

		  await runFullSearch(rerunIdea);
		  return;
		}

		console.log("no replay branch matched", historyReplayMode);
	  } catch (err) {
		console.error(err);
		setHistoryError(err?.message || "Could not open that past search.");
	  }
  };
  
  const handleDeleteHistory = async (itemId) => {
	  try {
		const res = await fetch(apiUrl(`/history/searches/${itemId}`), {
		  method: "DELETE",
		  credentials: "include",
		});

		if (!res.ok) {
		  const txt = await res.text();
		  throw new Error(txt || "Failed to delete history item");
		}

		setSearchHistory((prev) =>
		  prev.filter((x) => Number(x.id) !== Number(itemId))
		);

		if (Number(selectedHistoryId) === Number(itemId)) {
		  setSelectedHistoryId(null);
		}

	  } catch (err) {
		console.error(err);
		setHistoryError("Failed to delete history item");
	  }
  };

  useEffect(() => {
    if (currentUser) {
      loadSearchHistory();
    } else {
      setSearchHistory([]);
      setSelectedHistoryId(null);
    }
  }, [currentUser]);

  useEffect(() => {
    loadAuthMe();
  }, []);

  const handleRegister = async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    try {
      const res = await postJson(apiUrl("/auth/register"), {
        email: authEmail.trim(),
        password: authPassword,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || `Register failed (${res.status})`);
      }

      await loadAuthMe();
      setAuthMessage("Account created and logged in.");
      setAuthPassword("");
    } catch (err) {
      setAuthError(err?.message || "Registration failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    try {
      const res = await postJson(apiUrl("/auth/login"), {
        email: authEmail.trim(),
        password: authPassword,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || `Login failed (${res.status})`);
      }

      await loadAuthMe();
      setAuthMessage("Logged in successfully.");
      setAuthPassword("");
    } catch (err) {
      setAuthError(err?.message || "Login failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    try {
      const res = await postJson(apiUrl("/auth/logout"), {});

      if (!res.ok) {
        throw new Error(`Logout failed (${res.status})`);
      }

      setCurrentUser(null);
      setResults([]);
      setInputSummary("");
      setCpcUsed([]);
      setBackendMode("");
      setAuthMessage("Logged out.");
      setSearchHistory([]);
      setSelectedHistoryId(null);
      setHasSearched(false);
      setStickyQuery("");
      setPinnedHistoryIds([]);
      writePinnedHistoryIds([]);

      await loadAuthMe();
    } catch (err) {
      setAuthError(err?.message || "Logout failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <main className="min-h-screen">
      <SearchOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        value={overlayQuery}
        setValue={setOverlayQuery}
        onRun={runOverlay}
        suggestions={SUGGESTIONS}
        isLoading={isLoading}
      />

      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900" />
        <div className="absolute -top-48 -left-32 h-[520px] w-[520px] rounded-full blur-3xl opacity-60 bg-gradient-to-br from-fuchsia-500 to-cyan-400" />
        <div className="absolute -top-24 -right-44 h-[520px] w-[520px] rounded-full blur-3xl opacity-50 bg-gradient-to-br from-indigo-500 to-fuchsia-500" />
        <div className="absolute bottom-[-260px] left-1/3 h-[560px] w-[560px] rounded-full blur-3xl opacity-50 bg-gradient-to-br from-cyan-400 to-lime-300" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] [background-size:22px_22px] opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/0 via-white/0 to-white/5" />
      </div>

      {hasSearched && (
        <div className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/35 backdrop-blur-xl">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 text-sm">⌕</span>
                  <input
                    value={stickyQuery}
                    onChange={(e) => setStickyQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runSticky();
                      }
                    }}
                    placeholder="Refine your query…"
                    className={[
                      "w-full rounded-2xl border border-white/15 bg-white/10 text-white/90",
                      "pl-9 pr-3 py-2 text-sm outline-none",
                      "focus:ring-2 focus:ring-fuchsia-400/40",
                    ].join(" ")}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={runSticky}
                  disabled={isLoading || (stickyQuery || "").trim().length < 10}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-semibold text-white transition",
                    isLoading || (stickyQuery || "").trim().length < 10
                      ? "bg-white/15 cursor-not-allowed"
                      : "bg-gradient-to-r from-fuchsia-600 to-cyan-500 hover:from-fuchsia-500 hover:to-cyan-400",
                    "shadow-[0_14px_40px_-18px_rgba(236,72,153,0.55)]",
                  ].join(" ")}
                >
                  {isLoading ? "Searching…" : "Search"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOverlayQuery((stickyQuery || problem || "").trim());
                    setOverlayOpen(true);
                  }}
                  className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white/85 hover:bg-white/15"
                  title="Open search (Ctrl/Cmd+K)"
                >
                  Ctrl/Cmd K
                </button>

                <a
                  href={apiUrl("/health")}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white/85 hover:bg-white/15"
                >
                  Health
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="border-b border-white/10 bg-white/5 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80">
                <span className="h-2 w-2 rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-300" />
                Student Patent Novelty Check
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white mt-3">
                Find prior art fast — with student-friendly explanations
              </h1>
              <p className="text-white/70 max-w-3xl mt-2">
                Describe your idea. We’ll search similar patents, rank them by relevance, and explain why they match.
              </p>

              <p className="text-xs text-white/60 mt-3">
                API:{" "}
                <code className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-white/80">
                  {API_BASE}
                </code>
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOverlayQuery((stickyQuery || problem || "").trim());
                    setOverlayOpen(true);
                  }}
                  className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 hover:bg-white/15"
                >
                  Open Search (Ctrl/Cmd+K)
                </button>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/60">
                  Press “/” to open too
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={[
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                  "bg-white/10 border-white/10 text-white/80",
                ].join(" ")}
                title={backendMode || ""}
              >
                <span className={`mr-2 h-2 w-2 rounded-full ${backendMode ? "bg-emerald-400" : "bg-white/40"}`} />
                {mode.label}
                {backendMode ? ` · ${backendMode}` : ""}
              </span>

              <a
                href={apiUrl("/health")}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/15"
              >
                Backend health
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className={`${glassCard()} relative overflow-hidden`}>
          <GlowLine />
          <div className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Account</p>
                <p className="text-xs text-slate-600 mt-1">
                  {authChecked
                    ? authRequired
                      ? "Authentication is required for protected usage."
                      : "Authentication is available and ready to be enforced."
                    : "Checking authentication status..."}
                </p>

                {currentUser && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Chip tone="brand">{currentUser.email}</Chip>
                    <Chip tone="aqua">Role: {currentUser.role}</Chip>
                    {currentUser.school_domain ? <Chip tone="default">{currentUser.school_domain}</Chip> : null}
                  </div>
                )}
              </div>

              {currentUser ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={authLoading}
                    className="rounded-2xl border border-white/30 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                  >
                    {authLoading ? "Working..." : "Logout"}
                  </button>
                </div>
              ) : (
                <div className="w-full sm:w-[360px]">
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setAuthMode("login")}
                      className={[
                        "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                        authMode === "login"
                          ? "bg-slate-900 text-white"
                          : "border border-white/30 bg-white/70 text-slate-700 hover:bg-white",
                      ].join(" ")}
                    >
                      Login
                    </button>

                    <button
                      type="button"
                      onClick={() => setAuthMode("register")}
                      className={[
                        "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                        authMode === "register"
                          ? "bg-slate-900 text-white"
                          : "border border-white/30 bg-white/70 text-slate-700 hover:bg-white",
                      ].join(" ")}
                    >
                      Register
                    </button>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="Email"
                      className="w-full rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/35"
                    />

                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/35"
                    />

                    <button
                      type="button"
                      onClick={authMode === "login" ? handleLogin : handleRegister}
                      disabled={authLoading || !authEmail.trim() || authPassword.length < 8}
                      className={[
                        "w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white transition",
                        authLoading || !authEmail.trim() || authPassword.length < 8
                          ? "bg-slate-300/70 cursor-not-allowed"
                          : "bg-gradient-to-r from-fuchsia-600 to-cyan-500 hover:from-fuchsia-500 hover:to-cyan-400",
                      ].join(" ")}
                    >
                      {authLoading ? "Working..." : authMode === "login" ? "Login" : "Create account"}
                    </button>

                    {authError && (
                      <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-800">
                        {authError}
                      </div>
                    )}

                    {authMessage && (
                      <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800">
                        {authMessage}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10 grid grid-cols-1 lg:grid-cols-5 gap-8">
        <section className="lg:col-span-2 space-y-4" ref={formRef}>
          {currentUser && (
            <div className={`${glassCard()} relative overflow-hidden`}>
              <GlowLine />
              <div className="p-5 border-b border-white/20 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Past searches</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Pin important ones and choose whether history should open for editing or rerun instantly.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={loadSearchHistory}
                  disabled={historyLoading}
                  className="rounded-2xl border border-white/30 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                >
                  {historyLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="rounded-2xl border border-white/30 bg-white/60 p-3">
                  <div className="text-xs font-semibold text-slate-700 mb-2">History click behavior</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setHistoryReplayMode("edit")}
                      className={[
                        "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                        historyReplayMode === "edit"
                          ? "bg-slate-900 text-white"
                          : "border border-white/30 bg-white/70 text-slate-700 hover:bg-white",
                      ].join(" ")}
                    >
                      Edit before rerun
                    </button>

                    <button
                      type="button"
                      onClick={() => setHistoryReplayMode("run")}
                      className={[
                        "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                        historyReplayMode === "run"
                          ? "bg-slate-900 text-white"
                          : "border border-white/30 bg-white/70 text-slate-700 hover:bg-white",
                      ].join(" ")}
                    >
                      Run instantly
                    </button>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-600">
                    {historyReplayMode === "edit"
                      ? "Clicking a past search fills the form and restores saved results so you can edit before running again."
                      : "Clicking a past search restores the form and immediately reruns the search."}
                  </div>
                </div>

                {historyError && (
                  <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-800">
                    {historyError}
                  </div>
                )}

                {!historyLoading && sortedHistory.length === 0 && !historyError && (
                  <div className="rounded-2xl border border-white/30 bg-white/60 px-4 py-4 text-sm text-slate-600">
                    No saved searches yet. Run a search while logged in and it will appear here.
                  </div>
                )}

                <div className="max-h-[520px] overflow-y-auto pr-1 space-y-3">
                  {sortedHistory.map((item) => {
                    const isActive = selectedHistoryId === item.id;
                    const isPinned = pinnedHistoryIds.includes(Number(item.id));

					return (
					  <div
						key={item.id}
						onClick={() => handleHistoryClick(item)}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
						  if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleHistoryClick(item);
						  }
						}}
                        className={[
                          "w-full rounded-2xl border px-4 py-4 text-left transition",
                          isActive
                            ? "border-fuchsia-200 bg-fuchsia-50/70"
                            : "border-white/30 bg-white/60 hover:bg-white/80",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">
                                {item.problem_preview || "Untitled search"}
                              </div>
                              {isPinned ? <Chip tone="brand">Pinned</Chip> : null}
                            </div>

                            <div className="mt-1 text-xs text-slate-600">{formatDateTime(item.created_at)}</div>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.domain ? <Chip tone="aqua">{item.domain}</Chip> : null}
                              {item.result_count != null ? <Chip tone="default">{item.result_count} results</Chip> : null}
                              {item.backend_mode ? <Chip tone="brand">{item.backend_mode}</Chip> : null}
                            </div>

                            {item.technologies ? (
                              <div className="mt-2 text-xs text-slate-600">
                                Technologies: {truncateText(item.technologies, 80)}
                              </div>
                            ) : null}

                            {item.novelty_preview ? (
                              <div className="mt-1 text-xs text-slate-600">
                                Novelty: {truncateText(item.novelty_preview, 90)}
                              </div>
                            ) : null}

                            <div className="mt-2 text-[11px] text-slate-500">
                              Click to {historyReplayMode === "run" ? "rerun instantly" : "restore & edit"}
                            </div>
                          </div>

						<div className="flex flex-col items-end gap-2 flex-shrink-0">
						  <div className="text-xs font-semibold text-slate-500">#{item.id}</div>

						  <button
							type="button"
							onClick={(e) => {
							  e.stopPropagation();
							  togglePinnedHistory(item.id);
							}}
							className={[
							  "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
							  isPinned
								? "border-amber-200 bg-amber-50 text-amber-800"
								: "border-white/30 bg-white/70 text-slate-700 hover:bg-white",
							].join(" ")}
							title={isPinned ? "Unpin search" : "Pin search"}
						  >
							{isPinned ? "★ Pinned" : "☆ Pin"}
						  </button>

						  <button
							type="button"
							onClick={(e) => {
							  e.stopPropagation();
							  if (confirm("Delete this search?")) {
								handleDeleteHistory(item.id);
							  }
							}}
							className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
						  >
							Delete
						  </button>
						 </div>
					   </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {(inputSummary || results.length > 0 || backendMode) && (
            <div className={`${glassCard()} relative overflow-hidden`}>
              <GlowLine />
              <div className="p-5 border-b border-white/20 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Search summary</p>
                  <p className="text-xs text-slate-600 mt-1">Copy this for notes/debugging.</p>
                </div>
                <button
                  type="button"
                  onClick={copySummary}
                  className={[
                    "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                    "border border-white/30 bg-white/70 hover:bg-white",
                    softShadow(),
                  ].join(" ")}
                >
                  Copy
                </button>
              </div>
              <div className="p-5 space-y-2">
                <SummaryLine label="Mode" value={backendMode || "—"} />
                <SummaryLine label="Problem" value={truncateText(problem, 140) || "—"} />
                <SummaryLine label="What it does" value={(whatItDoes || []).join(", ")} />
                <SummaryLine label="Novelty" value={truncateText(novelty, 120) || ""} />
                <SummaryLine label="Technologies" value={(technologies || []).join(", ")} />
                <SummaryLine label="Keywords" value={splitCsvOrLines(keywords).slice(0, 12).join(", ")} />
                <SummaryLine label="Exclude" value={splitCsvOrLines(excludeKeywords).slice(0, 12).join(", ")} />
                <SummaryLine label="Patent section keywords" value={splitCsvOrLines(sectionKeywords).slice(0, 12).join(", ")} />
                <SummaryLine label="Patent section scopes" value={(sectionScopes || []).join(", ")} />
                <SummaryLine label="Assignee" value={assigneeFilter.trim()} />
                <SummaryLine label="Years" value={yearFrom || yearTo ? `${yearFrom || "—"} → ${yearTo || "—"}` : ""} />
                <SummaryLine label="CPC filter" value={selSubgroup || selGroup || selSubclass} />
              </div>
            </div>
          )}

          <div className={`${glassCard()} relative overflow-hidden`}>
            <GlowLine />
            <div className="p-6 border-b border-white/20">
              <SectionTitle
                title="Describe your idea"
                subtitle="Start here. Use keywords/exclusions only if results look noisy."
                right={
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="rounded-2xl border border-white/30 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                  >
                    {showAdvanced ? "Hide advanced" : "Show advanced"}
                  </button>
                }
              />
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">What problem are you solving?</label>
                <textarea
                  className={[
                    "w-full resize-none rounded-2xl border bg-white/80 px-4 py-4 text-sm text-slate-800",
                    "border-white/40 shadow-inner focus:outline-none focus:ring-2 focus:ring-fuchsia-400/40",
                  ].join(" ")}
                  rows={4}
                  value={problem}
                  onChange={(e) => {
                    setProblem(e.target.value);
                    setStickyQuery(e.target.value);
                    setOverlayQuery(e.target.value);
                  }}
                  placeholder="e.g. Wearable + smartphone system to reduce heart-failure readmissions using continuous vitals monitoring and early-warning ML."
                  required
                />

                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700 mb-2">Try an example:</div>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s.label} type="button" onClick={() => useSuggestion(s.text, true)} className="text-left">
                        <Chip tone={s.tone}>{s.label}</Chip>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip tone="brand">Tip: add specific nouns</Chip>
                  <Chip tone="aqua">use exclusions for junk</Chip>
                  <Chip tone="lime">CPC refine later</Chip>
                </div>
              </div>

              <div>
                <p className="block text-sm font-semibold text-slate-800 mb-2">What does your idea do?</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: "Automates process", helper: "Cuts manual steps via workflows" },
                    { label: "Analyzes data", helper: "Finds patterns / predicts outcomes" },
                    { label: "Reduces time", helper: "Speeds up tasks / reduces delays" },
                    { label: "Improves UX", helper: "Better interface / engagement" },
                    { label: "Hardware control", helper: "Controls sensors / devices" },
                  ].map((x) => (
                    <TogglePill
                      key={x.label}
                      label={x.label}
                      helper={x.helper}
                      checked={whatItDoes.includes(x.label)}
                      onChange={() => {
                        if (whatItDoes.includes(x.label)) setWhatItDoes(whatItDoes.filter((v) => v !== x.label));
                        else setWhatItDoes([...whatItDoes, x.label]);
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Primary domain</label>
                  <select
                    className={[
                      "w-full rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm text-slate-800",
                      "focus:outline-none focus:ring-2 focus:ring-cyan-400/40",
                    ].join(" ")}
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                  >
                    <option value="Software">Software</option>
                    <option value="Robotics">Robotics</option>
                    <option value="MedTech">MedTech</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    What’s novel? <span className="text-slate-400 font-medium">(optional)</span>
                  </label>
                  <input
                    className={[
                      "w-full rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm text-slate-800",
                      "focus:outline-none focus:ring-2 focus:ring-fuchsia-400/40",
                    ].join(" ")}
                    value={novelty}
                    onChange={(e) => setNovelty(e.target.value)}
                    placeholder="e.g. Multi-modal transformer handles missing/noisy signals + explains alerts."
                  />
                </div>
              </div>

              <div>
                <p className="block text-sm font-semibold text-slate-800 mb-2">Key technologies</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: "AI/ML", helper: "Classification / prediction / ranking" },
                    { label: "Cloud", helper: "APIs, storage, scalable compute" },
                    { label: "Mobile", helper: "iOS/Android app experience" },
                    { label: "IoT", helper: "Sensors, wearables, devices" },
                    { label: "Networking", helper: "Connectivity / protocols" },
                    { label: "NLP", helper: "Text understanding / extraction" },
                    { label: "Database", helper: "Structured storage / querying" },
                  ].map((x) => (
                    <TogglePill
                      key={x.label}
                      label={x.label}
                      helper={x.helper}
                      checked={technologies.includes(x.label)}
                      onChange={() => {
                        if (technologies.includes(x.label)) setTechnologies(technologies.filter((v) => v !== x.label));
                        else setTechnologies([...technologies, x.label]);
                      }}
                    />
                  ))}
                </div>

                <p className="mt-2 text-xs text-slate-600">
                  Tip: technologies don’t change similarity much, but they help CPC suggestions + keyword gating.
                </p>
              </div>

              {showAdvanced && (
                <div className="rounded-3xl border border-white/30 bg-white/55 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Refine search (optional)</p>
                      <p className="text-xs text-slate-600 mt-1">Keywords + exclusions usually have the biggest impact.</p>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-white/30 bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      Advanced
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Must-include keywords</label>
                        <textarea
                          className={[
                            "w-full resize-none rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-sm text-slate-800",
                            "focus:outline-none focus:ring-2 focus:ring-cyan-400/35",
                          ].join(" ")}
                          rows={2}
                          value={keywords}
                          onChange={(e) => setKeywords(e.target.value)}
                          placeholder="heart rate variability, multimodal, early warning"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Exclude keywords</label>
                        <textarea
                          className={[
                            "w-full resize-none rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-sm text-slate-800",
                            "focus:outline-none focus:ring-2 focus:ring-rose-400/35",
                          ].join(" ")}
                          rows={2}
                          value={excludeKeywords}
                          onChange={(e) => setExcludeKeywords(e.target.value)}
                          placeholder="printer, messaging, catheter"
                        />
                      </div>
                    </div>

                    <div className="rounded-3xl border border-white/30 bg-white/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Patent section keyword search</p>
                          <p className="text-xs text-slate-600 mt-1">
                            Use this when you want the match to appear in specific parts of the patent.
                          </p>
                          <p className="text-xs text-slate-600 mt-1">
                            Recommendation: start with <b>Abstract + Claims</b>. If results drop to zero, remove Claims or loosen keywords.
                          </p>
                        </div>
                        <span className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50/70 px-2.5 py-1 text-xs font-semibold text-fuchsia-800">
                          Section-wise Searching
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          { key: "abstract", label: "Abstract", helper: "Short overview — fast narrowing" },
                          { key: "brief_summary", label: "Brief summary", helper: "Summary section text" },
                          { key: "claims", label: "Claims", helper: "Most important — legal scope" },
                          { key: "description", label: "Description", helper: "Longer body text" },
                        ].map((x) => (
                          <TogglePill
                            key={x.key}
                            label={x.label}
                            helper={x.helper}
                            checked={sectionScopes.includes(x.key)}
                            onChange={() => toggleScope(x.key)}
                          />
                        ))}
                      </div>

                      <div className="mt-3">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Section keywords (comma/newline separated)
                        </label>
                        <textarea
                          className={[
                            "w-full resize-none rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-sm text-slate-800",
                            "focus:outline-none focus:ring-2 focus:ring-fuchsia-400/35",
                          ].join(" ")}
                          rows={2}
                          value={sectionKeywords}
                          onChange={(e) => setSectionKeywords(e.target.value)}
                          placeholder="e.g. early warning, anomaly detection, heart failure"
                        />
                        <div className="mt-2 text-[11px] text-slate-600">
                          These keywords are used to find evidence in the selected sections and strengthen relevance explanations.
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Assignee (optional)</label>
                        <input
                          className={[
                            "w-full rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-sm text-slate-800",
                            "focus:outline-none focus:ring-2 focus:ring-fuchsia-400/35",
                          ].join(" ")}
                          value={assigneeFilter}
                          onChange={(e) => setAssigneeFilter(e.target.value)}
                          placeholder="Philips"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Max results</label>
                        <input
                          type="number"
                          min={3}
                          max={20}
                          className={[
                            "w-full rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-sm text-slate-800",
                            "focus:outline-none focus:ring-2 focus:ring-cyan-400/35",
                          ].join(" ")}
                          value={maxResults}
                          onChange={(e) => setMaxResults(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Year from</label>
                        <input
                          type="number"
                          className={[
                            "w-full rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-sm text-slate-800",
                            "focus:outline-none focus:ring-2 focus:ring-cyan-400/35",
                          ].join(" ")}
                          value={yearFrom}
                          onChange={(e) => setYearFrom(e.target.value)}
                          placeholder="2015"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Year to</label>
                        <input
                          type="number"
                          className={[
                            "w-full rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-sm text-slate-800",
                            "focus:outline-none focus:ring-2 focus:ring-cyan-400/35",
                          ].join(" ")}
                          value={yearTo}
                          onChange={(e) => setYearTo(e.target.value)}
                          placeholder="2025"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/30 bg-white/65 p-3">
                      <label className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-slate-700">Show abstract preview in results</span>
                        <button
                          type="button"
                          onClick={() => setShowAbstractPreview((v) => !v)}
                          className={[
                            "relative inline-flex h-7 w-12 items-center rounded-full border transition",
                            showAbstractPreview ? "border-fuchsia-200 bg-fuchsia-50" : "border-slate-200 bg-slate-50",
                          ].join(" ")}
                          aria-pressed={showAbstractPreview}
                        >
                          <span
                            className={[
                              "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition",
                              showAbstractPreview ? "translate-x-6" : "translate-x-1",
                            ].join(" ")}
                          />
                        </button>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={isLoading || !canSubmit}
                  className={[
                    "w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white transition",
                    isLoading || !canSubmit
                      ? "bg-white/20 cursor-not-allowed"
                      : "bg-gradient-to-r from-fuchsia-600 to-cyan-500 hover:from-fuchsia-500 hover:to-cyan-400",
                    "shadow-[0_14px_40px_-18px_rgba(236,72,153,0.55)]",
                  ].join(" ")}
                >
                  {isLoading ? "Searching patents…" : "Search"}
                </button>

                {error && (
                  <div className="mt-4 rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-800">
                    <div className="font-semibold">Couldn’t reach the backend</div>
                    <div className="mt-1">{error}</div>
                    <div className="mt-2 text-xs text-rose-800/90">
                      Try opening{" "}
                      <a href={apiUrl("/health")} target="_blank" rel="noreferrer" className="underline">
                        /health
                      </a>{" "}
                      to confirm the backend is running.
                    </div>
                  </div>
                )}
              </div>
            </form>
          </div>
        </section>

        <section className="lg:col-span-3">
          <div className={`${glassCard()} relative overflow-hidden`}>
            <GlowLine />
            <div className="p-6 border-b border-white/20">
              <SectionTitle
                title="Results"
                subtitle={
                  results.length > 0
                    ? `${inputSummary} · Domain: ${domain || "N/A"}${backendMode ? ` · Mode: ${backendMode}` : ""}`
                    : isLoading
                    ? "Searching…"
                    : "Run a search to see results here."
                }
              />

			  {isLoading && (
				  <div className="mt-4 rounded-3xl border border-white/25 bg-white/35 p-4 overflow-hidden relative">
					<div className="absolute inset-0 animate-pulse bg-gradient-to-r from-fuchsia-500/10 via-cyan-400/10 to-lime-400/10" />
					<div className="relative">
					  <div className="text-sm font-semibold text-slate-900">
						{jobStatus ? `Search job: ${jobStatus}` : "Searching patents..."}
					  </div>

					  <div className="text-xs text-slate-700 mt-1">
						{jobStage || "Ranking results and checking evidence..."}
					  </div>

					  {jobId && (
						<div className="mt-1 text-[11px] text-slate-600">
						  Job ID: {jobId}
						</div>
					  )}

					  <div className="mt-3 h-2 w-full rounded-full bg-white/60 overflow-hidden">
						<div
						  className="h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-cyan-500 transition-all duration-500"
						  style={{ width: `${Math.max(0, Math.min(100, jobProgress || 0))}%` }}
						/>
					  </div>

					  <div className="mt-2 text-xs text-slate-600">
						{jobProgress || 0}% complete
					  </div>
					</div>
				  </div>
				)}

              {results.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Chip tone="default">{results.length} results</Chip>
                  {results?.[0] && <Chip tone="brand">Top match: {pct(results[0].similarity_score)}%</Chip>}
                  {sectionTerms.length > 0 && (
                    <Chip tone="aqua">
                      Section evidence: {sectionScopes.join(", ")} · {sectionTerms.slice(0, 4).join(", ")}
                      {sectionTerms.length > 4 ? "…" : ""}
                    </Chip>
                  )}
                  <button
                    type="button"
                    onClick={downloadResultsReport}
                    disabled={isDownloading || !visibleResults.length}
                    className="rounded-full border border-white/30 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                  >
                    {isDownloading ? "Preparing..." : "Download report"}
                  </button>
                </div>
              )}

              {sectionOptions.length > 0 && (
                <div className="mt-5 rounded-3xl border border-white/30 bg-white/55 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Refine by CPC (dropdown)</p>
                      <p className="text-xs text-slate-600 mt-1">
                        CPC is a patent category system. Use it to narrow results if you’re seeing unrelated patents.
                        Start broad → get specific.
                      </p>
                      <p className="text-xs text-slate-600 mt-1">
                        Recommendation: pick a <b>Subclass</b> first (broad), then optionally choose <b>Group/Subgroup</b> (more specific).
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        resetCpcDropdown();
                        runSearchWithCpcFilter("");
                      }}
                      disabled={isLoading}
                      className="rounded-2xl border border-white/40 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                    >
                      Clear CPC filter
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Section</label>
                      <select
                        className="w-full rounded-2xl border border-white/40 bg-white/80 px-3 py-2 text-sm text-slate-800"
                        value={selSection}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelSection(v);
                          setSelClass("");
                          setSelSubclass("");
                          setSelGroup("");
                          setSelSubgroup("");
                        }}
                      >
                        <option value="">All sections</option>
                        {sectionOptions.map(([sec, count]) => (
                          <option key={sec} value={sec}>
                            {sectionLabel(sec)} ({count})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Class</label>
                      <select
                        className="w-full rounded-2xl border border-white/40 bg-white/80 px-3 py-2 text-sm text-slate-800"
                        value={selClass}
                        disabled={!selSection}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelClass(v);
                          setSelSubclass("");
                          setSelGroup("");
                          setSelSubgroup("");
                        }}
                      >
                        <option value="">{selSection ? "All classes" : "Select section first"}</option>
                        {classOptions.map(([cls, count]) => (
                          <option key={cls} value={cls}>
                            {cls} ({count})
                          </option>
                        ))}
                      </select>
                      {!selSection && <div className="text-[11px] text-slate-500 mt-1">Pick a Section to enable Class.</div>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Subclass</label>
                      <select
                        className="w-full rounded-2xl border border-white/40 bg-white/80 px-3 py-2 text-sm text-slate-800"
                        value={selSubclass}
                        disabled={!selClass}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelSubclass(v);
                          setSelGroup("");
                          setSelSubgroup("");
                          if (v) runSearchWithCpcFilter(v);
                          else runSearchWithCpcFilter("");
                        }}
                      >
                        <option value="">{selClass ? "All subclasses" : "Select class first"}</option>
                        {subclassOptions.map(([sub, count]) => (
                          <option key={sub} value={sub}>
                            {sub} — {(cpcHumanMap && cpcHumanMap[sub]) || "Technical category"} ({count})
                          </option>
                        ))}
                      </select>
                      {!selClass && <div className="text-[11px] text-slate-500 mt-1">Pick a Class to enable Subclass.</div>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Group</label>
                      <select
                        className="w-full rounded-2xl border border-white/40 bg-white/80 px-3 py-2 text-sm text-slate-800"
                        value={selGroup}
                        disabled={!selSubclass || groupOptions.length === 0}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelGroup(v);
                          setSelSubgroup("");
                          if (v) runSearchWithCpcFilter(v);
                          else if (selSubclass) runSearchWithCpcFilter(selSubclass);
                          else runSearchWithCpcFilter("");
                        }}
                      >
                        <option value="">
                          {!selSubclass ? "Select subclass first" : groupOptions.length === 0 ? "No groups found" : "All groups"}
                        </option>
                        {groupOptions.map(([grp, count]) => (
                          <option key={grp} value={grp}>
                            {grp} — within {selSubclass} ({(cpcHumanMap && cpcHumanMap[selSubclass]) || "Technical category"}) ({count})
                          </option>
                        ))}
                      </select>
                      {!!selSubclass && groupOptions.length === 0 && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          No group-level CPCs were found in the stats pool for this subclass. Subclass filtering still works.
                        </div>
                      )}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Subgroup</label>
                      <select
                        className="w-full rounded-2xl border border-white/40 bg-white/80 px-3 py-2 text-sm text-slate-800"
                        value={selSubgroup}
                        disabled={!selGroup || subgroupOptions.length === 0}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelSubgroup(v);
                          if (v) runSearchWithCpcFilter(v);
                          else if (selGroup) runSearchWithCpcFilter(selGroup);
                          else if (selSubclass) runSearchWithCpcFilter(selSubclass);
                          else runSearchWithCpcFilter("");
                        }}
                      >
                        <option value="">
                          {!selGroup ? "Select group first" : subgroupOptions.length === 0 ? "No subgroups found" : "All subgroups"}
                        </option>
                        {subgroupOptions.map(([sg, count]) => (
                          <option key={sg} value={sg}>
                            {sg} — detailed subtype of {selGroup} ({count})
                          </option>
                        ))}
                      </select>
                      {!!selGroup && subgroupOptions.length === 0 && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          No subgroup-level CPCs were found in the stats pool for this group. Group filtering still works.
                        </div>
                      )}
                    </div>

                    <div className="sm:col-span-2">
                      <div className="mt-1 text-xs text-slate-600">
                        Active CPC filter:{" "}
                        <span className="font-semibold text-slate-900">{selSubgroup || selGroup || selSubclass || "None"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6">
              {isLoading && (
                <div className="space-y-4">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              )}

              {!isLoading && results.length === 0 && (
                <div className="rounded-3xl border border-white/25 bg-white/40 p-8">
                  <p className="text-sm font-semibold text-slate-900">No results</p>
                  <p className="text-sm text-slate-700 mt-2">
                    Try loosening exclusions, adding clearer keywords, or removing CPC filters.
                  </p>
                  {splitCsvOrLines(sectionKeywords).length > 0 && sectionScopes.includes("claims") && (
                    <p className="text-sm text-slate-700 mt-2">
                      You’re filtering by <b>Claims</b> evidence — that can be strict. Try removing Claims or reducing section keywords.
                    </p>
                  )}
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <>
                  <div className="mb-4 rounded-3xl border border-white/30 bg-white/55 p-4">
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-700">Sort</label>
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          className="rounded-2xl border border-white/40 bg-white/80 px-3 py-2 text-sm text-slate-800"
                        >
                          <option value="relevance">Relevance</option>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="min-w-[200px]">
                          <div className="flex items-center justify-between text-xs text-slate-600">
                            <span className="font-semibold text-slate-700">Min similarity</span>
                            <span>{minSim}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={minSim}
                            onChange={(e) => setMinSim(Number(e.target.value))}
                            className="w-full accent-fuchsia-500"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => setMinSim(0)}
                          className="rounded-2xl border border-white/40 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Confidence:</span> based on semantic similarity between your idea and patent text, plus any selected section evidence.
                    </div>
                  </div>

                  <div className="space-y-4">
                    {visibleResults.map((patent, idx) => {
                      const key = `${patent.publication_number}-${idx}`;
                      const p = pct(patent.similarity_score);
                      const url = patent.google_patents_url || patentUrl(patent.publication_number);
                      const conf = confidenceLabel(p);
                      const cpcMeta = getCpcMatchMeta(patent.cpc_alignment_score);
                      const fb = feedback[key] || { vote: null, comment: "", submitted: false, status: "" };
                      const abstract = (patent.abstract_snippet || "").trim();

                      const matchedSections = patent.matched_sections || [];
                      const matchedKeywords = patent.matched_keywords || [];
                      const claimSupport = patent.claim_support_level || "None";
                      const hasEvidence = matchedSections.length > 0 || !!patent.summary_snippet || !!patent.claim_excerpt;

                      return (
                        <article
                          key={key}
                          className={[
                            "relative rounded-3xl border border-white/35 bg-white/70 backdrop-blur-xl",
                            "p-5 transition hover:bg-white/85",
                            "shadow-[0_16px_60px_-36px_rgba(2,6,23,0.45)]",
                          ].join(" ")}
                        >
                          <div className="absolute -top-3 -left-3">
                            <div className="rounded-2xl border border-white/40 bg-white/80 px-3 py-1 text-xs font-black text-slate-800 shadow-sm">
                              #{idx + 1}
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="text-base sm:text-lg font-semibold text-slate-900 leading-snug">{patent.title}</h3>

                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline decoration-slate-300 hover:decoration-slate-500"
                                  >
                                    {patent.publication_number}
                                  </a>
                                ) : (
                                  <span>{patent.publication_number}</span>
                                )}
                                <span>·</span>
                                <span>{patent.year}</span>
                                <span>·</span>
                                <span className="truncate">{patent.assignee}</span>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-2">
                                <Chip tone="aqua">
                                  {patent.cpc_label}{" "}
                                  <span className="ml-1 text-[11px] text-slate-600">
                                    ({(cpcHumanMap && cpcHumanMap[(patent.cpc_label || "").slice(0, 4)]) || patent.cpc_human || "Technical category"})
                                  </span>
                                </Chip>

                                <span
                                  className={[
                                    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                                    conf.tone,
                                  ].join(" ")}
                                  title={conf.expl}
                                >
                                  <span className={`mr-2 h-2 w-2 rounded-full ${conf.dot}`} />
                                  {conf.label}
                                </span>

                                {claimSupport && claimSupport !== "None" && (
                                  <span
                                    className={[
                                      "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                                      claimSupport === "Strong"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                        : claimSupport === "Moderate"
                                        ? "border-amber-200 bg-amber-50 text-amber-800"
                                        : "border-slate-200 bg-slate-50 text-slate-700",
                                    ].join(" ")}
                                  >
                                    Claim support: {claimSupport}
                                  </span>
                                )}

                                {sectionTerms.length > 0 && hasEvidence && (
                                  <Chip tone="brand">
                                    Evidence found: {(matchedSections || []).join(", ") || "summary / claims"}
                                  </Chip>
                                )}
                              </div>

                              {showAbstractPreview && abstract && (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => setOpenAbstract((prev) => ({ ...prev, [key]: !prev[key] }))}
                                    className="text-sm font-semibold text-slate-900 hover:text-slate-950"
                                  >
                                    {openAbstract[key] ? "Hide" : "Show"} abstract preview
                                  </button>

                                  <div className="mt-2 text-sm text-slate-800">
                                    {openAbstract[key] ? (
                                      <p className="leading-relaxed">{highlightNodes(abstract, matchedKeywords.length ? matchedKeywords : sectionTerms)}</p>
                                    ) : (
                                      <p className="leading-relaxed">{highlightNodes(truncateText(abstract, 220), matchedKeywords.length ? matchedKeywords : sectionTerms)}</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {patent.summary_snippet && (
                                <div className="mt-3 rounded-2xl border border-white/25 bg-white/55 p-3">
                                  <p className="text-xs font-semibold text-slate-700">Brief summary</p>
                                  <p className="mt-1 text-sm text-slate-800">
                                    {highlightNodes(patent.summary_snippet, matchedKeywords.length ? matchedKeywords : sectionTerms)}
                                  </p>
                                </div>
                              )}

                              {patent.claim_excerpt && (
                                <div className="mt-3 rounded-2xl border border-white/25 bg-white/55 p-3">
                                  <p className="text-xs font-semibold text-slate-700">Claims support</p>
                                  <p className="mt-1 text-sm text-slate-800">
                                    {highlightNodes(patent.claim_excerpt, matchedKeywords.length ? matchedKeywords : sectionTerms)}
                                  </p>
                                </div>
                              )}

                              {sectionTerms.length > 0 && (
                                <div className="mt-4">
                                  <button
                                    type="button"
                                    onClick={() => setOpenEvidence((prev) => ({ ...prev, [key]: !prev[key] }))}
                                    className="text-sm font-semibold text-slate-900 hover:text-slate-950"
                                  >
                                    {openEvidence[key] ? "Hide" : "Show"} section evidence & claim support
                                  </button>

                                  {openEvidence[key] && (
                                    <div className="mt-3 rounded-2xl border border-white/40 bg-white/75 p-4">
                                      <div className="text-xs text-slate-600">
                                        Matching keywords:{" "}
                                        <span className="font-semibold text-slate-900">
                                          {(matchedKeywords || []).length ? matchedKeywords.join(", ") : sectionTerms.join(", ")}
                                        </span>
                                      </div>

                                      <div className="mt-3">
                                        <div className="text-xs font-semibold text-slate-700">Matched sections</div>
                                        {(matchedSections || []).length > 0 ? (
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            {matchedSections.map((s) => (
                                              <Chip key={s} tone="default">
                                                {s}
                                              </Chip>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="mt-2 text-sm text-slate-600">No section matches were identified.</div>
                                        )}
                                      </div>

                                      <div className="mt-4">
                                        <div className="text-xs font-semibold text-slate-700">Claim support</div>
                                        <div className="mt-2 text-sm text-slate-800">
                                          {claimSupport === "None"
                                            ? "No meaningful claims support found."
                                            : `Claims support level: ${claimSupport}`}
                                        </div>
                                        {patent.claim_excerpt ? (
                                          <div className="mt-2 leading-relaxed text-sm text-slate-800">
                                            {highlightNodes(patent.claim_excerpt, matchedKeywords.length ? matchedKeywords : sectionTerms)}
                                          </div>
                                        ) : (
                                          <div className="mt-2 text-sm text-slate-600">No claims excerpt available.</div>
                                        )}
                                      </div>

                                      <div className="mt-4">
                                        <div className="text-xs font-semibold text-slate-700">Brief summary</div>
                                        {patent.summary_snippet ? (
                                          <div className="mt-2 leading-relaxed text-sm text-slate-800">
                                            {highlightNodes(patent.summary_snippet, matchedKeywords.length ? matchedKeywords : sectionTerms)}
                                          </div>
                                        ) : (
                                          <div className="mt-2 text-sm text-slate-600">No brief summary matches.</div>
                                        )}
                                      </div>

                                      <div className="mt-4 text-[11px] text-slate-600">
                                        Note: section evidence is retrieved from patent detail text and shown as short snippets.
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="sm:w-52">
                              <p className="text-xs font-medium text-slate-600">Similarity</p>
                              <div className="mt-1 flex items-baseline justify-between">
                                <p className="text-2xl font-bold text-slate-900">{p}%</p>
                              </div>

                              <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-cyan-500"
                                  style={{ width: `${p}%` }}
                                />
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                {patent.cpc_alignment_score != null && (
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cpcMeta.tone}`}
                                    title={`CPC alignment score: ${Number(patent.cpc_alignment_score || 0).toFixed(2)}`}
                                  >
                                    {cpcMeta.label}
                                  </span>
                                )}

                                {patent.cpc_human && (
                                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                    {patent.cpc_human}
                                  </span>
                                )}
                              </div>

                              {patent.cpc_alignment_score != null && (
                                <div className="mt-2 text-[11px] text-slate-600">
                                  CPC relevance: {fmtPct01(patent.cpc_alignment_score)}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 space-y-4">
                            {(patent.rank_explanations || []).length > 0 && (
                              <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                                <p className="text-sm font-semibold text-slate-900">Why this ranked high</p>
                                <ul className="mt-2 space-y-2 text-sm text-slate-800">
                                  {patent.rank_explanations.map((line, i) => (
                                    <li key={i} className="flex gap-2">
                                      <span className="mt-1 h-2 w-2 rounded-full bg-slate-400 flex-shrink-0" />
                                      <span>{line}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div>
                              <button
                                type="button"
                                onClick={() => setOpenWhy((prev) => ({ ...prev, [key]: !prev[key] }))}
                                className="text-sm font-semibold text-slate-900 hover:text-slate-950"
                              >
                                {openWhy[key] ? "Hide" : "Show"} why similar
                              </button>

                              {openWhy[key] && (patent.why_similar || []).length > 0 && (
                                <ul className="mt-3 space-y-2 text-sm text-slate-800">
                                  {patent.why_similar.map((line, i) => (
                                    <li key={i} className="flex gap-2">
                                      <span className="mt-1 h-2 w-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 flex-shrink-0" />
                                      <span>{line}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>

                          {(patent.confidence_explanation || []).length > 0 && (
                            <div className="mt-4 rounded-2xl border border-white/30 bg-white/60 p-4">
                              <p className="text-sm font-semibold text-slate-900">Confidence explanation</p>
                              <ul className="mt-2 space-y-2 text-sm text-slate-800">
                                {patent.confidence_explanation.map((line, i) => (
                                  <li key={i} className="flex gap-2">
                                    <span className="mt-1 h-2 w-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 flex-shrink-0" />
                                    <span>{line}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="mt-5 border-t border-white/30 pt-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Feedback</p>
                                <p className="text-xs text-slate-600 mt-1">Helps us learn what “relevant” means.</p>
                              </div>
                              {fb.status && <span className="text-xs text-slate-600">{fb.status}</span>}
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setVote(key, "up")}
                                className={[
                                  "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                                  fb.vote === "up"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-white/40 bg-white/70 text-slate-700 hover:bg-white",
                                ].join(" ")}
                              >
                                👍 Relevant
                              </button>

                              <button
                                type="button"
                                onClick={() => setVote(key, "down")}
                                className={[
                                  "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                                  fb.vote === "down"
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-white/40 bg-white/70 text-slate-700 hover:bg-white",
                                ].join(" ")}
                              >
                                👎 Not relevant
                              </button>
                            </div>

                            <div className="mt-3">
                              <textarea
                                className={[
                                  "w-full resize-none rounded-2xl border border-white/40 bg-white/80 px-3 py-3 text-sm text-slate-800",
                                  "focus:outline-none focus:ring-2 focus:ring-cyan-400/35",
                                ].join(" ")}
                                rows={2}
                                value={fb.comment}
                                onChange={(e) => setComment(key, e.target.value)}
                                placeholder="Optional: what did you expect to see instead?"
                              />
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => submitFeedback(key, patent)}
                                disabled={!fb.vote || fb.submitted}
                                className={[
                                  "rounded-2xl px-4 py-2 text-sm font-semibold text-white transition",
                                  !fb.vote || fb.submitted
                                    ? "bg-slate-300/70 cursor-not-allowed"
                                    : "bg-slate-900 hover:bg-slate-800",
                                ].join(" ")}
                              >
                                {fb.submitted ? "Saved" : "Submit feedback"}
                              </button>

                              {fb.submitted && <span className="text-xs text-slate-600">Thanks ✅</span>}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          <p className="text-xs text-white/70 mt-4">
            Tip: If you’re getting irrelevant patents, add those words to <b>Exclude keywords</b>, then re-run search.
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}