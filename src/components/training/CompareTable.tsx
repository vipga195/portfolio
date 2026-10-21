"use client";

import { useId } from "react";

import { FOCUS } from "@/components/training/styles";
import type { Locale } from "@/i18n/config";
import type { TrainingLabText } from "@/i18n/dictionary";
import { buildComparison, formatNumber, parseGridSize } from "@/lib/training/lab-model";
import type { CompareEntry, ErrorKind, RunSummary } from "@/lib/training/lab-model";

export const MAX_COMPARE = 6;

type Props = {
  candidates: RunSummary[];
  checkedIds: number[];
  entries: CompareEntry[];
  baselines: CompareEntry[];
  // Runs whose details could not be loaded (after retries)
  failed: Record<number, ErrorKind>;
  onToggle: (id: number) => void;
  onRetry: (id: number) => void;
  text: TrainingLabText;
  lang: Locale;
};

const BEST = "font-semibold text-blue-300";
// Opaque so scrolled cells never show through the sticky first column
const STICKY = "sticky left-0 bg-neutral-950";

export default function CompareTable({ candidates, checkedIds, entries, baselines, failed, onToggle, onRetry, text, lang }: Props): React.JSX.Element {
  const id = useId();
  const comparison = buildComparison(entries, baselines);
  const limitReached = checkedIds.length >= MAX_COMPARE;
  const score = (value: number): string => formatNumber(lang, value, 1);
  const columnLabel = (label: string): string => {
    const size = parseGridSize(label);
    return size === null ? label : text.gridLabel(size);
  };

  if (candidates.length === 0 && baselines.length === 0) return <p className="text-sm text-neutral-400">{text.compare.empty}</p>;

  return (
    <div className="space-y-4">
      {candidates.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-neutral-200">{text.compare.pickTitle}</legend>
          <ul className="flex flex-wrap gap-x-2 gap-y-1">
            {candidates.map((run) => {
              const checked = checkedIds.includes(run.id);
              const error = failed[run.id];
              return (
                <li key={run.id} className="flex items-center">
                  <label htmlFor={`${id}-${run.id}`} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-neutral-300">
                    <input id={`${id}-${run.id}`} type="checkbox" className={`size-5 accent-blue-500 ${FOCUS}`} checked={checked} disabled={!checked && limitReached} onChange={() => onToggle(run.id)} />
                    #{run.id}
                  </label>
                  {checked && error && (
                    <span className="flex items-center gap-2 text-xs text-red-400">
                      {text.errors[error]}
                      <button type="button" onClick={() => onRetry(run.id)} className={`min-h-11 rounded-lg border border-neutral-700 px-3 text-neutral-200 ${FOCUS}`}>{text.compare.retry}</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {limitReached && <p className="mt-1 text-xs text-neutral-400">{text.compare.maxPicked(MAX_COMPARE)}</p>}
        </fieldset>
      )}

      {comparison.rows.length > 0 && (
        <div>
          <p id={`${id}-caption`} className="mb-2 text-sm text-neutral-300">{text.compare.caption} ({text.compare.avgBest})</p>
          <div role="region" aria-label={text.compare.caption} tabIndex={0} className={`overflow-x-auto rounded-xl border border-neutral-800 ${FOCUS}`}>
            <table aria-labelledby={`${id}-caption`} className="w-full min-w-max border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-300">
                  <th scope="col" className={`${STICKY} z-20 px-3 py-2 font-medium`}>{text.compare.run}</th>
                  {comparison.columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{columnLabel(column)}</th>)}
                  <th scope="col" className="px-3 py-2 font-medium">{text.compare.overall}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.key} className="border-b border-neutral-900 text-neutral-300">
                    <th scope="row" className={`${STICKY} z-10 px-3 py-2 font-medium`}>{row.label}</th>
                    {row.cells.map((cell, i) => (
                      <td key={comparison.columns[i]} className="whitespace-nowrap px-3 py-2">
                        {cell ? (
                          <>
                            <span className={cell.avgIsBest ? BEST : ""}>{score(cell.avg)}</span> / <span className={cell.bestIsBest ? BEST : ""}>{score(cell.best)}</span>
                            {(cell.avgIsBest || cell.bestIsBest) && <span className="sr-only"> ({text.compare.bestMark})</span>}
                          </>
                        ) : "-"}
                      </td>
                    ))}
                    <td className={`whitespace-nowrap px-3 py-2 ${row.overallIsBest ? BEST : ""}`}>
                      {score(row.overall)}
                      {row.overallIsBest && <span className="sr-only"> ({text.compare.bestMark})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
