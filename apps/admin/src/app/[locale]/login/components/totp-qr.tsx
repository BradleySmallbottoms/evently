'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function TotpQr({ otpauthUrl }: { otpauthUrl: string }) {
  const t = useTranslations('Login');
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: { dark: '#000000', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  return (
    <div className="flex min-h-[220px] min-w-[220px] items-center justify-center rounded-lg border bg-white p-3">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL from local QR encode
        <img src={dataUrl} alt={t('qrAlt')} width={220} height={220} />
      ) : (
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
