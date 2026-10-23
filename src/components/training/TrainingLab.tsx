"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import CompareTable, { MAX_COMPARE } from "@/components/training/CompareTable";
import LearningCurve from "@/components/training/LearningCurve";
import RunForm from "@/components/training/RunForm";
import RunList from "@/components/training/RunList";
import type { Locale } from "@/i18n/config";
import { DICTIONARIES } from "@/i18n/dictionary";
import { fetchBaseline, getRunDetail, listRuns } from "@/lib/training/lab-client";
import type { BaselineBrain, FetchFn } from "@/lib/training/lab-client";
import { isActive, pickInitialSelection } from "@/lib/training/lab-model";
import type { CompareEntry, ErrorKind, ReadGate, RunDetail } from "@/lib/training/lab-model";
import { createCompareFetcher, createDetailPoller, createListPoller } from "@/lib/training/pollers";
import type { Clock, CompareFetcher, DetailPoller, ListPoller, ListState, ReadError } from "@/lib/training/pollers";
import type { AlgorithmId, AlgorithmUi } from "@/lib/training/ui-schema";

// The text block holds functions, which cannot be passed from a server component, so the client reads it from the dictionary
const fetchFn: FetchFn = (input, init) => fetch(input, init);

const clock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),   // handles come from setTimer above
};

type Props = { lang: Locale; ui: Record<AlgorithmId, AlgorithmUi> };

