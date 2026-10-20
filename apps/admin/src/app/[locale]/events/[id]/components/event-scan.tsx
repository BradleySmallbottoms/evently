'use client';

import { ScanSearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/list-state';
import { Card, CardContent } from '@/components/ui/card';
import { readScanView } from './scan-output';

const jsonClass = 'm-0 overflow-auto p-4 font-mono text-[0.8125rem] leading-normal whitespace-pre';

export function EventScan({ output }: { output: unknown }) {
  const t = useTranslations('EventEditor');
  const view = readScanView(output);
  if (!view) {
    return <EmptyState icon={ScanSearchIcon} title={t('scanEmpty')} />;
  }
  return (
    <div className="flex flex-col gap-6">
      {view.finalObject ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('scanResult')}</h2>
          <Card className="py-0">
            <CardContent className="p-0">
              <pre className={jsonClass}>{JSON.stringify(view.finalObject, null, 2)}</pre>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {view.reasoning ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('scanReasoning')}</h2>
          <Card>
            <CardContent className="whitespace-pre-wrap">{view.reasoning}</CardContent>
          </Card>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('scanFull')}</h2>
        <Card className="py-0">
          <CardContent className="p-0">
            <pre className={`${jsonClass} max-h-[70vh]`}>{view.full}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
