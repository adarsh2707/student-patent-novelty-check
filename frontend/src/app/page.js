"use client";

import { useMemo, useState } from "react";

/**
 * Backend base URL
 * - Local default: http://127.0.0.1:8000
 * - Override via frontend/.env.local: NEXT_PUBLIC_API_BASE_URL=https://your-render-url
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  ""
);

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
    return { label: "High confidence", tone: "bg-green-50 text-green-800 border-green-200" };
  if (p >= 55)
    return { label: "Medium confidence", tone: "bg-amber-50 text-amber-800 border-amber-200" };
  return { label: "Low confidence", tone: "bg-slate-50 text-slate-700 border-slate-200" };
}

function modePill(mode) {
  const m = (mode || "").toLowerCase();
  if (m.includes("live") || m.includes("patentsview")) {
    return { label: "LIVE", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" };
  }
  if (m.includes("error")) {
    return { label: "ERROR", tone: "bg-red-50 text-red-700 border-red-200" };
  }
  if (m.includes("mock")) {
    return { label: "MOCK", tone: "bg-slate-50 text-slate-700 border-slate-200" };
  }
  return { label: "MODE", tone: "bg-slate-50 text-slate-700 border-slate-200" };
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

/* ----------------- UI bits ----------------- */
function Chip({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">
      {children}
    </span>
  );
}

