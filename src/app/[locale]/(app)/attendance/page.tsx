import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDateTime, localized, toDateTimeInput } from '@/lib/format';
import { recordAttendanceAction } from './actions';

const STATUS_TONES = {
  present: 'ok',
  absent: 'danger',
  excused: 'neutral',
  late: 'warn',
} as const;

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('attendance');
  const supabase = await createClient();

  /*
   * No filtering by role here. The select policy asks app.can('attendance.view',
   * p_owner => member_id), so this query returns exactly what the caller is
   * configured to see — nothing for most roles, everything for HR.
   */
  const [{ data: records }, { data: members }] = await Promise.all([
    supabase
      .from('attendance_records')
      .select('id, activity_name, occurred_at, status, note, members(name_en, name_ar)')
      .order('occurred_at', { ascending: false })
      .limit(200),
    supabase.from('members').select('id, name_en, name_ar').order('name_en'),
  ]);

  const canManage = await hasPermission('attendance.manage');

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {records?.length ? (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-surface-muted text-xs text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">{t('member')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('activity')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('occurredAt')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2 text-ink">
                        {localized(
                          record.members as unknown as Record<string, string>,
                          'name',
                          locale,
                        )}
                      </td>
                      <td className="px-4 py-2 text-ink-muted">{record.activity_name}</td>
                      <td className="px-4 py-2 text-ink-muted">
                        {formatDateTime(record.occurred_at, locale)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          tone={
                            STATUS_TONES[record.status as keyof typeof STATUS_TONES] ??
                            'neutral'
                          }
                        >
                          {t(
                            `status${String(record.status).charAt(0).toUpperCase()}${String(
                              record.status,
                            ).slice(1)}`,
                          )}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <div className="space-y-3">
              <EmptyState>{t('empty')}</EmptyState>
              <Alert tone="info">{t('restricted')}</Alert>
            </div>
          )}
        </div>

        {canManage ? (
          <Card>
            <h2 className="mb-3 font-semibold">{t('newRecord')}</h2>
            <ActionForm action={recordAttendanceAction} submitLabel={t('newRecord')}>
              <input type="hidden" name="locale" value={locale} />
              <div>
                <Label htmlFor="member_id">{t('member')}</Label>
                <Select id="member_id" name="member_id" required>
                  {(members ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {localized(member, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="activity_name">{t('activity')}</Label>
                <Input id="activity_name" name="activity_name" required />
              </div>
              <div>
                <Label htmlFor="occurred_at">{t('occurredAt')}</Label>
                <Input
                  id="occurred_at"
                  name="occurred_at"
                  type="datetime-local"
                  defaultValue={toDateTimeInput(new Date())}
                  required
                />
              </div>
              <div>
                <Label htmlFor="status">{t('status')}</Label>
                <Select id="status" name="status" defaultValue="present" required>
                  <option value="present">{t('statusPresent')}</option>
                  <option value="absent">{t('statusAbsent')}</option>
                  <option value="excused">{t('statusExcused')}</option>
                  <option value="late">{t('statusLate')}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="note">{t('note')}</Label>
                <Textarea id="note" name="note" rows={2} />
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
