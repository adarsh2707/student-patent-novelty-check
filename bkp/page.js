"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Backend base URL
 * - Local default: http://127.0.0.1:8000
 * - Override via frontend/.env.local: NEXT_PUBLIC_API_BASE_URL=https://your-render-url
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

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
  if (p >= 75)
    return {
      label: "High confidence",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      dot: "bg-emerald-500",
    };
  if (p >= 55)
    return {
      label: "Medium confidence",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      dot: "bg-amber-500",
    };
  return {
    label: "Low confidence",
    tone: "border-slate-200 bg-slate-50 text-slate-700",
    dot: "bg-slate-400",
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

function splitCsvOrLines(s) {
  return (s || "")
    .split(/[\n,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function truncateText(s, n = 180) {
  const t = (s || "").trim();
  if (!t) return "";
  if (t.length <= n) return t;
  return `${t.slice(0, n).trim()}…`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

/* ----------------- modern theme helpers ----------------- */
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
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm transition";
  const tones = {
    default: "border-slate-200 bg-white/80 text-slate-700 hover:bg-white",
    brand: "border-fuchsia-200 bg-fuchsia-50/70 text-fuchsia-800",
    aqua: "border-cyan-200 bg-cyan-50/70 text-cyan-800",
    lime: "border-lime-200 bg-lime-50/70 text-lime-800",
  };
  return <span className={`${base} ${tones[tone] || tones.default}`}>{children}</span>;
}

function TogglePill({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={[
        "group flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-sm transition",
        checked
          ? "border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 to-cyan-50 text-slate-900 shadow-sm"
          : "border-slate-200 bg-white/80 text-slate-700 hover:bg-white",
      ].join(" ")}
      aria-pressed={checked}
    >
      <span className="font-semibold">{label}</span>
      <span
        className={[
          "h-5 w-5 rounded-xl border transition grid place-items-center",
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

/* ----------------- Search Overlay (Cmd/Ctrl+K) ----------------- */
function SearchOverlay({
  open,
  onClose,
  value,
  setValue,
  onRun,
  suggestions = [],
  isLoading,
}) {
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
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onMouseDown={onClose}
      />

      {/* Modal */}
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
              <div className="mt-3 text-[11px] text-white/55">
                Tip: fill a suggestion → tweak → press Enter.
              </div>
            </div>
          </div>

          {/* bottom glow */}
          <div className="h-10 bg-gradient-to-r from-fuchsia-500/10 via-cyan-400/10 to-lime-400/10" />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const formRef = useRef(null);

  // ----- Form state -----
  const [problem, setProblem] = useState("");
  const [whatItDoes, setWhatItDoes] = useState([]);
  const [domain, setDomain] = useState("Software");
  const [technologies, setTechnologies] = useState([]);
  const [novelty, setNovelty] = useState("");

  const [keywords, setKeywords] = useState("");
  const [excludeKeywords, setExcludeKeywords] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [maxResults, setMaxResults] = useState(10);

  // ----- UI state -----
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [inputSummary, setInputSummary] = useState("");
  const [cpcUsed, setCpcUsed] = useState([]);
  const [backendMode, setBackendMode] = useState("");
  const [openWhy, setOpenWhy] = useState({});
  const [openAbstract, setOpenAbstract] = useState({});
  const [cpcStats, setCpcStats] = useState({});
  const [cpcHumanMap, setCpcHumanMap] = useState({});
  const [selectedCpcs, setSelectedCpcs] = useState([]);

  // Refinement loop
  const [lastIdea, setLastIdea] = useState(null);
  const [lastCpcSuggestions, setLastCpcSuggestions] = useState([]);

  // After-first-search UX
  const [hasSearched, setHasSearched] = useState(false);
  const [showRefinePanel, setShowRefinePanel] = useState(false);

  // Sticky bar query (mirrors main problem)
  const [stickyQuery, setStickyQuery] = useState("");

  // Overlay (Cmd/Ctrl+K)
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayQuery, setOverlayQuery] = useState("");

  // Result controls
  const [sortBy, setSortBy] = useState("relevance"); // relevance | newest | oldest
  const [minSim, setMinSim] = useState(0); // 0-100
  const [showAbstractPreview, setShowAbstractPreview] = useState(true);

  // Feedback UI state
  const [feedback, setFeedback] = useState({});

  // Global hotkey: Ctrl/Cmd+K
  useEffect(() => {
    const onKey = (e) => {
      const isK = (e.key || "").toLowerCase() === "k";
      const metaOrCtrl = e.metaKey || e.ctrlKey;
      if (metaOrCtrl && isK) {
        e.preventDefault();
        setOverlayQuery((stickyQuery || problem || "").trim());
        setOverlayOpen(true);
      }
      // also allow "/" to open overlay (like many search apps), optional:
      if (!metaOrCtrl && e.key === "/" && !overlayOpen) {
        // avoid stealing focus when typing in inputs/textareas
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

  const toggleInList = (value, list, setter) => {
    if (list.includes(value)) setter(list.filter((x) => x !== value));
    else setter([...list, value]);
  };

  const canSubmit = useMemo(() => problem.trim().length >= 10, [problem]);

  const visibleResults = useMemo(() => {
    const filtered = (results || []).filter((r) => pct(r.similarity_score) >= Number(minSim || 0));
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "newest") return (b.year || 0) - (a.year || 0);
      if (sortBy === "oldest") return (a.year || 0) - (b.year || 0);
      return (b.similarity_score || 0) - (a.similarity_score || 0);
    });
    return sorted;
  }, [results, sortBy, minSim]);

  const sortedCpcStats = useMemo(() => {
    const entries = Object.entries(cpcStats || {});
    entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    return entries;
  }, [cpcStats]);

  const makeSearchSummaryText = () => {
    const kw = splitCsvOrLines(keywords).slice(0, 12).join(", ");
    const ex = splitCsvOrLines(excludeKeywords).slice(0, 12).join(", ");
    const tech = (technologies || []).join(", ");
    const sel = (selectedCpcs || []).join(", ");
    return [
      `Problem: ${problem.trim()}`,
      novelty.trim() ? `Novelty: ${novelty.trim()}` : null,
      tech ? `Technologies: ${tech}` : null,
      domain ? `Domain: ${domain}` : null,
      kw ? `Keywords: ${kw}` : null,
      ex ? `Exclude: ${ex}` : null,
      assigneeFilter.trim() ? `Assignee: ${assigneeFilter.trim()}` : null,
      yearFrom ? `Year from: ${yearFrom}` : null,
      yearTo ? `Year to: ${yearTo}` : null,
      backendMode ? `Mode: ${backendMode}` : null,
      sel ? `CPC refine filters: ${sel}` : null,
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

  const scrollToForm = () => {
    if (!formRef.current) return;
    formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ----------------- core search runner ----------------- */
  const buildIdeaFromState = (overrideProblem) => {
    const idea = {
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
    };
    return idea;
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
    setSelectedCpcs([]);

    try {
      // 1) parse-input -> CPC suggestions
      const parseRes = await postJson(apiUrl("/parse-input"), idea);
      if (!parseRes.ok) throw new Error(`Parse input failed (${parseRes.status})`);

      const parseData = await parseRes.json();
      const cpc_suggestions = parseData.cpc_suggestions || [];

      setLastIdea(idea);
      setLastCpcSuggestions(cpc_suggestions);

      // 2) search
      const searchRes = await postJson(apiUrl("/search"), {
        idea,
        cpc_suggestions,
        cpc_filters: [],
      });

      if (!searchRes.ok) {
        const txt = await searchRes.text();
        console.error("Search error body:", txt);
        throw new Error(`Search failed (${searchRes.status})`);
      }

      const searchData = await searchRes.json();
      setInputSummary(searchData.input_summary || "");
      setCpcUsed(searchData.cpc_used || []);
      setBackendMode(searchData.backend_mode || "");
      setResults(searchData.results || []);
      setCpcStats(searchData.cpc_stats || {});
      setCpcHumanMap(searchData.cpc_human_map || {});

      setHasSearched(true);
      setShowRefinePanel(false);

      if (searchData.results?.[0]) {
        const k = `${searchData.results[0].publication_number}-0`;
        setOpenWhy((prev) => ({ ...prev, [k]: true }));
      }
    } catch (err) {
      console.error(err);
      setError(err?.message || "Something went wrong talking to the backend.");
    } finally {
      setIsLoading(false);
    }
  };

  const runSearchWithCpcs = async (nextSelectedCpcs) => {
    if (!lastIdea) return;
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setResults([]);
    setOpenWhy({});
    setOpenAbstract({});

    try {
      const searchRes = await postJson(apiUrl("/search"), {
        idea: lastIdea,
        cpc_suggestions: lastCpcSuggestions,
        cpc_filters: nextSelectedCpcs,
      });

      if (!searchRes.ok) {
        const txt = await searchRes.text();
        console.error("Search error body:", txt);
        throw new Error(`Search failed (${searchRes.status})`);
      }

      const searchData = await searchRes.json();
      setInputSummary(searchData.input_summary || "");
      setCpcUsed(searchData.cpc_used || []);
      setBackendMode(searchData.backend_mode || "");
      setResults(searchData.results || []);
      setCpcStats(searchData.cpc_stats || {});
      setCpcHumanMap(searchData.cpc_human_map || {});

      if (searchData.results?.[0]) {
        const k = `${searchData.results[0].publication_number}-0`;
        setOpenWhy((prev) => ({ ...prev, [k]: true }));
      }
    } catch (err) {
      console.error(err);
      setError(err?.message || "Something went wrong talking to the backend.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const idea = buildIdeaFromState();
    if (!idea.problem || idea.problem.length < 10) return;
    setStickyQuery(idea.problem);
    setOverlayQuery(idea.problem);
    await runFullSearch(idea);
  };

  const runSticky = async () => {
    const q = (stickyQuery || "").trim();
    if (q.length < 10) return;
    setProblem(q);
    const idea = buildIdeaFromState(q);
    await runFullSearch(idea);
  };

  const runOverlay = async () => {
    const q = (overlayQuery || "").trim();
    if (q.length < 10) return;
    setOverlayOpen(false);
    setProblem(q);
    setStickyQuery(q);
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
    setShowRefinePanel(true);
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

  const mode = modePill(backendMode);

  return (
    <main className="min-h-screen">
      {/* Search overlay */}
      <SearchOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        value={overlayQuery}
        setValue={setOverlayQuery}
        onRun={runOverlay}
        suggestions={SUGGESTIONS}
        isLoading={isLoading}
      />

      {/* Aurora background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900" />
        <div className="absolute -top-48 -left-32 h-[520px] w-[520px] rounded-full blur-3xl opacity-60 bg-gradient-to-br from-fuchsia-500 to-cyan-400" />
        <div className="absolute -top-24 -right-44 h-[520px] w-[520px] rounded-full blur-3xl opacity-50 bg-gradient-to-br from-indigo-500 to-fuchsia-500" />
        <div className="absolute bottom-[-260px] left-1/3 h-[560px] w-[560px] rounded-full blur-3xl opacity-50 bg-gradient-to-br from-cyan-400 to-lime-300" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] [background-size:22px_22px] opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/0 via-white/0 to-white/5" />
      </div>

      {/* Sticky search bar */}
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

                <button
                  type="button"
                  onClick={() => {
                    setShowRefinePanel((v) => !v);
                    setTimeout(() => scrollToForm(), 50);
                  }}
                  className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white/85 hover:bg-white/15"
                >
                  {showRefinePanel ? "Hide refine" : "Refine"}
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

      {/* Header */}
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

      {/* Content */}
      <div className="mx-auto max-w-6xl px-6 py-10 grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left: Form */}
        <section className="lg:col-span-2 space-y-4" ref={formRef}>
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
                <SummaryLine label="Novelty" value={truncateText(novelty, 120) || ""} />
                <SummaryLine label="Technologies" value={(technologies || []).join(", ")} />
                <SummaryLine label="Keywords" value={splitCsvOrLines(keywords).slice(0, 12).join(", ")} />
                <SummaryLine label="Exclude" value={splitCsvOrLines(excludeKeywords).slice(0, 12).join(", ")} />
                <SummaryLine label="Assignee" value={assigneeFilter.trim()} />
                <SummaryLine label="Years" value={yearFrom || yearTo ? `${yearFrom || "—"} → ${yearTo || "—"}` : ""} />
                <SummaryLine label="CPC filters" value={(selectedCpcs || []).join(", ")} />
              </div>
            </div>
          )}

          {/* Collapsible refine panel */}
          <div className={`${glassCard()} relative overflow-hidden`}>
            <GlowLine />
            <div className="p-6 border-b border-white/20">
              <SectionTitle
                title="Describe your idea"
                subtitle="We’ll find similar patents and explain why they match. Add refinements only if needed."
                right={
                  <button
                    type="button"
                    onClick={() => setShowRefinePanel((v) => !v)}
                    className="rounded-2xl border border-white/30 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                  >
                    {showRefinePanel ? "Collapse" : "Expand"}
                  </button>
                }
              />
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Problem */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  What problem are you solving?
                </label>
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

                {/* Query suggestions */}
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700 mb-2">Try an example:</div>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => useSuggestion(s.text, true)}
                        className="text-left"
                        title="Click to run this example"
                      >
                        <Chip tone={s.tone}>{s.label}</Chip>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setOverlayQuery((problem || "").trim());
                        setOverlayOpen(true);
                      }}
                      className="text-left"
                      title="Open overlay"
                    >
                      <Chip tone="default">Open Search Overlay</Chip>
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip tone="brand">Tip: add specific nouns</Chip>
                  <Chip tone="aqua">use exclusions for junk</Chip>
                  <Chip tone="lime">CPC refine later</Chip>
                </div>
              </div>

              {showRefinePanel && (
                <>
                  {/* What it does */}
                  <div>
                    <p className="block text-sm font-semibold text-slate-800 mb-2">What does it do?</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {["Automates process", "Analyzes data", "Reduces time", "Improves UX", "Hardware control"].map(
                        (label) => (
                          <TogglePill
                            key={label}
                            label={label}
                            checked={whatItDoes.includes(label)}
                            onChange={() => toggleInList(label, whatItDoes, setWhatItDoes)}
                          />
                        )
                      )}
                    </div>
                  </div>

                  {/* Domain + novelty */}
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

                  {/* Technologies */}
                  <div>
                    <p className="block text-sm font-semibold text-slate-800 mb-2">Key technologies</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {["AI/ML", "Cloud", "Mobile", "IoT", "Networking", "NLP", "Database"].map((tech) => (
                        <TogglePill
                          key={tech}
                          label={tech}
                          checked={technologies.includes(tech)}
                          onChange={() => toggleInList(tech, technologies, setTechnologies)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Power inputs */}
                  <div className="rounded-3xl border border-white/30 bg-white/55 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Refine search (optional)</p>
                        <p className="text-xs text-slate-600 mt-1">Keywords + exclusions have the biggest impact.</p>
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
                            max={50}
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
                              showAbstractPreview
                                ? "border-fuchsia-200 bg-fuchsia-50"
                                : "border-slate-200 bg-slate-50",
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
                </>
              )}

              {/* Submit */}
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

        {/* Right: Results */}
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

              {/* Enhanced loading banner */}
              {isLoading && (
                <div className="mt-4 rounded-3xl border border-white/25 bg-white/35 p-4 overflow-hidden relative">
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-fuchsia-500/10 via-cyan-400/10 to-lime-400/10" />
                  <div className="relative">
                    <div className="text-sm font-semibold text-slate-900">Searching PatentsView…</div>
                    <div className="text-xs text-slate-700 mt-1">
                      Ranking results by semantic similarity and applying anchor/keyword gates.
                    </div>
                    <div className="mt-3 h-2 w-full rounded-full bg-white/60 overflow-hidden">
                      <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-fuchsia-600 to-cyan-500 animate-[pulse_1.1s_ease-in-out_infinite]" />
                    </div>
                  </div>
                </div>
              )}

              {results.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Chip tone="default">{results.length} results</Chip>
                  {results?.[0] && <Chip tone="brand">Top match: {pct(results[0].similarity_score)}%</Chip>}
                </div>
              )}

              {/* CPC refinement */}
              {sortedCpcStats.length > 0 && (
                <div className="mt-5 rounded-3xl border border-white/30 bg-white/55 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Refine by CPC</p>
                      <p className="text-xs text-slate-600 mt-1">
                        CPC = patent category code. Clicking re-runs <code>/search</code> with <code>cpc_filters</code>.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCpcs([]);
                        runSearchWithCpcs([]);
                      }}
                      disabled={isLoading}
                      className="rounded-2xl border border-white/40 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {sortedCpcStats.slice(0, 12).map(([code, count]) => {
                      const checked = selectedCpcs.includes(code);
                      const human = (cpcHumanMap && cpcHumanMap[code]) || "Technical category";

                      return (
                        <button
                          key={code}
                          type="button"
                          disabled={isLoading}
                          onClick={() => {
                            const next = checked ? selectedCpcs.filter((x) => x !== code) : [...selectedCpcs, code];
                            setSelectedCpcs(next);
                            runSearchWithCpcs(next);
                          }}
                          className={[
                            "flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition",
                            checked
                              ? "border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 to-cyan-50 text-slate-900"
                              : "border-white/40 bg-white/75 text-slate-800 hover:bg-white",
                          ].join(" ")}
                          aria-pressed={checked}
                        >
                          <div className="min-w-0">
                            <div className="font-extrabold tracking-tight text-sm">{code}</div>
                            <div className="text-xs text-slate-600 truncate">{human}</div>
                          </div>
                          <div className="text-xs font-semibold text-slate-600">{count}</div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedCpcs.length > 0 && (
                    <p className="mt-3 text-xs text-slate-600">
                      Active CPC filters: <span className="font-semibold">{selectedCpcs.join(", ")}</span>
                    </p>
                  )}
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
                  <p className="text-sm font-semibold text-slate-900">No results yet</p>
                  <p className="text-sm text-slate-700 mt-2">Try keywords + exclusions, then refine by CPC.</p>
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <>
                  {/* Controls */}
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
                  </div>

                  {/* Cards */}
                  <div className="space-y-4">
                    {visibleResults.map((patent, idx) => {
                      const key = `${patent.publication_number}-${idx}`;
                      const p = pct(patent.similarity_score);
                      const url = patent.google_patents_url || patentUrl(patent.publication_number);
                      const conf = confidenceLabel(p);
                      const fb = feedback[key] || { vote: null, comment: "", submitted: false, status: "" };
                      const abstract = (patent.abstract_snippet || patent.abstract || patent.patent_abstract || "").trim();

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
                              <h3 className="text-base sm:text-lg font-semibold text-slate-900 leading-snug">
                                {patent.title}
                              </h3>

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
                                <Chip tone="aqua">{patent.cpc_label}</Chip>
                                <span
                                  className={[
                                    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                                    conf.tone,
                                  ].join(" ")}
                                >
                                  <span className={`mr-2 h-2 w-2 rounded-full ${conf.dot}`} />
                                  {conf.label}
                                </span>
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
                                      <p className="leading-relaxed">{abstract}</p>
                                    ) : (
                                      <p className="leading-relaxed">{truncateText(abstract, 220)}</p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="sm:w-44">
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
                            </div>
                          </div>

                          {/* Why similar */}
                          <div className="mt-4">
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

                          {/* Feedback */}
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
            Tip: If you’re getting “printer / messaging” type patents, add those words to <b>Exclude keywords</b>.
          </p>
        </section>
      </div>
    </main>
  );
}
