"use client";

import { useId, useRef, useState } from "react";

import { INPUT, FOCUS } from "@/components/training/styles";
import type { TrainingLabText } from "@/i18n/dictionary";
import type { ParamKey } from "@/i18n/dictionary";
import { createRun } from "@/lib/training/lab-client";
import type { FetchFn } from "@/lib/training/lab-client";
import { validateForm } from "@/lib/training/lab-model";
import type { ApiErrorInfo, FieldError } from "@/lib/training/lab-model";
import { ALGORITHM_IDS, FIGHTER_ARCHETYPES, GAME_ID, fighterGameId, isAlgorithmId } from "@/lib/training/ui-schema";
import type { AlgorithmId, AlgorithmUi, FighterArchetype } from "@/lib/training/ui-schema";

type Props = {
  text: TrainingLabText;
  ui: Record<AlgorithmId, AlgorithmUi>;
  fetchFn: FetchFn;
  // id is null when the server accepted the run but the answer could not be read
  onCreated: (id: number | null) => void;
};

function defaultsFor(ui: AlgorithmUi): { episodes: string; params: Record<string, string> } {
  return { episodes: String(ui.defaultEpisodes), params: Object.fromEntries(ui.fields.map((f) => [f.key, String(f.default)])) };
}

function isParamKey(key: string, params: TrainingLabText["params"]): key is ParamKey {
  return Object.hasOwn(params, key);
}

