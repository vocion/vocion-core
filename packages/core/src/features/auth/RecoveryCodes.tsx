'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The ten recovery codes, shown once, with the two ways people keep them —
 * copy and download — and the one button that moves on.
 * @param props - The codes.
 * @param props.codes - The codes as minted.
 * @param props.onDone - Called when the person says they saved them.
 */
export function RecoveryCodes(props: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('TwoStep');
  const [copied, setCopied] = useState(false);
  const text = `${props.codes.join('\n')}\n`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('recovery_title')}</h2>
        <p className="text-sm text-muted-foreground">{t('recovery_intro')}</p>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border/60 bg-muted/40 p-4 font-mono text-sm" aria-label={t('recovery_title')}>
        {props.codes.map(code => <li key={code}>{code}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? t('recovery_copied') : t('recovery_copy')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          {t('recovery_download')}
        </Button>
      </div>
      <Button type="button" className="w-full" onClick={props.onDone}>
        {t('recovery_done')}
      </Button>
    </div>
  );
}
