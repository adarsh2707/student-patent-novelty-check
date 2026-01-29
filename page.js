"use client";

import { useMemo, useState } from "react";

// ---- Types that mirror the backend ----
type IdeaInput = {
  problem: string;
  what_it_does: string[];
  domain: string;
  technologies: string[];
  novelty?: string;
};

type PatentResult = {
  title: string;
  publication_number: string;
  year: number;
  assignee: string;
  similarity_score: number;
  cpc_label: string;
  why_similar: string[];
};

type SearchResponse = {
  input_summary: string;
  domain?: string;
  cpc_used: string[];
  results: PatentResult[];
};

const API_BASE = "http://127.0.0.1:8000";

function pct(score: number) {
  const p = Math.round((score || 0) * 100);
  return Math.max(0, Math.min(100, p));
}

function patentUrl(pub: string) {
  const clean = (pub || "").trim();
  if (!clean) return null;
  return `https://patents.google.com/patent/${encodeURIComponent(clean)}`;
}

function confidenceLabel(p: number) {
  if (p >= 75) return { label: "High confidence", tone: "bg-green-50 text-green-800 border-green-200" };
  if (p >= 55) return { label: "Medium confidence", tone: "bg-amber-50 text-amber-800 border-amber-200" };
  return { label: "Low confidence", tone: "bg-slate-50 text-slate-700 border-slate-200" };
}

function Chip({ children }: { children: any }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">
      {children}
    </span>
  );
}

