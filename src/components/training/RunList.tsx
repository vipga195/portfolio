"use client";

import { FOCUS, SECONDARY_BUTTON } from "@/components/training/styles";
import type { Locale } from "@/i18n/config";
import type { TrainingLabText } from "@/i18n/dictionary";
import { formatNumber } from "@/lib/training/lab-model";
import type { RunStatus, RunSummary } from "@/lib/training/lab-model";

const BADGE: Record<RunStatus, string> = {
  queued: "border-neutral-600 text-neutral-300",
  running: "border-blue-500 text-blue-300",
  succeeded: "border-green-600 text-green-400",
  failed: "border-red-600 text-red-400",
  cancelled: "border-yellow-600 text-yellow-400",
};

type Props = {
  runs: RunSummary[] | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  text: TrainingLabText;
  lang: Locale;
};

function formatCreated(iso: string, lang: Locale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(date);
}

export default function RunList({ runs, selectedId, onSelect, text, lang }: Props): React.JSX.Element {
  if (runs === null) return <p className="text-sm text-neutral-400">{text.runs.loading}</p>;
  if (runs.length === 0) return <p className="text-sm text-neutral-400">{text.runs.empty}</p>;

  return (
    <ul className="space-y-3">
      {runs.map((run) => {
        const percent = run.episodesTotal > 0 ? Math.min(100, Math.round((run.episodesDone / run.episodesTotal) * 100)) : 0;
        const algorithmName = run.algorithm === "q-learning" || run.algorithm === "dqn" ? text.algorithms[run.algorithm].name : run.algorithm;
        const selected = run.id === selectedId;
        const progress = text.runs.progress(formatNumber(lang, run.episodesDone, 0), formatNumber(lang, run.episodesTotal, 0));
        return (
          <li key={run.id} className={`rounded-xl border p-4 ${selected ? "border-blue-500" : "border-neutral-800"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-neutral-100">#{run.id}{run.game !== "snake" && ` · ${run.game}`} · {algorithmName}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${BADGE[run.status]}`}>{text.status[run.status]}</span>
            </div>
            <p className="mt-1 text-xs text-neutral-400">{formatCreated(run.createdAt, lang)}</p>
            <div
              role="progressbar" aria-label={text.runs.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
              aria-valuetext={progress} className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800"
            >
              <div className="h-full bg-blue-600" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1 text-xs text-neutral-400">{progress}</p>
            {run.status === "failed" && run.error && <p className="mt-1 text-xs text-red-400">{text.runs.failedReason}: {run.error}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <button type="button" onClick={() => onSelect(run.id)} aria-pressed={selected} className={SECONDARY_BUTTON}>
                {selected ? text.runs.selected : text.runs.select}
              </button>
              {run.status === "succeeded" && (
                <a href={`/api/training/runs/${run.id}/brain`} rel="noopener" download className={`inline-flex min-h-11 items-center rounded-lg px-1 text-blue-400 underline hover:text-blue-300 ${FOCUS}`}>
                  {text.runs.downloadBrain}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
