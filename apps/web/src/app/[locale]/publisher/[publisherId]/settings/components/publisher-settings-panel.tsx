'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ApiError } from '@local-events/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
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
      throwIfError(await api.GET('/publishers/{publisherId}', { params: { path: { publisherId } } })),
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
    return (
      <Typography variant="body2" color="text.secondary">
        …
      </Typography>
    );
  }

  if (profile.isError || !profile.data) {
    return <Alert severity="error">{t('errorGeneric')}</Alert>;
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
    <Stack spacing={4}>
      <Stack component="form" onSubmit={onSaveProfile} spacing={2}>
        <Typography variant="h6" component="h2">
          {t('profileTitle')}
        </Typography>
        <TextField
          name="name"
          label={t('name')}
          required
          fullWidth
          defaultValue={profile.data.name}
          disabled={!isOwner}
          slotProps={{ htmlInput: { minLength: 2 } }}
        />
        <TextField
          name="slug"
          label={t('slug')}
          required
          fullWidth
          defaultValue={profile.data.slug}
          disabled={!isOwner}
          slotProps={{ htmlInput: { minLength: 2, pattern: '[a-z0-9]+(?:-[a-z0-9]+)*' } }}
        />
        <FormControl fullWidth disabled={!isOwner}>
          <InputLabel id="publisher-settings-type">{t('type')}</InputLabel>
          <Select
            labelId="publisher-settings-type"
            name="type"
            label={t('type')}
            defaultValue={profile.data.type}
          >
            <MenuItem value="org">{t('typeOrg')}</MenuItem>
            <MenuItem value="person">{t('typePerson')}</MenuItem>
          </Select>
        </FormControl>
        {!isOwner && (
          <Typography variant="body2" color="text.secondary">
            {t('ownerOnlyEdit')}
          </Typography>
        )}
        {profileError && <Alert severity="error">{profileError}</Alert>}
        {saved && <Alert severity="success">{t('profileSaved')}</Alert>}
        {isOwner && (
          <Button type="submit" variant="contained" disabled={saveProfile.isPending}>
            {t('saveProfile')}
          </Button>
        )}
      </Stack>

      <Stack spacing={1.5}>
        <Typography variant="h6" component="h2">
          {t('membersTitle')}
        </Typography>
        <List disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {(members.data?.items ?? []).map((m) => (
            <ListItem key={m.publisherAccountId} divider>
              <ListItemText primary={m.email} secondary={m.role} />
            </ListItem>
          ))}
        </List>
      </Stack>

      {isOwner && (
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            {t('invitesTitle')}
          </Typography>
          <Stack component="form" onSubmit={onInvite} spacing={2}>
            <TextField name="email" type="email" label={t('email')} required fullWidth />
            <FormControl fullWidth>
              <InputLabel id="invite-role-label">{t('inviteRole')}</InputLabel>
              <Select
                labelId="invite-role-label"
                name="role"
                label={t('inviteRole')}
                defaultValue="editor"
              >
                <MenuItem value="editor">{t('roleEditor')}</MenuItem>
                <MenuItem value="owner">{t('roleOwner')}</MenuItem>
              </Select>
            </FormControl>
            {inviteError && <Alert severity="error">{inviteError}</Alert>}
            {inviteToken && (
              <Alert severity="info">
                {t('inviteTokenHint')} {inviteToken}
              </Alert>
            )}
            <Button type="submit" variant="contained" disabled={createInvite.isPending}>
              {t('sendInvite')}
            </Button>
          </Stack>
          <List disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {(invites.data?.items ?? []).length === 0 ? (
              <ListItem>
                <ListItemText secondary={t('noPendingInvites')} />
              </ListItem>
            ) : (
              (invites.data?.items ?? []).map((i) => (
                <ListItem key={i.id} divider>
                  <ListItemText
                    primary={i.email}
                    secondary={`${i.role} · ${t('expiresAt', { date: i.expiresAt })}`}
                  />
                </ListItem>
              ))
            )}
          </List>
        </Stack>
      )}
    </Stack>
  );
}