function TogglePill({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
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

export default function HomePage() {
  // ----- Form state -----
  const [problem, setProblem] = useState("");
  const [whatItDoes, setWhatItDoes] = useState<string[]>([]);
  const [domain, setDomain] = useState("Software");
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [novelty, setNovelty] = useState("");

  // ----- UI state -----
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PatentResult[]>([]);
  const [inputSummary, setInputSummary] = useState<string>("");
  const [cpcUsed, setCpcUsed] = useState<string[]>([]);
  const [openWhy, setOpenWhy] = useState<Record<string, boolean>>({});

  // Feedback UI state (frontend-only for now)
  const [feedback, setFeedback] = useState<
    Record<
      string,
      { vote: "up" | "down" | null; comment: string; submitted: boolean }
    >
  >({});

  const toggleInList = (
    value: string,
    list: string[],
    setter: (v: string[]) => void
  ) => {
    if (list.includes(value)) setter(list.filter((x) => x !== value));
    else setter([...list, value]);
  };

  const canSubmit = useMemo(() => problem.trim().length >= 10, [problem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResults([]);
    setInputSummary("");
    setCpcUsed([]);
    setOpenWhy({});
    // keep feedback (optional). If you want to clear feedback every search, uncomment:
    // setFeedback({});

    const idea: IdeaInput = {
      problem: problem.trim(),
      what_it_does: whatItDoes,
      domain,
      technologies,
      novelty: novelty.trim() || undefined,
    };

    try {
      const parseRes = await fetch(`${API_BASE}/parse-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(idea),
      });

      if (!parseRes.ok) throw new Error(`Parse input failed (${parseRes.status})`);

      const parseData: { cpc_suggestions: string[] } = await parseRes.json();
      const cpc_suggestions = parseData.cpc_suggestions ?? [];

      const searchRes = await fetch(`${API_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, cpc_suggestions }),
      });

      if (!searchRes.ok) {
        const txt = await searchRes.text();
        console.error("Search error body:", txt);
        throw new Error(`Search failed (${searchRes.status})`);
      }

      const searchData: SearchResponse = await searchRes.json();
      setInputSummary(searchData.input_summary);
      setCpcUsed(searchData.cpc_used);
      setResults(searchData.results);

      // auto-open first "why similar"
      if (searchData.results?.[0]) {
        const k = `${searchData.results[0].publication_number}-0`;
        setOpenWhy((prev) => ({ ...prev, [k]: true }));
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong talking to the backend.");
    } finally {
      setIsLoading(false);
    }
  };

  const setVote = (key: string, vote: "up" | "down") => {
    setFeedback((prev) => ({
      ...prev,
      [key]: {
        vote,
        comment: prev[key]?.comment ?? "",
        submitted: false,
      },
    }));
  };

  const setComment = (key: string, comment: string) => {
    setFeedback((prev) => ({
      ...prev,
      [key]: {
        vote: prev[key]?.vote ?? null,
        comment,
        submitted: prev[key]?.submitted ?? false,
      },
    }));
  };

	const submitFeedback = async (key: string, patent: PatentResult) => {
	  const fb = feedback[key];
	  if (!fb?.vote) return;

	  try {
		const res = await fetch(`${API_BASE}/feedback`, {
		  method: "POST",
		  headers: { "Content-Type": "application/json" },
		  body: JSON.stringify({
			idea_problem: problem.trim(),
			idea_domain: domain,
			cpc_used: cpcUsed,
			publication_number: patent.publication_number,
			patent_title: patent.title,
			vote: fb.vote,
			comment: fb.comment || "",
		  }),
		});

		if (!res.ok) throw new Error(`Feedback failed (${res.status})`);

		setFeedback((prev) => ({
		  ...prev,
		  [key]: { ...prev[key], submitted: true },
		}));
	  } catch (e) {
		console.error(e);
		alert("Could not save feedback. Check backend console.");
	  }
	};


  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Header */}
      <div className="border-b bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">
            Student Patent Novelty Check
          </h1>
          <p className="text-slate-600 max-w-3xl mt-2">
            Describe your idea in plain language. We’ll map it to CPC areas and
            fetch potentially related patents, with a simple “why similar”
            explanation for each result.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10 grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left: Form */}
        <section className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Describe your idea</h2>
              <p className="text-sm text-slate-600 mt-1">
                Keep it specific. A strong problem statement improves retrieval quality.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
                <div className="mt-2 text-xs text-slate-500">
                  Tip: include the user, the pain, and the context.
                </div>
              </div>

              <div>
                <p className="block text-sm font-semibold text-slate-800 mb-2">
                  What does your idea do?
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    "Automates process",
                    "Analyzes data",
                    "Reduces time",
                    "Improves UX",
                    "Hardware control",
                  ].map((label) => (
                    <TogglePill
                      key={label}
                      label={label}
                      checked={whatItDoes.includes(label)}
                      onChange={() => toggleInList(label, whatItDoes, setWhatItDoes)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  Primary domain
                </label>
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
              </div>

              <div>
                <p className="block text-sm font-semibold text-slate-800 mb-2">
                  Key technologies
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {["AI/ML", "Cloud", "Mobile", "IoT", "Networking", "NLP", "Database"].map(
                    (tech) => (
                      <TogglePill
                        key={tech}
                        label={tech}
                        checked={technologies.includes(tech)}
                        onChange={() => toggleInList(tech, technologies, setTechnologies)}
                      />
                    )
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  What’s novel about your idea?{" "}
                  <span className="text-slate-400 font-medium">(optional)</span>
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  value={novelty}
                  onChange={(e) => setNovelty(e.target.value)}
                  placeholder="Uses UAV thermal + multispectral imaging with ML to detect stress before symptoms appear."
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || !canSubmit}
                  className={[
                    "w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition shadow-sm",
                    isLoading || !canSubmit
                      ? "bg-slate-300 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700",
                  ].join(" ")}
                >
                  {isLoading ? "Searching patents…" : "Find Similar Patents"}
                </button>

                <div className="mt-3 text-xs text-slate-500">
                  Run a few times and tighten the text — it’s a discovery workflow.
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
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
                      ? `${inputSummary} · Domain: ${domain || "N/A"}`
                      : isLoading
                      ? "Searching…"
                      : "Run a search to see results here."}
                  </p>
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
              {/* Skeleton loading */}
              {isLoading && (
                <div className="space-y-4">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              )}

              {!isLoading && results.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                  <p className="text-sm font-semibold text-slate-800">No results yet</p>
                  <p className="text-sm text-slate-600 mt-2">
                    Enter an idea on the left and click{" "}
                    <span className="font-medium">Find Similar Patents</span>.
                  </p>
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <div className="space-y-4">
                  {results.map((patent, idx) => {
                    const key = `${patent.publication_number}-${idx}`;
                    const p = pct(patent.similarity_score);
                    const url = patentUrl(patent.publication_number);
                    const conf = confidenceLabel(p);

                    const fb = feedback[key] || { vote: null, comment: "", submitted: false };

                    return (
                      <article
                        key={key}
                        className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5"
                      >
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
                              <Chip>CPC: {patent.cpc_label}</Chip>
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${conf.tone}`}>
                                {conf.label}
                              </span>
                            </div>
                          </div>

                          <div className="sm:w-44">
                            <p className="text-xs font-medium text-slate-500">Similarity</p>
                            <div className="mt-1 flex items-baseline justify-between">
                              <p className="text-2xl font-semibold text-slate-900">{p}%</p>
                              <p className="text-xs text-slate-500">{idx === 0 ? "Top match" : ""}</p>
                            </div>

                            <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-600"
                                style={{ width: `${p}%` }}
                              />
                            </div>

                            <p className="mt-2 text-xs text-slate-500">
                              Prototype score (will improve with better ranking).
                            </p>
                          </div>
                        </div>

                        {/* Why similar (collapsible) */}
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenWhy((prev) => ({ ...prev, [key]: !prev[key] }))
                            }
                            className="text-sm font-semibold text-slate-800 hover:text-slate-900"
                          >
                            {openWhy[key] ? "Hide" : "Show"} why this is similar
                          </button>

                          {openWhy[key] && patent.why_similar?.length > 0 && (
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

                        {/* Feedback UI */}
                        <div className="mt-5 border-t border-slate-100 pt-4">
                          <p className="text-sm font-semibold text-slate-900">
                            Quick feedback (helps improve matching)
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            For now this is stored in the UI only. Next step is saving it to the database.
                          </p>

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
                                !fb.vote || fb.submitted
                                  ? "bg-slate-300 cursor-not-allowed"
                                  : "bg-slate-900 hover:bg-slate-800",
                              ].join(" ")}
                            >
                              {fb.submitted ? "Feedback saved" : "Submit feedback"}
                            </button>

                            {fb.submitted && (
                              <span className="text-xs text-slate-500">
                                Thanks — captured for this session ✅
                              </span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-4">
            Note: Similarity is a prototype metric right now. Next phase is improving ranking
            (better CPC filtering + semantic embeddings) so matches feel truly relevant.
          </p>
        </section>
      </div>
    </main>
  );
}
