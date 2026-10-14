'use client';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

type Props = {
  imageUrl: string | null;
  imageUrls: string[];
};

/** Hero first, then gallery photos stored for this event. */
export function EventImages({ imageUrl, imageUrls }: Props) {
  const t = useTranslations('EventEditor');
  const images = [imageUrl, ...imageUrls].filter((url): url is string => url != null);

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="overline" color="text.secondary">
        {t('images')}
      </Typography>
      {images.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('imagesEmpty')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {images.map((url, index) => (
            <EventImage
              key={url}
              url={url}
              label={
                index === 0 && imageUrl
                  ? t('imageHero')
                  : t('imageGallery', { n: imageUrl ? index : index + 1 })
              }
            />
          ))}
        </Box>
      )}
    </Paper>
  );
}

function EventImage({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <Box sx={{ width: 160, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {failed ? null : (
        <Box
          component="img"
          src={url}
          alt={label}
          onError={() => setFailed(true)}
          sx={{
            width: 160,
            height: 120,
            objectFit: 'cover',
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        />
      )}
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Link href={url} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ wordBreak: 'break-all' }}>
        {url}
      </Link>
    </Box>
  );
}
