'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
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

type Account = {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  totpEnabled: boolean;
  createdAt: string;
};

export function PublisherAccountsPanel() {
  const t = useTranslations('PublisherAccounts');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin-publisher-account-directory'],
    queryFn: () => adminFetch<{ items: Account[] }>('/publisher-accounts'),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (input: { id: string; password: string }) =>
      adminFetch(`/publisher-accounts/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: input.password }),
      }),
    onSuccess: async () => {
      setAccount(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-publisher-account-directory'] });
    },
    onError: () => setError(t('saveError')),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('passwordConfirm') ?? '');
    if (password !== confirm) {
      setError(t('passwordMismatch'));
      return;
    }
    setError(null);
    save.mutate({ id: account.id, password });
  }

  if (list.isError) {
    const unauthorized = list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert variant={unauthorized ? 'default' : 'destructive'}>
        <AlertDescription>
          {unauthorized ? (
            <>
              {t('needLogin')}{' '}
              <Link href="/login" className="underline underline-offset-4">
                {tApp('navLogin')}
              </Link>
            </>
          ) : (
            t('loadError')
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('lead')}</p>
      </div>
      {list.isLoading ? <LoadingRows /> : null}
      {!list.isLoading && items.length === 0 ? (
        <EmptyState icon={UsersIcon} title={t('empty')} />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>{t('email')}</TableHead>
                <TableHead>{t('verified')}</TableHead>
                <TableHead>{t('authenticator')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.email}</TableCell>
                  <TableCell>{item.emailVerifiedAt ? t('yes') : t('no')}</TableCell>
                  <TableCell>{item.totpEnabled ? t('yes') : t('no')}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setAccount(item);
                        }}
                      >
                        {t('changePassword')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <Dialog open={account != null} onOpenChange={(open) => !open && setAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('changePassword')}</DialogTitle>
            <DialogDescription>{account?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="directory-password">{t('password')}</FieldLabel>
                <Input
                  id="directory-password"
                  name="password"
                  type="password"
                  minLength={10}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="directory-password-confirm">{t('passwordConfirm')}</FieldLabel>
                <Input
                  id="directory-password-confirm"
                  name="passwordConfirm"
                  type="password"
                  minLength={10}
                  required
                  autoComplete="new-password"
                />
              </Field>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setAccount(null)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {t('save')}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
