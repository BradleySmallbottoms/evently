'use client';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
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
    <Box
      sx={{
        p: 1.5,
        bgcolor: 'common.white',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        minHeight: 220,
        minWidth: 220,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL from local QR encode
        <img src={dataUrl} alt={t('qrAlt')} width={220} height={220} />
      ) : (
        <CircularProgress size={32} />
      )}
    </Box>
  );
}