export default function RunForm({ text, ui, fetchFn, onCreated }: Props): React.JSX.Element {
  const id = useId();
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("q-learning");
  const [values, setValues] = useState(() => defaultsFor(ui["q-learning"]));
  const [errors, setErrors] = useState<Record<string, FieldError>>({});
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const current = ui[algorithm];
  const [game, setGame] = useState<"snake" | "fighter">("snake");
  const [archetypes, setArchetypes] = useState<FighterArchetype[]>(["aggressive"]);
  const [archetypeError, setArchetypeError] = useState<string | null>(null);

  // Editing anything makes an old server error and a stale notice irrelevant
  const touched = (): void => {
    setApiError(null);
    setNotice(null);
    setArchetypeError(null);
  };

  const changeAlgorithm = (value: string): void => {
    if (!isAlgorithmId(value)) return;
    setAlgorithm(value);
    setValues(defaultsFor(ui[value]));
    setErrors({});
    touched();
  };

  const changeGame = (value: string): void => {
    if (value !== "snake" && value !== "fighter") return;
    setGame(value);
    if (value === "fighter") changeAlgorithm("dqn");
    else changeAlgorithm("q-learning");
  };

  const toggleArchetype = (archetype: FighterArchetype): void => {
    edit(() => setArchetypes((prev) => (prev.includes(archetype) ? prev.filter((a) => a !== archetype) : [...prev, archetype])));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    touched();
    const result = validateForm(algorithm, { episodes: values.episodes, params: values.params });
    if (!result.ok) {
      setErrors(result.errors);
      // Move focus to the first invalid field, in form order
      const order = ["episodes", ...current.fields.map((f) => f.key)];
      const first = order.find((key) => result.errors[key]);
      if (first) inputs.current[first]?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);
    if (game === "snake") {
      const response = await createRun(fetchFn, { game: GAME_ID, algorithm, episodes: result.episodes, params: result.params });
      setSubmitting(false);
      if (response.ok) {
        setNotice(response.data.id === null ? text.form.createdUnknown : text.form.queued(response.data.id));
        onCreated(response.data.id);
      } else if (response.kind !== "aborted") {
        setApiError(response);
      }
      return;
    }
    if (archetypes.length === 0) {
      setArchetypeError(text.form.archetypeNone);
      setSubmitting(false);
      return;
    }
    const queued: string[] = [];
    let lastId: number | null = null;
    let failure: ApiErrorInfo | null = null;
    for (const archetype of FIGHTER_ARCHETYPES.filter((a) => archetypes.includes(a))) {
      const response = await createRun(fetchFn, { game: fighterGameId(archetype), algorithm, episodes: result.episodes, params: result.params });
      if (!response.ok) {
        if (response.kind !== "aborted") failure = response;
        break;
      }
      lastId = response.data.id;
      queued.push(response.data.id === null ? text.form.createdUnknown : text.form.queued(response.data.id));
    }
    setSubmitting(false);
    if (queued.length > 0) {
      setNotice(queued.join(" "));
      onCreated(lastId);
    }
    if (failure) setApiError(failure);
  };

  const fieldError = (key: string): string | null => {
    const error = errors[key];
    if (!error) return null;
    return error.code === "out_of_range" ? text.fieldErrors.out_of_range(error.min, error.max) : text.fieldErrors[error.code];
  };

  const edit = (update: () => void): void => {
    update();
    touched();
  };

  const episodeError = fieldError("episodes");
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <h2 className="text-xl font-semibold text-neutral-100">{text.form.title}</h2>

      <div>
        <label htmlFor={`${id}-game`} className="mb-2 block text-sm font-medium text-neutral-200">{text.form.game}</label>
        <select id={`${id}-game`} value={game} onChange={(e) => changeGame(e.target.value)} className={INPUT} disabled={submitting}>
          <option value="snake">{text.form.gameSnake}</option>
          <option value="fighter">{text.form.gameFighter}</option>
        </select>
      </div>

      {game === "snake" && (
        <div>
          <label htmlFor={`${id}-alg`} className="mb-2 block text-sm font-medium text-neutral-200">{text.form.algorithm}</label>
          <select id={`${id}-alg`} value={algorithm} onChange={(e) => changeAlgorithm(e.target.value)} className={INPUT} disabled={submitting}>
            {ALGORITHM_IDS.map((key) => (
              <option key={key} value={key}>{text.algorithms[key].name}</option>
            ))}
          </select>
          <p className="mt-2 text-sm text-neutral-400">{text.algorithms[algorithm].description}</p>
        </div>
      )}

      {game === "fighter" && (
        <fieldset className="space-y-2" disabled={submitting}>
          <legend className="mb-2 text-sm font-medium text-neutral-200">{text.form.archetypes}</legend>
          {FIGHTER_ARCHETYPES.map((archetype) => (
            <label key={archetype} className="flex min-h-11 items-center gap-3 text-sm text-neutral-200">
              <input type="checkbox" checked={archetypes.includes(archetype)} onChange={() => toggleArchetype(archetype)} className={`h-5 w-5 accent-blue-500 ${FOCUS}`} />
              {text.form.archetypeNames[archetype]}
            </label>
          ))}
          <p className="text-sm text-neutral-400">{text.form.archetypesHint}</p>
        </fieldset>
      )}

      <div>
        <label htmlFor={`${id}-ep`} className="mb-2 block text-sm font-medium text-neutral-200">{text.form.episodes}</label>
        {/* Wrapping row: the slider takes a full row on narrow screens (w-full) and shares the row with the number box from sm up */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <input
            type="range" min={1} max={current.maxEpisodes} step={1} value={Number(values.episodes) || 1}
            onChange={(e) => edit(() => setValues({ ...values, episodes: e.target.value }))} aria-label={text.form.episodes}
            className={`h-11 w-full accent-blue-500 sm:min-w-48 sm:flex-1 sm:basis-0 sm:w-auto ${FOCUS}`} disabled={submitting}
          />
          <input
            id={`${id}-ep`} ref={(el) => { inputs.current.episodes = el; }} type="number" inputMode="numeric" min={1} max={current.maxEpisodes} step={1} value={values.episodes}
            onChange={(e) => edit(() => setValues({ ...values, episodes: e.target.value }))} className={`${INPUT} w-32`} disabled={submitting}
            aria-invalid={episodeError !== null} aria-describedby={`${id}-ep-hint`}
          />
        </div>
        <p id={`${id}-ep-hint`} className={`mt-2 text-sm ${episodeError ? "text-red-400" : "text-neutral-400"}`}>{episodeError ?? text.form.episodesHint(current.maxEpisodes)}</p>
      </div>

      <fieldset className="space-y-4" disabled={submitting}>
        <legend className="mb-2 text-sm font-medium text-neutral-200">{text.form.paramsTitle}</legend>
        {current.fields.map((field) => {
          const label = isParamKey(field.key, text.params) ? text.params[field.key] : { label: field.key, help: "" };
          const error = fieldError(field.key);
          return (
            <div key={field.key}>
              <label htmlFor={`${id}-${field.key}`} className="mb-1 block text-sm text-neutral-200">{label.label}</label>
              <input
                id={`${id}-${field.key}`} ref={(el) => { inputs.current[field.key] = el; }} type="number" inputMode="decimal" min={field.min} max={field.max} step={field.step}
                value={values.params[field.key] ?? ""} className={`${INPUT} w-40`} aria-invalid={error !== null} aria-describedby={`${id}-${field.key}-help`}
                onChange={(e) => edit(() => setValues({ ...values, params: { ...values.params, [field.key]: e.target.value } }))}
              />
              <p id={`${id}-${field.key}-help`} className={`mt-1 text-xs ${error ? "text-red-400" : "text-neutral-400"}`}>{error ?? label.help}</p>
            </div>
          );
        })}
      </fieldset>

      <button type="submit" disabled={submitting} className={`min-h-11 rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`}>
        {submitting ? text.form.submitting : text.form.submit}
      </button>

      <div className="min-h-6 text-sm">
        <p role="alert" className="text-red-400">
          {archetypeError && <>{archetypeError}</>}
          {apiError && (
            <>
              {text.errors[apiError.kind]}
              {apiError.retryAfterSeconds !== undefined && ` ${text.retryIn(apiError.retryAfterSeconds)}`}
            </>
          )}
        </p>
        <p role="status" aria-live="polite" className="text-green-400">{notice}</p>
      </div>
    </form>
  );
}