function TogglePill({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={[
        "group flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition",
        checked
          ? "border-blue-200 bg-blue-50 text-blue-800"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
      aria-pressed={checked}
    >
      <span className="font-medium">{label}</span>
      <span
        className={[
          "h-4 w-4 rounded-md border transition",
          checked ? "border-blue-300 bg-blue-600" : "border-slate-300 bg-white",
        ].join(" ")}
      />
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="h-5 w-3/4 bg-slate-200 rounded mb-2" />
          <div className="h-4 w-1/2 bg-slate-200 rounded mb-3" />
          <div className="flex gap-2">
            <div className="h-6 w-28 bg-slate-200 rounded-full" />
            <div className="h-6 w-20 bg-slate-200 rounded-full" />
          </div>
        </div>
        <div className="w-40">
          <div className="h-3 w-24 bg-slate-200 rounded mb-2" />
          <div className="h-7 w-16 bg-slate-200 rounded mb-3" />
          <div className="h-2 w-full bg-slate-200 rounded-full" />
        </div>
      </div>
      <div className="mt-4">
        <div className="h-4 w-40 bg-slate-200 rounded mb-2" />
        <div className="h-3 w-full bg-slate-200 rounded mb-2" />
        <div className="h-3 w-5/6 bg-slate-200 rounded mb-2" />
        <div className="h-3 w-2/3 bg-slate-200 rounded" />
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

export default function HomePage() {
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

  // Result controls
  const [sortBy, setSortBy] = useState("relevance"); // relevance | newest | oldest
  const [minSim, setMinSim] = useState(0); // 0-100
  const [showAbstractPreview, setShowAbstractPreview] = useState(true);

  // Feedback UI state
  const [feedback, setFeedback] = useState({});

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

  const makeSearchSummaryText = () => {
    const kw = splitCsvOrLines(keywords).slice(0, 12).join(", ");
    const ex = splitCsvOrLines(excludeKeywords).slice(0, 12).join(", ");
    const tech = (technologies || []).join(", ");
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResults([]);
    setInputSummary("");
    setCpcUsed([]);
    setBackendMode("");
    setOpenWhy({});
    setOpenAbstract({});

    const idea = {
      problem: problem.trim(),
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

    try {
      // 1) parse-input -> CPC suggestions
      const parseRes = await postJson(apiUrl("/parse-input"), idea);
      if (!parseRes.ok) throw new Error(`Parse input failed (${parseRes.status})`);

      const parseData = await parseRes.json();
      const cpc_suggestions = parseData.cpc_suggestions || [];

      // 2) search
      const searchRes = await postJson(apiUrl("/search"), { idea, cpc_suggestions });
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
        idea_problem: problem.trim(),
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
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Header */}
      <div className="border-b bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">
                Student Patent Novelty Check
              </h1>
              <p className="text-slate-600 max-w-3xl mt-2">
                Provide more detail → better retrieval. Use keywords and filters to steer the search.
              </p>

              <p className="text-xs text-slate-500 mt-2">
                API:{" "}
                <code className="px-1.5 py-0.5 rounded bg-slate-100 border">{API_BASE}</code>
              </p>
            </div>

            {/* Tiny header status */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={[
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                  mode.tone,
                ].join(" ")}
                title={backendMode || ""}
              >
                {mode.label}
                {backendMode ? ` · ${backendMode}` : ""}
              </span>

              <a
                href={apiUrl("/health")}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                title="Open backend health check"
              >
                Backend health
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10 grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left: Form */}
        <section className="lg:col-span-2 space-y-4">
          {(inputSummary || results.length > 0 || backendMode) && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Search summary</p>
                  <p className="text-xs text-slate-500 mt-1">Copy this into your notes or for debugging.</p>
                </div>
                <button
                  type="button"
                  onClick={copySummary}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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
                <SummaryLine
                  label="Years"
                  value={yearFrom || yearTo ? `${yearFrom || "—"} → ${yearTo || "—"}` : ""}
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Describe your idea</h2>
              <p className="text-sm text-slate-600 mt-1">
                More input usually improves relevance — especially keywords + exclusions.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Problem */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  What problem are you solving?
                </label>
                <textarea
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  rows={4}
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="Farmers need drone-based crop health monitoring using multispectral imaging to detect disease early across large fields."
                  required
                />
              </div>

              {/* What it does */}
              <div>
                <p className="block text-sm font-semibold text-slate-800 mb-2">What does your idea do?</p>
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

              {/* Domain */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">Primary domain</label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  <option value="Software">Software</option>
                  <option value="Robotics">Robotics</option>
                  <option value="MedTech">MedTech</option>
                  <option value="Other">Other</option>
                </select>
                <p className="text-xs text-slate-500 mt-2">
                  Tip: Domain doesn’t change semantic similarity much; keywords help more.
                </p>
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

              {/* Novelty */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  What’s novel about your idea? <span className="text-slate-400 font-medium">(optional)</span>
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  value={novelty}
                  onChange={(e) => setNovelty(e.target.value)}
                  placeholder="Uses UAV thermal + multispectral imaging with ML to detect stress before symptoms appear."
                />
              </div>

              {/* Power inputs */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Power inputs</p>
                    <p className="text-xs text-slate-600 mt-1">
                      These steer the search hard. Comma or new-line separated.
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                    Advanced
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Must-include keywords</label>
                    <textarea
                      className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      rows={2}
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="drone, multispectral, NDVI, crop stress, disease detection"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Exclude keywords</label>
                    <textarea
                      className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      rows={2}
                      value={excludeKeywords}
                      onChange={(e) => setExcludeKeywords(e.target.value)}
                      placeholder="printer, messaging, database"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Assignee (optional)</label>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        value={assigneeFilter}
                        onChange={(e) => setAssigneeFilter(e.target.value)}
                        placeholder="John Deere"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Max results</label>
                      <input
                        type="number"
                        min={3}
                        max={50}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        value={yearFrom}
                        onChange={(e) => setYearFrom(e.target.value)}
                        placeholder="2015"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Year to</label>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        value={yearTo}
                        onChange={(e) => setYearTo(e.target.value)}
                        placeholder="2025"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-slate-700">
                        Do you want results to show a short abstract preview?
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAbstractPreview((v) => !v)}
                        className={[
                          "relative inline-flex h-7 w-12 items-center rounded-full border transition",
                          showAbstractPreview ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50",
                        ].join(" ")}
                        aria-pressed={showAbstractPreview}
                        title="Works if backend returns abstract/snippet"
                      >
                        <span
                          className={[
                            "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition",
                            showAbstractPreview ? "translate-x-6" : "translate-x-1",
                          ].join(" ")}
                        />
                      </button>
                    </label>
                    <p className="text-[11px] text-slate-500 mt-2">
                      Note: This will only display if the backend returns <code>abstract</code> /{" "}
                      <code>abstract_snippet</code> in results.
                    </p>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="pt-1">
                <button
                  type="submit"
                  disabled={isLoading || !canSubmit}
                  className={[
                    "w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition shadow-sm",
                    isLoading || !canSubmit ? "bg-slate-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700",
                  ].join(" ")}
                >
                  {isLoading ? "Searching patents…" : "Find Similar Patents"}
                </button>

                {error && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <div className="font-semibold">Couldn’t reach the backend</div>
                    <div className="mt-1">{error}</div>
                    <div className="mt-2 text-xs text-red-700/90">
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
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-6 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Results</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    {results.length > 0
                      ? `${inputSummary} · Domain: ${domain || "N/A"}${backendMode ? ` · Mode: ${backendMode}` : ""}`
                      : isLoading
                      ? "Searching…"
                      : "Run a search to see results here."}
                  </p>

                  {(backendMode || results.length > 0) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={[
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                          mode.tone,
                        ].join(" ")}
                        title={backendMode}
                      >
                        {mode.label}
                        {backendMode ? ` · ${backendMode}` : ""}
                      </span>

                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {results.length} results
                      </span>

                      {cpcUsed?.length > 0 && (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {cpcUsed.length} CPC
                        </span>
                      )}

                      {results?.[0] && (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                          Top match: {pct(results[0].similarity_score)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {cpcUsed.length > 0 && (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Chip>CPC used</Chip>
                    {cpcUsed.map((c) => (
                      <Chip key={c}>{c}</Chip>
                    ))}
                  </div>
                )}
              </div>
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
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8">
                  <p className="text-sm font-semibold text-slate-800">No results yet</p>
                  <p className="text-sm text-slate-600 mt-2">
                    Fill the idea and run a search. If results look irrelevant, try:
                  </p>
                  <ul className="mt-4 space-y-2 text-sm text-slate-700">
                    <li className="flex gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-slate-300 flex-shrink-0" />
                      Add 3–6 <b>Must-include keywords</b> (specific nouns: “multispectral”, “NDVI”, “UAV”)
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-slate-300 flex-shrink-0" />
                      Put junk terms in <b>Exclude keywords</b> (printer, messaging, smartphone)
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-slate-300 flex-shrink-0" />
                      Expand year range or remove assignee filter
                    </li>
                  </ul>
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <>
                  {/* Result controls */}
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-700">Sort</label>
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
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
                            className="w-full"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => setMinSim(0)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    {visibleResults.length === 0 && (
                      <div className="mt-3 text-sm text-slate-600">
                        Nothing meets <b>{minSim}%</b> similarity. Lower the slider to see more.
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    {visibleResults.map((patent, idx) => {
                      const key = `${patent.publication_number}-${idx}`;
                      const p = pct(patent.similarity_score);
                      const url = patent.google_patents_url || patentUrl(patent.publication_number);
                      const conf = confidenceLabel(p);
                      const fb = feedback[key] || { vote: null, comment: "", submitted: false, status: "" };

                      const abstract = (
                        patent.abstract_snippet ||
                        patent.abstract ||
                        patent.patent_abstract ||
                        ""
                      ).trim();

                      return (
                        <article
                          key={key}
                          className="relative rounded-2xl border border-slate-200 bg-white shadow-sm p-5 transition hover:shadow-md hover:-translate-y-[1px]"
                        >
                          <div className="absolute -top-3 -left-3">
                            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">
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
                                <Chip>{patent.cpc_label}</Chip>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${conf.tone}`}
                                >
                                  {conf.label}
                                </span>
                              </div>

                              {showAbstractPreview && abstract && (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => setOpenAbstract((prev) => ({ ...prev, [key]: !prev[key] }))}
                                    className="text-sm font-semibold text-slate-800 hover:text-slate-900"
                                  >
                                    {openAbstract[key] ? "Hide" : "Show"} abstract preview
                                  </button>

                                  <div className="mt-2 text-sm text-slate-700">
                                    {openAbstract[key] ? (
                                      <p className="leading-relaxed">{abstract}</p>
                                    ) : (
                                      <p className="leading-relaxed">{truncateText(abstract, 220)}</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {showAbstractPreview && !abstract && (
                                <p className="mt-3 text-xs text-slate-500">
                                  Abstract preview is enabled, but the backend isn’t returning{" "}
                                  <code>abstract</code> / <code>abstract_snippet</code> yet.
                                </p>
                              )}
                            </div>

                            <div className="sm:w-44">
                              <p className="text-xs font-medium text-slate-500">Similarity</p>
                              <div className="mt-1 flex items-baseline justify-between">
                                <p className="text-2xl font-semibold text-slate-900">{p}%</p>
                                <p className="text-xs text-slate-500">
                                  {idx === 0 && sortBy === "relevance" ? "Top match" : ""}
                                </p>
                              </div>

                              <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full bg-blue-600" style={{ width: `${p}%` }} />
                              </div>
                            </div>
                          </div>

                          {/* Why similar */}
                          <div className="mt-4">
                            <button
                              type="button"
                              onClick={() => setOpenWhy((prev) => ({ ...prev, [key]: !prev[key] }))}
                              className="text-sm font-semibold text-slate-800 hover:text-slate-900"
                            >
                              {openWhy[key] ? "Hide" : "Show"} why similar
                            </button>

                            {openWhy[key] && (patent.why_similar || []).length > 0 && (
                              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                                {patent.why_similar.map((line, i) => (
                                  <li key={i} className="flex gap-2">
                                    <span className="mt-1 h-2 w-2 rounded-full bg-slate-300 flex-shrink-0" />
                                    <span>{line}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {/* Feedback */}
                          <div className="mt-5 border-t border-slate-100 pt-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Feedback</p>
                                <p className="text-xs text-slate-500 mt-1">Helps us learn what “relevant” means for students.</p>
                              </div>
                              {fb.status && <span className="text-xs text-slate-500">{fb.status}</span>}
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setVote(key, "up")}
                                className={[
                                  "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                                  fb.vote === "up"
                                    ? "border-green-200 bg-green-50 text-green-800"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                ].join(" ")}
                              >
                                👍 Relevant
                              </button>

                              <button
                                type="button"
                                onClick={() => setVote(key, "down")}
                                className={[
                                  "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                                  fb.vote === "down"
                                    ? "border-red-200 bg-red-50 text-red-700"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                ].join(" ")}
                              >
                                👎 Not relevant
                              </button>
                            </div>

                            <div className="mt-3">
                              <textarea
                                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                                  "rounded-xl px-4 py-2 text-sm font-semibold text-white transition",
                                  !fb.vote || fb.submitted ? "bg-slate-300 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800",
                                ].join(" ")}
                              >
                                {fb.submitted ? "Saved" : "Submit feedback"}
                              </button>

                              {fb.submitted && <span className="text-xs text-slate-500">Thanks ✅</span>}
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

          <p className="text-xs text-slate-500 mt-4">
            Tip: If you’re getting “printer / messaging” type patents, add those words to <b>Exclude keywords</b>.
          </p>
        </section>
      </div>
    </main>
  );
}
