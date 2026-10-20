'use client';

import { ApiError } from '@local-events/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, throwIfError } from '@/lib/api';

export function PublisherSettingsPanel() {
  const t = useTranslations('Publisher');
  const params = useParams<{ publisherId: string }>();
  const publisherId = params.publisherId;
  const queryClient = useQueryClient();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const profile = useQuery({
    queryKey: ['publisher-profile', publisherId],
    queryFn: async () =>
      throwIfError(
        await api.GET('/publishers/{publisherId}', { params: { path: { publisherId } } }),
      ),
  });

  const members = useQuery({
    queryKey: ['publisher-members', publisherId],
    queryFn: async () =>
      throwIfError(
        await api.GET('/publishers/{publisherId}/members', {
          params: { path: { publisherId } },
        }),
      ),
  });

  const isOwner = profile.data?.role === 'owner';

  const invites = useQuery({
    queryKey: ['publisher-invites', publisherId],
    enabled: isOwner,
    queryFn: async () =>
      throwIfError(
        await api.GET('/publishers/{publisherId}/invites', {
          params: { path: { publisherId } },
        }),
      ),
  });

  const saveProfile = useMutation({
    mutationFn: async (body: { name: string; slug: string; type: 'org' | 'person' }) =>
      throwIfError(
        await api.PATCH('/publishers/{publisherId}', {
          params: { path: { publisherId } },
          body,
        }),
      ),
    onSuccess: async () => {
      setSaved(true);
      setProfileError(null);
      await queryClient.invalidateQueries({ queryKey: ['publisher-profile', publisherId] });
      await queryClient.invalidateQueries({ queryKey: ['publisher-me'] });
    },
    onError: (err) => {
      setSaved(false);
      if (err instanceof ApiError && err.code === 'slug_taken') {
        setProfileError(t('errorSlugTaken'));
      } else if (err instanceof ApiError && err.code === 'forbidden') {
        setProfileError(t('errorForbidden'));
      } else {
        setProfileError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    },
  });

  const createInvite = useMutation({
    mutationFn: async (body: { email: string; role: 'owner' | 'editor' }) =>
      throwIfError(
        await api.POST('/publishers/{publisherId}/invites', {
          params: { path: { publisherId } },
          body,
        }),
      ),
    onSuccess: async (data) => {
      setInviteError(null);
      setInviteToken(data.inviteToken ?? null);
      await queryClient.invalidateQueries({ queryKey: ['publisher-invites', publisherId] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'already_member') {
        setInviteError(t('errorAlreadyMember'));
      } else if (err instanceof ApiError && err.code === 'invite_pending') {
        setInviteError(t('errorInvitePending'));
      } else if (err instanceof ApiError && err.code === 'forbidden') {
        setInviteError(t('errorForbidden'));
      } else {
        setInviteError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    },
  });

  if (profile.isPending) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (profile.isError || !profile.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('errorGeneric')}</AlertDescription>
      </Alert>
    );
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const type = String(formData.get('type') ?? 'org') === 'person' ? 'person' : 'org';
    saveProfile.mutate({
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      type,
    });
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const role = String(formData.get('role') ?? 'editor') === 'owner' ? 'owner' : 'editor';
    createInvite.mutate({
      email: String(formData.get('email') ?? ''),
      role,
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSaveProfile} className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-foreground">{t('profileTitle')}</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-name">{t('name')}</Label>
          <Input
            id="profile-name"
            name="name"
            required
            defaultValue={profile.data.name}
            disabled={!isOwner}
            minLength={2}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-slug">{t('slug')}</Label>
          <Input
            id="profile-slug"
            name="slug"
            required
            defaultValue={profile.data.slug}
            disabled={!isOwner}
            minLength={2}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-type">{t('type')}</Label>
          <Select name="type" defaultValue={profile.data.type} disabled={!isOwner}>
            <SelectTrigger id="profile-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="org">{t('typeOrg')}</SelectItem>
              <SelectItem value="person">{t('typePerson')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!isOwner && <p className="text-sm text-muted-foreground">{t('ownerOnlyEdit')}</p>}
        {profileError && (
          <Alert variant="destructive">
            <AlertDescription>{profileError}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert>
            <AlertDescription>{t('profileSaved')}</AlertDescription>
          </Alert>
        )}
        {isOwner && (
          <Button type="submit" variant="brand" disabled={saveProfile.isPending}>
            {t('saveProfile')}
          </Button>
        )}
      </form>

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-foreground">{t('membersTitle')}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {(members.data?.items ?? []).map((m) => (
            <li key={m.publisherAccountId} className="p-4">
              <p className="text-base text-foreground">{m.email}</p>
              <p className="text-sm text-muted-foreground">{m.role}</p>
            </li>
          ))}
        </ul>
      </div>

      {isOwner && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-foreground">{t('invitesTitle')}</h2>
          <form onSubmit={onInvite} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">{t('email')}</Label>
              <Input id="invite-email" name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-role">{t('inviteRole')}</Label>
              <Select name="role" defaultValue="editor">
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">{t('roleEditor')}</SelectItem>
                  <SelectItem value="owner">{t('roleOwner')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteError && (
              <Alert variant="destructive">
                <AlertDescription>{inviteError}</AlertDescription>
              </Alert>
            )}
            {inviteToken && (
              <Alert>
                <AlertDescription>
                  {t('inviteTokenHint')} {inviteToken}
                </AlertDescription>
              </Alert>
            )}
            <Button type="submit" variant="outline" disabled={createInvite.isPending}>
              {t('sendInvite')}
            </Button>
          </form>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {(invites.data?.items ?? []).length === 0 ? (
              <li className="p-4 text-sm text-muted-foreground">{t('noPendingInvites')}</li>
            ) : (
              (invites.data?.items ?? []).map((i) => (
                <li key={i.id} className="p-4">
                  <p className="text-base text-foreground">{i.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {i.role} · {t('expiresAt', { date: i.expiresAt })}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
