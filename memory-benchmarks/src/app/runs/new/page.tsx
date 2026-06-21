"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";

const BENCHMARKS = [
  {
    id: "locomo",
    name: "LOCOMO-10",
    description: "Multi-session dialogue memory benchmark",
    stats: ["10 conversations", "~300 questions", "4 categories"],
  },
  {
    id: "longmemeval",
    name: "LongMemEval",
    description: "Diverse long-term memory evaluation tasks",
    stats: ["500 questions", "6 types", "multi-session reasoning"],
  },
  {
    id: "beam",
    name: "BEAM",
    description: "Everyday AI memory with large-scale chat histories",
    stats: ["100 convs per size", "20 questions each", "10 memory abilities"],
  },
] as const;

const INPUT_CLASS =
  "w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400";
const SELECT_CLASS =
  "w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400";

function NewRunForm() {
  const router = useRouter();
  const [selectedBenchmark, setSelectedBenchmark] = useState<string>("");
  const [projectName, setProjectName] = useState("");

  // Model config
  const [answererModel, setAnswererModel] = useState("gpt-4o");
  const [judgeModel, setJudgeModel] = useState("gpt-4o");
  const [provider, setProvider] = useState("openai");
  const [judgeProvider, setJudgeProvider] = useState("");

  // Retrieval config
  const [topK, setTopK] = useState(200);
  const [topKCutoffs, setTopKCutoffs] = useState("10,20,50,200");

  // Benchmark-specific - LOCOMO
  const [locomoConvs, setLocomoConvs] = useState<number[]>([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);

  // Benchmark-specific - LongMemEval
  const [lmeMode, setLmeMode] = useState<"retrieval" | "answerer">("answerer");
  const [lmeAllQuestions, setLmeAllQuestions] = useState(true);
  const [lmePerType, setLmePerType] = useState(20);

  // Benchmark-specific - BEAM
  const [beamChatSizes, setBeamChatSizes] = useState<string[]>(["100K"]);
  const [beamConvStart, setBeamConvStart] = useState(0);
  const [beamConvEnd, setBeamConvEnd] = useState(10);

  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [envStr, setEnvStr] = useState("{}");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleConv(idx: number) {
    setLocomoConvs((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort()
    );
  }

  function toggleBeamSize(size: string) {
    setBeamChatSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const envOverrides = JSON.parse(envStr);

      const config: Record<string, unknown> = {
        answerer_model: answererModel,
        judge_model: judgeModel,
        provider,
        judge_provider: judgeProvider || provider,
        top_k: topK,
        top_k_cutoffs: topKCutoffs
          .split(",")
          .map((s) => parseInt(s.trim()))
          .filter((n) => !isNaN(n)),
      };

      if (selectedBenchmark === "locomo") {
        config.conversations = locomoConvs;
      } else if (selectedBenchmark === "longmemeval") {
        config.mode = lmeMode;
        config.all_questions = lmeAllQuestions;
        if (!lmeAllQuestions) config.per_type = lmePerType;
      } else if (selectedBenchmark === "beam") {
        config.chat_sizes = beamChatSizes;
        config.conv_start = beamConvStart;
        config.conv_end = beamConvEnd;
      }

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedBenchmark,
          project_name: projectName,
          config,
          env_overrides: envOverrides,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create run");
      }

      const run = await res.json();
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl animate-in">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-600 mb-6"
      >
        <ArrowLeft size={14} />
        Back
      </Link>

      <div className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          New Benchmark Run
        </h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Select a benchmark and configure your evaluation
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Benchmark selector */}
        <div className="grid grid-cols-3 gap-4">
          {BENCHMARKS.map((bench) => (
            <button
              key={bench.id}
              type="button"
              onClick={() => setSelectedBenchmark(bench.id)}
              className={`text-left rounded-xl border p-5 cursor-pointer transition-all duration-150 ${
                selectedBenchmark === bench.id
                  ? "border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-500/20"
                  : "bg-white hover:border-neutral-300"
              }`}
            >
              <div className="text-sm font-semibold text-neutral-900">
                {bench.name}
              </div>
              <p className="text-[13px] text-neutral-500 mt-2 leading-relaxed">
                {bench.description}
              </p>
              <div className="mt-3 space-y-0.5">
                {bench.stats.map((stat) => (
                  <div
                    key={stat}
                    className="text-[11px] text-neutral-400 font-mono"
                  >
                    {stat}
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* Configuration section */}
        {selectedBenchmark && (
          <div className="animate-in rounded-xl border bg-white p-6 space-y-6">
            {/* Project Name */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-neutral-700">
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className={INPUT_CLASS}
                placeholder="e.g. baseline-v1"
                required
              />
            </div>

            {/* Models */}
            <div className="space-y-3">
              <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Models
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs text-neutral-500">
                    Answerer Model
                  </label>
                  <input
                    type="text"
                    value={answererModel}
                    onChange={(e) => setAnswererModel(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-neutral-500">
                    Judge Model
                  </label>
                  <input
                    type="text"
                    value={judgeModel}
                    onChange={(e) => setJudgeModel(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-neutral-500">
                    Provider
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="azure">Azure</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-neutral-500">
                    Judge Provider
                  </label>
                  <select
                    value={judgeProvider}
                    onChange={(e) => setJudgeProvider(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Same as provider</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="azure">Azure</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Retrieval */}
            <div className="space-y-3">
              <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Retrieval
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs text-neutral-500">
                    Top K
                  </label>
                  <input
                    type="number"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value) || 0)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-neutral-500">
                    Top K Cutoffs
                  </label>
                  <input
                    type="text"
                    value={topKCutoffs}
                    onChange={(e) => setTopKCutoffs(e.target.value)}
                    className={`${INPUT_CLASS} font-mono`}
                    placeholder="10,20,50,200"
                  />
                </div>
              </div>
            </div>

            {/* Benchmark-specific: LOCOMO */}
            {selectedBenchmark === "locomo" && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                  LOCOMO Options
                </h3>
                <div>
                  <label className="block text-xs text-neutral-500 mb-2">
                    Conversations
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleConv(idx)}
                        className={`w-10 h-10 rounded-lg text-sm font-medium border transition-all ${
                          locomoConvs.includes(idx)
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                        }`}
                      >
                        {idx}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Benchmark-specific: LongMemEval */}
            {selectedBenchmark === "longmemeval" && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                  LongMemEval Options
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-neutral-500">
                      Mode
                    </label>
                    <select
                      value={lmeMode}
                      onChange={(e) =>
                        setLmeMode(e.target.value as "retrieval" | "answerer")
                      }
                      className={SELECT_CLASS}
                    >
                      <option value="answerer">Answerer</option>
                      <option value="retrieval">Retrieval</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-neutral-500">
                      Per Type Count
                    </label>
                    <input
                      type="number"
                      value={lmePerType}
                      onChange={(e) =>
                        setLmePerType(parseInt(e.target.value) || 0)
                      }
                      disabled={lmeAllQuestions}
                      className={`${INPUT_CLASS} disabled:bg-neutral-50 disabled:text-neutral-400`}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lmeAllQuestions}
                    onChange={(e) => setLmeAllQuestions(e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-neutral-700">
                    All Questions
                  </span>
                </label>
              </div>
            )}

            {/* Benchmark-specific: BEAM */}
            {selectedBenchmark === "beam" && (
              <div className="space-y-3">
                <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                  BEAM Options
                </h3>
                <div>
                  <label className="block text-xs text-neutral-500 mb-2">
                    Chat Sizes
                  </label>
                  <div className="flex gap-2">
                    {["100K", "500K", "1M", "10M"].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => toggleBeamSize(size)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                          beamChatSizes.includes(size)
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-neutral-500">
                      Conversation Start
                    </label>
                    <input
                      type="number"
                      value={beamConvStart}
                      onChange={(e) =>
                        setBeamConvStart(parseInt(e.target.value) || 0)
                      }
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-neutral-500">
                      Conversation End
                    </label>
                    <input
                      type="number"
                      value={beamConvEnd}
                      onChange={(e) =>
                        setBeamConvEnd(parseInt(e.target.value) || 0)
                      }
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Advanced */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 font-medium transition-colors"
              >
                {showAdvanced ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Environment overrides
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  <textarea
                    value={envStr}
                    onChange={(e) => setEnvStr(e.target.value)}
                    rows={5}
                    className={`${INPUT_CLASS} font-mono leading-relaxed`}
                    placeholder='{"MEM0_HOST": "http://localhost:8000"}'
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Submit section */}
        {selectedBenchmark && (
          <div className="flex items-center justify-between pt-2">
            <Link
              href="/"
              className="text-sm text-neutral-400 hover:text-neutral-600"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !selectedBenchmark || !projectName}
              className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
            >
              {submitting ? "Starting..." : "Start Run"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

export default function NewRunPage() {
  return (
    <Suspense
      fallback={
        <div className="text-neutral-500">Loading...</div>
      }
    >
      <NewRunForm />
    </Suspense>
  );
}
