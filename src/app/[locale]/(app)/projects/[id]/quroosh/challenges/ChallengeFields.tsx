import { getTranslations } from 'next-intl/server';
import { Input, Label } from '@/components/ui';

/**
 * The fields of a challenge, shared by "new challenge" and its own page:
 * the booth, the topic, the day, the seconds per question and the most it
 * pays. `prefix` keeps the ids apart when two forms share a page.
 */
export async function ChallengeFields({
  prefix,
  values,
}: {
  prefix: string;
  values?: { booth: string; topic: string | null; day: string | null; seconds: number; maxPoints: number };
}) {
  const t = await getTranslations('quroosh.challenges.fields');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${prefix}-booth`}>{t('booth')}</Label>
        <Input id={`${prefix}-booth`} name="booth" required maxLength={120} defaultValue={values?.booth ?? ''} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-topic`}>{t('topic')}</Label>
        <Input id={`${prefix}-topic`} name="topic" maxLength={200} defaultValue={values?.topic ?? ''} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-day`}>{t('day')}</Label>
        <Input id={`${prefix}-day`} name="day" type="date" dir="ltr" defaultValue={values?.day ?? ''} />
        <p className="mt-1 text-xs text-ink-muted">{t('dayHint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor={`${prefix}-seconds`}>{t('seconds')}</Label>
          <Input
            id={`${prefix}-seconds`}
            name="seconds"
            type="number"
            inputMode="numeric"
            min={5}
            max={120}
            step={1}
            dir="ltr"
            required
            defaultValue={values?.seconds ?? 20}
          />
        </div>
        <div>
          <Label htmlFor={`${prefix}-points`}>{t('maxPoints')}</Label>
          <Input
            id={`${prefix}-points`}
            name="max_points"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000000}
            step={1}
            dir="ltr"
            required
            defaultValue={values?.maxPoints ?? 900}
          />
        </div>
      </div>
    </div>
  );
}
