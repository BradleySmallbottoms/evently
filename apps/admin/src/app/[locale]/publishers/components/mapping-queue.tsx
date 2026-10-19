'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type TempPublisher = {
  id: string;
  name: string;
  slug: string;
  type: 'org' | 'person';
  eventCount: number;
  createdAt: string;
};

export function MappingQueue() {
  const t = useTranslations('PublisherMapping');
  const tApp = useTranslations('App');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [completeForms, setCompleteForms] = useState<
    Record<string, { name: string; slug: string; type: 'org' | 'person' }>
  >({});

  const list = useQuery({
    queryKey: ['admin-publishers-temporary'],
    queryFn: () =>
      adminFetch<{ items: TempPublisher[] }>('/publishers?temporary=true'),
    retry: false,
  });

  const map = useMutation({
    mutationFn: async (input: { id: string; targetPublisherId: string }) =>
      adminFetch(`/publishers/${input.id}/map`, {
        method: 'POST',
        body: JSON.stringify({ targetPublisherId: input.targetPublisherId }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-temporary'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/publishers/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleteId(null);
      setDeleteError(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-temporary'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
    },
    onError: () => {
      setDeleteId(null);
      setDeleteError(true);
    },
  });

  const complete = useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      slug: string;
      type: 'org' | 'person';
    }) =>
      adminFetch(`/publishers/${input.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          slug: input.slug,
          type: input.type,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-temporary'] });
    },
  });

  if (list.isError) {
    const unauthorized =
      list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert severity={unauthorized ? 'info' : 'error'}>
        {unauthorized ? (
          <>
            {t('needLogin')}{' '}
            <Link href="/login">{tApp('navLogin')}</Link>
          </>
        ) : (
          t('loadError')
        )}
      </Alert>
    );
  }

  const items = [...(list.data?.items ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
  );

  return (
    <Stack spacing={2} sx={{ mt: 4 }}>
      <Typography variant="h5" component="h2">
        {t('title')}
      </Typography>
      {deleteError ? <Alert severity="error">{t('deleteError')}</Alert> : null}
      {list.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!list.isLoading && items.length === 0 ? (
        <Typography color="text.secondary">{t('empty')}</Typography>
      ) : null}
      {items.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('name')}</TableCell>
              <TableCell>{t('id')}</TableCell>
              <TableCell>{t('events')}</TableCell>
              <TableCell>{t('mapTo')}</TableCell>
              <TableCell>{t('complete')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => {
              const form = completeForms[item.id] ?? {
                name: item.name,
                slug: item.slug,
                type: item.type,
              };
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/publishers/${item.id}`}>{item.name}</Link>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {item.slug}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{item.id}</TableCell>
                  <TableCell>{item.eventCount}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label={t('targetId')}
                        value={targets[item.id] ?? ''}
                        onChange={(e) =>
                          setTargets((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={map.isPending || !(targets[item.id] ?? '').trim()}
                        onClick={() =>
                          map.mutate({
                            id: item.id,
                            targetPublisherId: (targets[item.id] ?? '').trim(),
                          })
                        }
                      >
                        {t('map')}
                      </Button>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label={t('name')}
                        value={form.name}
                        onChange={(e) =>
                          setCompleteForms((prev) => ({
                            ...prev,
                            [item.id]: { ...form, name: e.target.value },
                          }))
                        }
                      />
                      <TextField
                        size="small"
                        label={t('slug')}
                        value={form.slug}
                        onChange={(e) =>
                          setCompleteForms((prev) => ({
                            ...prev,
                            [item.id]: { ...form, slug: e.target.value },
                          }))
                        }
                      />
                      <Button
                        size="small"
                        variant="contained"
                        disabled={complete.isPending}
                        onClick={() =>
                          complete.mutate({
                            id: item.id,
                            name: form.name,
                            slug: form.slug,
                            type: form.type,
                          })
                        }
                      >
                        {t('save')}
                      </Button>
                      {item.eventCount === 0 ? (
                        <Button
                          size="small"
                          color="error"
                          disabled={remove.isPending}
                          onClick={() => {
                            setDeleteError(false);
                            setDeleteId(item.id);
                          }}
                        >
                          {t('delete')}
                        </Button>
                      ) : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      <Dialog open={deleteId !== null} onClose={() => setDeleteId(null)}>
        <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('deleteConfirm')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>{t('cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending || deleteId == null}
            onClick={() => {
              if (deleteId) remove.mutate(deleteId);
            }}
          >
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
