'use client';

import type { AdoptionWindow } from '@/services/adoption/AdoptionService';
import type { WorkforceInventory } from '@/services/adoption/WorkforceService';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { WorkforceInventoryPanel } from '@/features/adoption/WorkforceInventoryPanel';
import { client } from '@/libs/Orpc';

export function WorkforcePerformance() {
  const t = useTranslations('WorkforceInventory');
  const [days, setDays] = useState<AdoptionWindow>(30);
  const [report, setReport] = useState<WorkforceInventory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void client.scorecard.workforce({ days }).then((result) => {
      if (current) {
        setReport(result);
      }
    }).catch(() => {
      if (current) {
        setFailed(true);
      }
    });
    return () => {
      current = false;
    };
  }, [days]);
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        {t('period')}
        <select
          value={days}
          onChange={(e) => {
            setReport(null);
            setFailed(false);
            setDays(Number(e.target.value) as AdoptionWindow);
          }}
          className="rounded border border-border bg-background px-3 py-2"
        >
          {[7, 30, 90].map(value => (
            <option key={value} value={value}>
              {value}
              d
            </option>
          ))}
        </select>
      </label>
      {failed ? <p role="alert">{t('failed')}</p> : report ? <WorkforceInventoryPanel report={report} /> : <p role="status">{t('loading')}</p>}
    </div>
  );
}
