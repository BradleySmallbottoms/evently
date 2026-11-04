'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AdminApiError, adminFetch } from '@/lib/api';

type Account = {
  id: string;
  email: string;
  role: 'owner' | 'editor';
  emailVerifiedAt: string | null;
  totpEnabled: boolean;
  createdAt: string;
};

type Editor =
  | { mode: 'add' }
  | { mode: 'edit'; account: Account }
  | { mode: 'remove'; account: Account }
  | null;

export function PublisherAccounts({ publisherId }: { publisherId: string }) {
  const t = useTranslations('PublisherEditor');
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<Editor>(null);
  const [role, setRole] = useState<'owner' | 'editor'>('editor');
  const [lookup, setLookup] = useState<'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef('');

  const accounts = useQuery({
    queryKey: ['admin-publisher-accounts', publisherId],
    queryFn: () => adminFetch<{ items: Account[] }>(`/publishers/${publisherId}/accounts`),
  });

  function openEditor(next: Editor) {
    setEditor(next);
    setRole(next?.mode === 'edit' ? next.account.role : 'editor');
    setLookup(null);
    setError(null);
  }

  function close() {
    setEditor(null);
    setError(null);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin-publisher-accounts', publisherId] });
  }

  const save = useMutation({
    mutationFn: async (
      input:
        | { kind: 'role'; role: 'owner' | 'editor' }
        | {
            kind: 'create';
            email: string;
            password: string;
            role: 'owner' | 'editor';
            linkExisting: boolean;
          },
    ) => {
      if (input.kind === 'role') {
        if (editor?.mode !== 'edit') throw new Error('No account');
        return adminFetch<Account>(`/publishers/${publisherId}/accounts/${editor.account.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: input.role }),
        });
      }
      const body: Record<string, string> = { email: input.email, role: input.role };
      if (!input.linkExisting) body.password = input.password;
      return adminFetch<Account>(`/publishers/${publisherId}/accounts`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      close();
      await refresh();
    },
    onError: (err) => {
      if (err instanceof AdminApiError && err.code === 'already_member')
        setError(t('accountAlready'));
      else if (err instanceof AdminApiError && err.code === 'email_taken')
        setError(t('accountEmailTaken'));
      else setError(t('accountSaveError'));
    },
  });

  const lookupAccount = useMutation({
    mutationFn: (email: string) =>
      adminFetch<{ status: 'new' | 'existing' | 'already_member' }>(
        `/publishers/${publisherId}/accounts/lookup?email=${encodeURIComponent(email)}`,
      ),
    onSuccess: (body, email) => {
      if (emailRef.current.trim().toLowerCase() !== email.trim().toLowerCase()) return;
      if (body.status === 'already_member') {
        setError(t('accountAlready'));
        return;
      }
      if (body.status === 'existing') {
        save.mutate({
          kind: 'create',
          email,
          password: '',
          role,
          linkExisting: true,
        });
        return;
      }
      setLookup('new');
      setError(null);
    },
    onError: () => setError(t('accountSaveError')),
  });

  const remove = useMutation({
    mutationFn: (accountId: string) =>
      adminFetch(`/publishers/${publisherId}/accounts/${accountId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      close();
      await refresh();
    },
    onError: () => setError(t('accountSaveError')),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editor.mode === 'remove') return;
    if (editor.mode === 'edit') {
      setError(null);
      save.mutate({ kind: 'role', role });
      return;
    }
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const passwordConfirm = String(form.get('passwordConfirm') ?? '');
    setError(null);
    if (lookup === null) {
      emailRef.current = email;
      lookupAccount.mutate(email);
      return;
    }
    if (lookup === 'new' && password !== passwordConfirm) {
      setError(t('accountPasswordMismatch'));
      return;
    }
    save.mutate({
      kind: 'create',
      email,
      password,
      role,
      linkExisting: false,
    });
  }

  const adding = editor?.mode === 'add';
  const askPassword = adding && lookup === 'new';
  const pending = save.isPending || lookupAccount.isPending;

  const items = accounts.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('accounts')}</CardTitle>
        <CardDescription>{t('accountsLead')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {accounts.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t('accountsLoadError')}</AlertDescription>
          </Alert>
        ) : null}
        {accounts.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('accountsLoading')}</p>
        ) : null}
        {!accounts.isLoading && items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('accountsEmpty')}</EmptyTitle>
              <EmptyDescription>{t('accountsLead')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('accountEmail')}</TableHead>
                <TableHead>{t('accountRole')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>{account.email}</TableCell>
                  <TableCell>
                    {account.role === 'owner' ? t('roleOwner') : t('roleEditor')}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditor({ mode: 'edit', account })}
                      >
                        {t('accountEdit')}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => openEditor({ mode: 'remove', account })}
                      >
                        {t('accountRemove')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <Button type="button" className="self-start" onClick={() => openEditor({ mode: 'add' })}>
          {t('accountAdd')}
        </Button>
      </CardContent>

      <Dialog
        open={editor?.mode === 'add' || editor?.mode === 'edit'}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor?.mode === 'edit' ? t('accountEdit') : t('accountAdd')}
            </DialogTitle>
            <DialogDescription>
              {editor?.mode === 'edit' ? t('accountRoleLead') : t('accountsLead')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              {adding ? (
                <Field>
                  <FieldLabel htmlFor="account-email">{t('accountEmail')}</FieldLabel>
                  <Input
                    id="account-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="off"
                    onChange={(event) => {
                      if (!adding) return;
                      emailRef.current = event.target.value;
                      setLookup(null);
                    }}
                  />
                  {lookup === 'new' ? <FieldDescription>{t('accountNew')}</FieldDescription> : null}
                </Field>
              ) : null}
              {askPassword ? (
                <Field>
                  <FieldLabel htmlFor="account-password">{t('accountPassword')}</FieldLabel>
                  <Input
                    id="account-password"
                    name="password"
                    type="password"
                    minLength={10}
                    required={adding}
                    autoComplete="new-password"
                  />
                </Field>
              ) : null}
              {adding && lookup === 'new' ? (
                <Field>
                  <FieldLabel htmlFor="account-password-confirm">
                    {t('accountPasswordConfirm')}
                  </FieldLabel>
                  <Input
                    id="account-password-confirm"
                    name="passwordConfirm"
                    type="password"
                    minLength={10}
                    required
                    autoComplete="new-password"
                  />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="account-role">{t('accountRole')}</FieldLabel>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value === 'owner' ? 'owner' : 'editor')}
                >
                  <SelectTrigger id="account-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="owner">{t('roleOwner')}</SelectItem>
                      <SelectItem value="editor">{t('roleEditor')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={close}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  {adding && lookup === null ? t('accountContinue') : t('save')}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editor?.mode === 'remove'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('accountRemoveTitle')}</DialogTitle>
            <DialogDescription>
              {t('accountRemoveConfirm', {
                email: editor?.mode === 'remove' ? editor.account.email : '',
              })}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending || editor?.mode !== 'remove'}
              onClick={() => {
                if (editor?.mode === 'remove') remove.mutate(editor.account.id);
              }}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('accountRemove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