export default function TrainingLab({ lang, ui }: Props): React.JSX.Element {
  const text = DICTIONARIES[lang].trainingLab;
  const [list, setList] = useState<ListState>({ runs: null, error: null });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, RunDetail>>({});
  const [detailError, setDetailError] = useState<ReadError | null>(null);
  const [compareErrors, setCompareErrors] = useState<Record<number, ErrorKind>>({});
  const [baseline, setBaseline] = useState<BaselineBrain[] | null>(null);
  const [userChecked, setUserChecked] = useState<number[] | null>(null);

  const detailsRef = useRef<Record<number, RunDetail>>({});
  const listPoller = useRef<ListPoller | null>(null);
  const detailPoller = useRef<DetailPoller | null>(null);
  const compareFetcher = useRef<CompareFetcher | null>(null);
  const autoSelected = useRef(false);

  const runs = list.runs;
  const selectedRun = runs?.find((r) => r.id === selectedId);
  const succeeded = useMemo(() => (runs ?? []).filter((r) => r.status === "succeeded"), [runs]);
  const checkedIds = useMemo(() => userChecked ?? succeeded.slice(0, 3).map((r) => r.id), [userChecked, succeeded]);
  const checkedKey = checkedIds.join(",");

  // ---- pollers: created once; they own all request timing (see src/lib/training/pollers.ts) ----
  useEffect(() => {
    const gate: ReadGate = { blockedUntil: 0 };
    const fetchDetail = (id: number, signal: AbortSignal): ReturnType<typeof getRunDetail> => getRunDetail(fetchFn, id, signal);
    const storeDetail = (detail: RunDetail): void => {
      detailsRef.current = { ...detailsRef.current, [detail.id]: detail };
      setDetails(detailsRef.current);
    };
    const isFinishedCached = (id: number): boolean => {
      const cached = detailsRef.current[id];
      return cached !== undefined && !isActive(cached.status);
    };

    const lp = createListPoller({ clock, gate, fetchList: (signal) => listRuns(fetchFn, 20, signal), fetchDetail, onChange: setList });
    const dp = createDetailPoller({
      clock, gate, fetchDetail, onDetail: storeDetail, isFinishedCached,
      onError: (_id, error) => setDetailError(error),
    });
    const cf = createCompareFetcher({
      clock, gate, fetchDetail, onDetail: storeDetail, isCached: isFinishedCached,
      onFailed: (id, error) => setCompareErrors((current) => {
        const next = { ...current };
        if (error) next[id] = error.kind;
        else delete next[id];
        return next;
      }),
    });
    listPoller.current = lp;
    detailPoller.current = dp;
    compareFetcher.current = cf;

    const onVisibility = (): void => {
      const visible = !document.hidden;
      lp.setVisible(visible);
      dp.setVisible(visible);
      cf.setVisible(visible);
    };
    document.addEventListener("visibilitychange", onVisibility);
    lp.start();
    if (document.hidden) lp.setVisible(false);

    const baselineController = new AbortController();
    void fetchBaseline(fetchFn, baselineController.signal).then(setBaseline);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      baselineController.abort();
      lp.stop();
      dp.stop();
      cf.destroy();
    };
  }, []);

  // ---- first load: select the active run, else the newest finished one ----
  useEffect(() => {
    if (autoSelected.current || runs === null || runs.length === 0) return;
    autoSelected.current = true;
    setSelectedId((current) => current ?? pickInitialSelection(runs));
  }, [runs]);

  // ---- detail of the selected run ----
  useEffect(() => {
    detailPoller.current?.select(selectedId, selectedRun?.status);
  }, [selectedId, selectedRun?.status]);

  // ---- comparison details: keyed only on the selected set, fetched once each, one at a time ----
  useEffect(() => {
    compareFetcher.current?.setSelected(checkedKey === "" ? [] : checkedKey.split(",").map(Number));
  }, [checkedKey]);

  const toggleChecked = (id: number): void => {
    setUserChecked(checkedIds.includes(id) ? checkedIds.filter((x) => x !== id) : [...checkedIds, id].slice(0, MAX_COMPARE));
  };

  const entries: CompareEntry[] = checkedIds.flatMap((id) => {
    const detail = details[id];
    const algorithm = detail?.algorithm;
    const name = algorithm === "q-learning" || algorithm === "dqn" ? text.algorithms[algorithm].name : "";
    return detail ? [{ key: `run:${id}`, label: `#${id} ${name}`.trim(), kind: "run" as const, evaluation: detail.evaluation }] : [];
  });
  const baselines: CompareEntry[] = (baseline ?? []).map((b) => ({
    key: `baseline:${b.algorithm}`,
    label: `${text.compare.baseline} (${b.algorithm === "q-learning" || b.algorithm === "dqn" ? text.algorithms[b.algorithm].name : b.algorithm}, ${text.compare.baselineNote})`,
    kind: "baseline" as const,
    evaluation: b.evaluation,
  }));

  const selectedDetail = selectedId === null ? undefined : details[selectedId];
  const headingClass = `text-3xl font-semibold text-neutral-100 text-balance ${lang === "ja" ? "break-keep" : ""}`;

  return (
    <div className="w-full space-y-10">
      <header className="space-y-3">
        <h1 className={headingClass}>{text.title}</h1>
        <p className="max-w-3xl text-neutral-300">{text.intro}</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
          <RunForm
            text={text}
            ui={ui}
            fetchFn={fetchFn}
            onCreated={(id) => {
              if (id !== null) {
                autoSelected.current = true;
                setSelectedId(id);
              }
              listPoller.current?.refreshSoon();
            }}
          />
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
          <h2 className="mb-4 text-xl font-semibold text-neutral-100">{text.runs.title}</h2>
          {list.error && (
            <p role="status" className="mb-3 text-sm text-yellow-400">
              {text.errors[list.error.kind]}
              {list.error.retryAfterSeconds !== undefined && ` ${text.retryIn(list.error.retryAfterSeconds)}`}
            </p>
          )}
          <RunList
            runs={runs}
            selectedId={selectedId}
            onSelect={(id) => {
              autoSelected.current = true;
              setSelectedId(id);
            }}
            text={text}
            lang={lang}
          />
        </section>
      </div>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
        <h2 className={`mb-4 text-xl font-semibold text-neutral-100 ${lang === "ja" ? "break-keep" : ""}`}>{text.curve.title}</h2>
        {detailError && (
          <p role="status" className="mb-3 text-sm text-yellow-400">
            {text.errors[detailError.kind]}
            {detailError.retryAfterSeconds !== undefined && ` ${text.retryIn(detailError.retryAfterSeconds)}`}
          </p>
        )}
        {selectedId === null ? <p className="text-sm text-neutral-400">{text.curve.pick}</p> : <LearningCurve metrics={selectedDetail?.metrics ?? []} text={text.curve} lang={lang} />}
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
        <h2 className={`mb-4 text-xl font-semibold text-neutral-100 ${lang === "ja" ? "break-keep" : ""}`}>{text.compare.title}</h2>
        <CompareTable
          candidates={succeeded}
          checkedIds={checkedIds}
          entries={entries}
          baselines={baselines}
          failed={compareErrors}
          onToggle={toggleChecked}
          onRetry={(id) => compareFetcher.current?.retry(id)}
          text={text}
          lang={lang}
        />
      </section>
    </div>
  );
}
