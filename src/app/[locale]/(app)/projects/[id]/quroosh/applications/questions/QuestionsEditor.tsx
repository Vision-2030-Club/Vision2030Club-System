'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Card, EmptyState, Input, Label, Select, Textarea } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { ADDABLE_KINDS, CHOICE_KINDS, type FormOption, type FormQuestion, type Wording } from '@/lib/quroosh/form';
import { SECTION_KEYS, type QuestionKind, type SectionKey } from '@/lib/quroosh/questions';
import { moveQuestionAction, saveQuestionAction, setQuestionHiddenAction } from './actions';

/** The catalog's wording of one of the form's own questions, shown as what a manager's text replaces. */
export type DefaultWording = {
  label: Wording;
  hint: Wording;
  options: Record<string, Wording>;
};

type Props = {
  projectId: string;
  locale: string;
  form: FormQuestion[];
  defaults: Record<string, DefaultWording>;
  sectionTitles: Record<string, string>;
  editable: boolean;
};

/**
 * The questions editor (Quroosh 0004). Every question of the form, by
 * section, hidden ones included and marked: Edit opens its wording, help
 * line, required, choices and section; Hide takes it off the public form
 * without touching past answers; the arrows move it. There is deliberately
 * no delete, for questions or choices.
 */
export function QuestionsEditor({ projectId, locale, form, defaults, sectionTitles, editable }: Props) {
  const t = useTranslations('quroosh.questions');
  const [editing, setEditing] = useState<string | null>(null);
  const lang = locale === 'ar' ? 'ar' : 'en';
  const otherLang = lang === 'ar' ? 'en' : 'ar';

  const labelOf = (q: FormQuestion) =>
    q.label[lang] ?? defaults[q.key]?.label[lang] ?? q.label[otherLang] ?? q.key;

  return (
    <div className="space-y-8">
      {SECTION_KEYS.map((section) => {
        const questions = form.filter((q) => q.section === section);
        return (
          <section key={section} className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{sectionTitles[section]}</h2>
            {questions.length === 0 ? <EmptyState>{t('sectionEmpty')}</EmptyState> : null}
            {questions.map((q, index) => (
              <Card key={q.key} className={q.hidden ? 'space-y-3 border-dashed opacity-75' : 'space-y-3'}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{labelOf(q)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="brand">{t(`kind.${q.kind}`)}</Badge>
                      <Badge>{q.required ? t('required') : t('optional')}</Badge>
                      {q.hidden ? <Badge tone="warn">{t('hidden')}</Badge> : null}
                      {q.builtin ? null : <Badge tone="ok">{t('added')}</Badge>}
                      {q.locked ? <Badge>{t('locked')}</Badge> : null}
                    </div>
                  </div>
                  {editable ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      <InlineAction
                        action={moveQuestionAction}
                        fields={{ project_id: projectId, locale, key: q.key, direction: 'up' }}
                        label={t('moveUp')}
                        icon="↑"
                        disabled={index === 0}
                      />
                      <InlineAction
                        action={moveQuestionAction}
                        fields={{ project_id: projectId, locale, key: q.key, direction: 'down' }}
                        label={t('moveDown')}
                        icon="↓"
                        disabled={index === questions.length - 1}
                      />
                      {q.locked ? null : (
                        <InlineAction
                          action={setQuestionHiddenAction}
                          fields={{ project_id: projectId, locale, key: q.key, hidden: q.hidden ? 'false' : 'true' }}
                          label={q.hidden ? t('show') : t('hide')}
                        />
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditing(editing === q.key ? null : q.key)}
                        aria-expanded={editing === q.key}
                      >
                        {editing === q.key ? t('cancel') : t('edit')}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {editing === q.key ? (
                  <QuestionForm
                    key={JSON.stringify(q)}
                    projectId={projectId}
                    locale={locale}
                    question={q}
                    kind={q.kind}
                    defaults={defaults[q.key]}
                    sectionTitles={sectionTitles}
                    onDone={() => setEditing(null)}
                  />
                ) : null}
              </Card>
            ))}
          </section>
        );
      })}

      {editable ? <AddQuestion projectId={projectId} locale={locale} sectionTitles={sectionTitles} /> : null}
    </div>
  );
}

/** A one-button form (move, hide, show), with its refusal shown under it. */
function InlineAction({
  action,
  fields,
  label,
  icon,
  disabled,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  label: string;
  icon?: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, { ok: false });
  const message = useErrorText(state);
  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant={icon ? 'ghost' : 'secondary'}
        disabled={disabled || pending}
        aria-label={icon ? label : undefined}
        title={icon ? label : undefined}
        className={icon ? 'px-3' : undefined}
      >
        {icon ?? label}
      </Button>
      {message ? <p className="mt-1 text-xs text-danger">{message}</p> : null}
    </form>
  );
}

function useErrorText(state: ActionResult): string | null {
  const t = useTranslations('quroosh.questions');
  if (state.ok || !state.error) return null;
  return state.hint && t.has(`errors.${state.hint}`) ? t(`errors.${state.hint}`) : state.error;
}

/** Adds a question: its kind and section first, then the same fields as editing one. */
function AddQuestion({
  projectId,
  locale,
  sectionTitles,
}: {
  projectId: string;
  locale: string;
  sectionTitles: Record<string, string>;
}) {
  const t = useTranslations('quroosh.questions');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QuestionKind>('text');
  const [round, setRound] = useState(0);
  const [added, setAdded] = useState(false);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{t('addTitle')}</h2>
        <Button
          type="button"
          variant={open ? 'secondary' : 'primary'}
          onClick={() => {
            setOpen(!open);
            setAdded(false);
          }}
        >
          {open ? t('cancel') : t('add')}
        </Button>
      </div>
      {added && !open ? <Alert tone="ok">{t('addedNote')}</Alert> : null}
      {open ? (
        <>
          <div>
            <Label htmlFor="new-kind">{t('kindLabel')}</Label>
            <Select id="new-kind" value={kind} onChange={(event) => setKind(event.target.value as QuestionKind)}>
              {ADDABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-muted">{t('kindHint')}</p>
          </div>
          <QuestionForm
            key={`${kind}-${round}`}
            projectId={projectId}
            locale={locale}
            kind={kind}
            sectionTitles={sectionTitles}
            onDone={() => {
              setRound((r) => r + 1);
              setOpen(false);
              setAdded(true);
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

type Draft = { value: string; en: string; ar: string; hidden: boolean };

/** A choice as the editor shows it: its own wording, else the catalog's (the form's own questions). */
const draftOf = (o: FormOption, fallback?: Wording): Draft => ({
  value: o.value,
  en: o.en ?? fallback?.en ?? '',
  ar: o.ar ?? fallback?.ar ?? '',
  hidden: o.hidden,
});

/** Wording left as the catalog has it is sent empty, so it keeps following the catalog. */
const unlessDefault = (value: string, fallback: string | null | undefined) =>
  fallback && value.trim() === fallback.trim() ? '' : value;

/** The fields of one question, new (no `question`) or existing. Sent as one JSON field. */
function QuestionForm({
  projectId,
  locale,
  question,
  kind,
  defaults,
  sectionTitles,
  onDone,
}: {
  projectId: string;
  locale: string;
  question?: FormQuestion;
  kind: QuestionKind;
  defaults?: DefaultWording;
  sectionTitles: Record<string, string>;
  onDone: () => void;
}) {
  const t = useTranslations('quroosh.questions');
  const builtin = question?.builtin ?? false;
  const locked = question?.locked ?? false;
  const id = question?.key ?? 'new';

  // The form's own questions open with the wording they show today, ready to edit.
  const [labelEn, setLabelEn] = useState(question?.label.en ?? defaults?.label.en ?? '');
  const [labelAr, setLabelAr] = useState(question?.label.ar ?? defaults?.label.ar ?? '');
  const [hintEn, setHintEn] = useState(question?.hint.en ?? defaults?.hint.en ?? '');
  const [hintAr, setHintAr] = useState(question?.hint.ar ?? defaults?.hint.ar ?? '');
  const [section, setSection] = useState<SectionKey>(question?.section ?? 'quroosh');
  const [required, setRequired] = useState(question?.required ?? false);
  const [options, setOptions] = useState<Draft[]>(
    question ? question.options.map((o) => draftOf(o, defaults?.options[o.value])) : CHOICE_KINDS.has(kind) ? [{ value: '', en: '', ar: '', hidden: false }] : [],
  );
  const [min, setMin] = useState(question?.min?.toString() ?? '');
  const [max, setMax] = useState(question?.max?.toString() ?? '');

  const [state, formAction, pending] = useActionState<ActionResult, FormData>(async (previous, formData) => {
    const result = await saveQuestionAction(previous, formData);
    if (result.ok) onDone();
    return result;
  }, { ok: false });
  const message = useErrorText(state);

  const payload = JSON.stringify({
    key: question?.key ?? '',
    kind,
    section,
    required,
    label: { en: unlessDefault(labelEn, defaults?.label.en), ar: unlessDefault(labelAr, defaults?.label.ar) },
    hint: { en: unlessDefault(hintEn, defaults?.hint.en), ar: unlessDefault(hintAr, defaults?.hint.ar) },
    options: options.map((o) => ({
      ...o,
      en: unlessDefault(o.en, defaults?.options[o.value]?.en),
      ar: unlessDefault(o.ar, defaults?.options[o.value]?.ar),
    })),
    min,
    max,
  });

  const setOption = (index: number, change: Partial<Draft>) =>
    setOptions((all) => all.map((o, i) => (i === index ? { ...o, ...change } : o)));

  const isConsent = kind === 'consent';
  const showOptions = CHOICE_KINDS.has(kind) || kind === 'yesno';
  const placeholder = (text: string | null | undefined) => (builtin && text ? text : undefined);

  return (
    <form action={formAction} className="space-y-4 border-t border-line pt-4">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="question" value={payload} />

      {builtin ? <p className="text-xs text-ink-muted">{t('builtinNote')}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-label-ar`}>{t('labelAr')}</Label>
          <Textarea
            id={`${id}-label-ar`}
            dir="rtl"
            rows={2}
            maxLength={1000}
            value={labelAr}
            onChange={(e) => setLabelAr(e.target.value)}
            placeholder={placeholder(defaults?.label.ar)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-label-en`}>{t('labelEn')}</Label>
          <Textarea
            id={`${id}-label-en`}
            dir="ltr"
            rows={2}
            maxLength={1000}
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            placeholder={placeholder(defaults?.label.en)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-hint-ar`}>{isConsent ? t('statementAr') : t('hintAr')}</Label>
          <Textarea
            id={`${id}-hint-ar`}
            dir="rtl"
            rows={2}
            maxLength={2000}
            value={hintAr}
            onChange={(e) => setHintAr(e.target.value)}
            placeholder={placeholder(defaults?.hint.ar)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-hint-en`}>{isConsent ? t('statementEn') : t('hintEn')}</Label>
          <Textarea
            id={`${id}-hint-en`}
            dir="ltr"
            rows={2}
            maxLength={2000}
            value={hintEn}
            onChange={(e) => setHintEn(e.target.value)}
            placeholder={placeholder(defaults?.hint.en)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-section`}>{t('section')}</Label>
          <Select id={`${id}-section`} value={section} onChange={(e) => setSection(e.target.value as SectionKey)}>
            {SECTION_KEYS.map((key) => (
              <option key={key} value={key}>
                {sectionTitles[key]}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={required}
            disabled={locked}
            onChange={(e) => setRequired(e.target.checked)}
            className="accent-brand-600"
          />
          {t('requiredLabel')}
        </label>
      </div>
      {locked ? <p className="text-xs text-ink-muted">{t('lockedNote')}</p> : null}

      {showOptions ? (
        <Fieldset legend={kind === 'yesno' ? t('yesNoLabels') : t('choices')}>
          {options.map((o, index) => {
            const fallback = defaults?.options[o.value];
            return (
              <div key={o.value || `new-${index}`} className={o.hidden ? 'space-y-2 opacity-60' : 'space-y-2'}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    dir="rtl"
                    maxLength={1000}
                    aria-label={t('choiceAr', { n: index + 1 })}
                    value={o.ar}
                    onChange={(e) => setOption(index, { ar: e.target.value })}
                    placeholder={placeholder(fallback?.ar) ?? t('choiceAr', { n: index + 1 })}
                  />
                  <Input
                    dir="ltr"
                    maxLength={1000}
                    aria-label={t('choiceEn', { n: index + 1 })}
                    value={o.en}
                    onChange={(e) => setOption(index, { en: e.target.value })}
                    placeholder={placeholder(fallback?.en) ?? t('choiceEn', { n: index + 1 })}
                  />
                </div>
                {kind === 'yesno' ? null : (
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={o.hidden}
                      onChange={(e) => setOption(index, { hidden: e.target.checked })}
                      className="accent-brand-600"
                    />
                    {t('hideChoice')}
                  </label>
                )}
              </div>
            );
          })}
          {kind === 'yesno' ? null : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOptions((all) => [...all, { value: '', en: '', ar: '', hidden: false }])}
            >
              {t('addChoice')}
            </Button>
          )}
        </Fieldset>
      ) : null}

      {kind === 'checkboxes' ? (
        <div>
          <Label htmlFor={`${id}-max`}>{t('maxChoices')}</Label>
          <Input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            dir="ltr"
            className="w-28"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-muted">{t('maxChoicesHint')}</p>
        </div>
      ) : null}

      {kind === 'number' && !builtin ? (
        <div className="flex flex-wrap gap-3">
          <div>
            <Label htmlFor={`${id}-min`}>{t('min')}</Label>
            <Input
              id={`${id}-min`}
              type="number"
              step={1}
              dir="ltr"
              className="w-28"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-max-n`}>{t('max')}</Label>
            <Input
              id={`${id}-max-n`}
              type="number"
              step={1}
              dir="ltr"
              className="w-28"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <p className="text-xs text-ink-muted">{t('pastNote')}</p>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {question ? t('save') : t('add')}
      </Button>
    </form>
  );
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
      <legend className="px-1 text-sm font-medium text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}
