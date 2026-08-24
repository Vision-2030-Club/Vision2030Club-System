'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
import { Alert, Button, Input, Label, Numeric } from '@/components/ui';
import { importMembersAction, type ImportReport } from '../actions';

const COLUMNS = [
  'email',
  'name_en',
  'name_ar',
  'student_id',
  'national_id',
  'team',
  'role',
  'phone',
  'college',
  'academic_level',
  'graduation_term',
  'projects',
];

/**
 * CSV import (spec §4).
 *
 * Parsing happens here; every rule lives in `import_members`. In particular
 * this component does no validation of its own — if it pre-checked national
 * IDs it would eventually disagree with the database, and the database is the
 * one that decides. The job here is to show the report it returns.
 */
export function ImportForm({ locale }: { locale: string }) {
  const t = useTranslations('admin');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [running, startRunning] = useTransition();

  const onFile = (file: File | undefined) => {
    setReport(null);
    setError(null);
    setRows([]);
    setRowCount(null);
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase(),
      complete: (parsed) => {
        if (parsed.errors.length) {
          setError(parsed.errors.map((e) => `${e.row}: ${e.message}`).join('\n'));
          return;
        }
        setRows(parsed.data);
        setRowCount(parsed.data.length);
      },
      error: (parseError) => setError(parseError.message),
    });
  };

  const run = () => {
    setError(null);
    startRunning(async () => {
      const response = await importMembersAction(locale, rows);
      if (response.error) setError(response.error);
      else setReport(response.result ?? null);
    });
  };

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(
    `${COLUMNS.join(',')}\n`,
  )}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{t('importColumns')}</p>

      <a href={template} download="members-template.csv" className="text-sm text-brand-600 underline">
        {t('downloadTemplate')}
      </a>

      <div>
        <Label htmlFor="csv">{t('importFile')}</Label>
        <Input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => onFile(event.target.files?.[0])}
        />
      </div>

      {rowCount !== null ? (
        <p className="text-sm text-ink-muted">{t('importRows', { count: rowCount })}</p>
      ) : null}

      <Button onClick={run} disabled={running || rows.length === 0}>
        {t('importRun')}
      </Button>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {report?.ok ? (
        <Alert tone="ok">
          {t('importResult', {
            created: report.created,
            updated: report.updated,
            links: report.project_links,
          })}
        </Alert>
      ) : null}

      {report && !report.ok ? (
        <div className="space-y-2">
          <Alert tone="danger">{t('importFailed')}</Alert>

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <tbody>
                {report.errors.map((problem, index) => (
                  <tr
                    key={`${problem.row}-${problem.field}-${index}`}
                    className="border-b border-line last:border-b-0"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                      {t('importRow', { row: problem.row })}
                    </td>
                    <td className="px-3 py-2 font-medium text-ink">{problem.field}</td>
                    <td className="px-3 py-2 text-ink-muted">{problem.reason}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {problem.value ? <Numeric>{problem.value}</Numeric> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
