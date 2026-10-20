'use client';

import { ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/list-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  imageUrl: string | null;
  imageUrls: string[];
};

/** Hero first, then gallery photos stored for this event. */
export function EventImages({ imageUrl, imageUrls }: Props) {
  const t = useTranslations('EventEditor');
  const images = [imageUrl, ...imageUrls].filter((url): url is string => url != null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('images')}</CardTitle>
      </CardHeader>
      <CardContent>
      {images.length === 0 ? (
        <EmptyState icon={ImageIcon} title={t('imagesEmpty')} />
      ) : (
        <div className="flex flex-wrap gap-4">
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
        </div>
      )}
      </CardContent>
    </Card>
  );
}

function EventImage({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex w-40 flex-col gap-1">
      {failed ? null : (
        <img
          src={url}
          alt={label}
          onError={() => setFailed(true)}
          className="h-[120px] w-40 rounded-md bg-muted object-cover"
        />
      )}
      <p className="text-xs text-muted-foreground">{label}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs break-all underline underline-offset-4"
      >
        {url}
      </a>
    </div>
  );
}
