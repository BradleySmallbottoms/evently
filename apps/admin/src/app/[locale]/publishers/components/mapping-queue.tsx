'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useQuery({
    queryKey: ['admin-publishers-temporary'],
    queryFn: () => adminFetch<{ items: TempPublisher[] }>('/publishers?temporary=true'),
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
    mutationFn: async (input: { id: string; name: string; slug: string; type: 'org' | 'person' }) =>
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

  const saveAll = useMutation({
    mutationFn: async (rows: TempPublisher[]) => {
      const results = await Promise.allSettled(
        rows.map((item) => {
          const form = completeForms[item.id] ?? {
            name: item.name,
            slug: item.slug,
            type: item.type,
          };
          return adminFetch(`/publishers/${item.id}/complete`, {
            method: 'POST',
            body: JSON.stringify({ name: form.name, slug: form.slug, type: form.type }),
          });
        }),
      );
      return results.filter((result) => result.status === 'rejected').length;
    },
    onSuccess: async (failed) => {
      setBulkError(failed > 0 ? t('saveAllError') : null);
      setBulkNotice(failed === 0 ? t('savedAll') : null);
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-temporary'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
    },
  });

  const verifyAll = useMutation({
    mutationFn: async (rows: TempPublisher[]) => {
      const results = await Promise.allSettled(
        rows.map((item) => adminFetch(`/publishers/${item.id}/verify`, { method: 'POST' })),
      );
      return results.filter((result) => result.status === 'rejected').length;
    },
    onSuccess: async (failed) => {
      setBulkError(failed > 0 ? t('verifyAllError') : null);
      setBulkNotice(failed === 0 ? t('verifiedAll') : null);
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-temporary'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
    },
  });

  if (list.isError) {
    const unauthorized = list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert variant={unauthorized ? 'default' : 'destructive'}>
        <AlertDescription>
          {unauthorized ? (
            <>
              {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
            </>
          ) : (
            t('loadError')
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const items = [...(list.data?.items ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
  );
  const selectedRows = items.filter((item) => selected.has(item.id));
  const allSelected = items.length > 0 && selectedRows.length === items.length;
  const someSelected = selectedRows.length > 0 && !allSelected;
  const batchBusy = saveAll.isPending || verifyAll.isPending;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        {items.length > 0 ? (
          <div className="flex items-center gap-2">
            {selectedRows.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('selected', { count: selectedRows.length })}
              </p>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={batchBusy || selectedRows.length === 0}
              onClick={() => saveAll.mutate(selectedRows)}
            >
              {saveAll.isPending ? <Spinner data-icon="inline-start" /> : null}
              {saveAll.isPending ? t('savingAll') : t('saveSelected')}
            </Button>
            <Button
              size="sm"
              disabled={batchBusy || selectedRows.length === 0}
              onClick={() => verifyAll.mutate(selectedRows)}
            >
              {verifyAll.isPending ? <Spinner data-icon="inline-start" /> : null}
              {verifyAll.isPending ? t('verifyingAll') : t('verifySelected')}
            </Button>
          </div>
        ) : null}
      </div>
      {bulkNotice ? (
        <Alert>
          <AlertDescription>{bulkNotice}</AlertDescription>
        </Alert>
      ) : null}
      {bulkError ? (
        <Alert variant="destructive">
          <AlertDescription>{bulkError}</AlertDescription>
        </Alert>
      ) : null}
      {deleteError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('deleteError')}</AlertDescription>
        </Alert>
      ) : null}
      {list.isLoading ? <LoadingRows /> : null}
      {!list.isLoading && items.length === 0 ? (
        <EmptyState icon={UsersIcon} title={t('empty')} />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={() => toggleAll()}
                    aria-label={t('selectAll')}
                  />
                </TableHead>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('id')}</TableHead>
                <TableHead>{t('events')}</TableHead>
                <TableHead>{t('mapTo')}</TableHead>
                <TableHead>{t('complete')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const form = completeForms[item.id] ?? {
                  name: item.name,
                  slug: item.slug,
                  type: item.type,
                };
                return (
                  <TableRow
                    key={item.id}
                    data-state={selected.has(item.id) ? 'selected' : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleOne(item.id)}
                        aria-label={t('selectRow', { name: item.name })}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/publishers/${item.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{item.slug}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.id}</TableCell>
                    <TableCell>{item.eventCount}</TableCell>
                    <TableCell>
                      <div className="flex items-end gap-2">
                        <Field className="w-40">
                          <FieldLabel htmlFor={`map-target-${item.id}`}>{t('targetId')}</FieldLabel>
                          <Input
                            id={`map-target-${item.id}`}
                            value={targets[item.id] ?? ''}
                            onChange={(e) =>
                              setTargets((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                        </Field>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={map.isPending || !(targets[item.id] ?? '').trim()}
                          onClick={() =>
                            map.mutate({
                              id: item.id,
                              targetPublisherId: (targets[item.id] ?? '').trim(),
                            })
                          }
                        >
                          {map.isPending ? <Spinner data-icon="inline-start" /> : null}
                          {t('map')}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-end gap-2">
                        <Field className="w-40">
                          <FieldLabel htmlFor={`complete-name-${item.id}`}>{t('name')}</FieldLabel>
                          <Input
                            id={`complete-name-${item.id}`}
                            value={form.name}
                            onChange={(e) =>
                              setCompleteForms((prev) => ({
                                ...prev,
                                [item.id]: { ...form, name: e.target.value },
                              }))
                            }
                          />
                        </Field>
                        <Field className="w-40">
                          <FieldLabel htmlFor={`complete-slug-${item.id}`}>{t('slug')}</FieldLabel>
                          <Input
                            id={`complete-slug-${item.id}`}
                            value={form.slug}
                            onChange={(e) =>
                              setCompleteForms((prev) => ({
                                ...prev,
                                [item.id]: { ...form, slug: e.target.value },
                              }))
                            }
                          />
                        </Field>
                        <Button
                          size="sm"
                          disabled={complete.isPending || batchBusy}
                          onClick={() =>
                            complete.mutate({
                              id: item.id,
                              name: form.name,
                              slug: form.slug,
                              type: form.type,
                            })
                          }
                        >
                          {complete.isPending ? <Spinner data-icon="inline-start" /> : null}
                          {t('save')}
                        </Button>
                        {item.eventCount === 0 ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={remove.isPending}
                            onClick={() => {
                              setDeleteError(false);
                              setDeleteId(item.id);
                            }}
                          >
                            {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
                            {t('delete')}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending || deleteId == null}
              onClick={() => {
                if (deleteId) remove.mutate(deleteId);
              }}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
