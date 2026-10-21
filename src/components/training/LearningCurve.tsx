"use client";

import { useId, useMemo } from "react";

import type { Locale } from "@/i18n/config";
import type { TrainingLabText } from "@/i18n/dictionary";
import { buildCurve, formatNumber } from "@/lib/training/lab-model";
import type { Metric } from "@/lib/training/lab-model";

const BOX = { width: 640, height: 300, left: 48, right: 16, top: 16, bottom: 44 };
const AVG_COLOR = "#60a5fa";
const BEST_COLOR = "#fbbf24";
const AXIS_COLOR = "#737373";
const TEXT_COLOR = "#a3a3a3";

type Props = { metrics: Metric[]; text: TrainingLabText["curve"]; lang: Locale };

export default function LearningCurve({ metrics, text, lang }: Props): React.JSX.Element {
  const id = useId();
  const curve = useMemo(() => buildCurve(metrics, BOX), [metrics]);
  const last = [...metrics].filter((m) => Number.isFinite(m.episode)).sort((a, b) => a.episode - b.episode).at(-1);

  if (curve.pointCount === 0 || !last) {
    return <p className="text-sm text-neutral-400">{text.noData}</p>;
  }

  const right = BOX.width - BOX.right;
  const bottom = BOX.height - BOX.bottom;
  return (
    <figure>
      {/* The chart keeps a minimum width (560 px, so its 11 px text stays about 11 px) and scrolls sideways on narrow screens */}
      <div role="region" aria-label={text.title} tabIndex={0} className="overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
        <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="h-auto w-full min-w-[560px]">
          <title id={`${id}-t`}>{text.title}</title>
          <desc id={`${id}-d`}>{text.description}</desc>
          {curve.yTicks.map((tick) => (
            <g key={`y${tick.position}`}>
              <line x1={BOX.left} x2={right} y1={tick.position} y2={tick.position} stroke="#262626" strokeWidth={1} />
              <text x={BOX.left - 6} y={tick.position + 4} textAnchor="end" fontSize={11} fill={TEXT_COLOR}>{tick.label}</text>
            </g>
          ))}
          {curve.xTicks.map((tick) => (
            <text key={`x${tick.position}`} x={tick.position} y={bottom + 16} textAnchor="middle" fontSize={11} fill={TEXT_COLOR}>{tick.label}</text>
          ))}
          <line x1={BOX.left} x2={right} y1={bottom} y2={bottom} stroke={AXIS_COLOR} />
          <line x1={BOX.left} x2={BOX.left} y1={BOX.top} y2={bottom} stroke={AXIS_COLOR} />
          <text x={(BOX.left + right) / 2} y={BOX.height - 6} textAnchor="middle" fontSize={12} fill={TEXT_COLOR}>{text.xAxis}</text>
          <text x={12} y={(BOX.top + bottom) / 2} textAnchor="middle" fontSize={12} fill={TEXT_COLOR} transform={`rotate(-90 12 ${(BOX.top + bottom) / 2})`}>{text.yAxis}</text>
          {/* Best first and thicker, average on top and thinner: the best line stays visible where both coincide */}
          <path d={curve.bestPath} fill="none" stroke={BEST_COLOR} strokeWidth={3.5} strokeDasharray="8 5" />
          <path d={curve.avgPath} fill="none" stroke={AVG_COLOR} strokeWidth={1.75} />
          {curve.pointCount === 1 && (
            <>
              <circle cx={curve.bestPoints[0].x} cy={curve.bestPoints[0].y} r={5} fill={BEST_COLOR} />
              <circle cx={curve.avgPoints[0].x} cy={curve.avgPoints[0].y} r={3} fill={AVG_COLOR} />
            </>
          )}
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-300">
        <span className="inline-flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4" stroke={AVG_COLOR} strokeWidth={2} /></svg>
          {text.avg}
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4" stroke={BEST_COLOR} strokeWidth={3} strokeDasharray="8 5" /></svg>
          {text.best}
        </span>
      </figcaption>
      <p className="sr-only">{text.summary(formatNumber(lang, curve.pointCount, 0), formatNumber(lang, last.episode, 0), formatNumber(lang, last.avg, 1), formatNumber(lang, last.best, 1))}</p>
    </figure>
  );
}
