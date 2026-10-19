import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';

async function registerVerifiedPublisher(
  app: ReturnType<typeof createApp>,
  input: { email: string; password: string; name: string },
) {
  const registered = await app.request('/v1/publishers/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      name: input.name,
      type: 'org',
    }),
  });
  expect(registered.status).toBe(201);
  const reg = (await registered.json()) as {
    publisherAccountId: string;
    publisherId: string;
    verificationToken?: string;
  };
  await app.request('/v1/publishers/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: reg.verificationToken }),
  });
  const login = await app.request('/v1/publishers/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  expect(login.status).toBe(200);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain(PUBLISHER_SESSION_COOKIE);
  return { ...reg, cookie };
}

describe('publisher profile + invites', () => {
  it('documents the new OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/publishers/{publisherId}']).toBeDefined();
    expect(doc.paths['/publishers/{publisherId}/members']).toBeDefined();
    expect(doc.paths['/publishers/{publisherId}/invites']).toBeDefined();
    expect(doc.paths['/publishers/invites/accept']).toBeDefined();
  });

  it('lets an owner read and update the publisher profile', async () => {
    const app = createApp({
      auth: createMemoryAuthServices({ includeVerificationToken: true, now: () => new Date() }),
    });
    const owner = await registerVerifiedPublisher(app, {
      email: 'owner@example.com',
      password: 'long-enough-password',
      name: 'Café Söderhamn',
    });

    const profile = await app.request(`/v1/publishers/${owner.publisherId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      id: owner.publisherId,
      name: 'Café Söderhamn',
      role: 'owner',
      status: 'in_review',
    });

    const patched = await app.request(`/v1/publishers/${owner.publisherId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'Café Updated', slug: 'cafe-updated' }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      name: 'Café Updated',
      slug: 'cafe-updated',
    });

    const members = await app.request(`/v1/publishers/${owner.publisherId}/members`, {
      headers: { cookie: owner.cookie },
    });
    expect(members.status).toBe(200);
    const memberList = (await members.json()) as { items: { email: string; role: string }[] };
    expect(memberList.items).toHaveLength(1);
    expect(memberList.items[0]).toMatchObject({ email: 'owner@example.com', role: 'owner' });
  });

  it('invites an editor by email and accepts when signed in as that email', async () => {
    const app = createApp({
      auth: createMemoryAuthServices({ includeVerificationToken: true, now: () => new Date() }),
    });
    const owner = await registerVerifiedPublisher(app, {
      email: 'owner2@example.com',
      password: 'long-enough-password',
      name: 'Owner Org',
    });
    const editor = await registerVerifiedPublisher(app, {
      email: 'editor@example.com',
      password: 'long-enough-password',
      name: 'Editor Solo',
    });

    const invite = await app.request(`/v1/publishers/${owner.publisherId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ email: 'editor@example.com', role: 'editor' }),
    });
    expect(invite.status).toBe(201);
    const inviteBody = (await invite.json()) as {
      id: string;
      email: string;
      inviteToken?: string;
    };
    expect(inviteBody.email).toBe('editor@example.com');
    expect(inviteBody.inviteToken).toBeTruthy();

    const pending = await app.request(`/v1/publishers/${owner.publisherId}/invites`, {
      headers: { cookie: owner.cookie },
    });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({
      items: [{ email: 'editor@example.com', role: 'editor' }],
    });

    const accepted = await app.request('/v1/publishers/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: editor.cookie },
      body: JSON.stringify({ token: inviteBody.inviteToken }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      publisherId: owner.publisherId,
      role: 'editor',
    });

    const members = await app.request(`/v1/publishers/${owner.publisherId}/members`, {
      headers: { cookie: owner.cookie },
    });
    const list = (await members.json()) as { items: { email: string; role: string }[] };
    expect(list.items.map((m) => m.email).sort()).toEqual([
      'editor@example.com',
      'owner2@example.com',
    ]);

    const editorProfile = await app.request(`/v1/publishers/${owner.publisherId}`, {
      headers: { cookie: editor.cookie },
    });
    expect(editorProfile.status).toBe(200);
    expect(await editorProfile.json()).toMatchObject({ role: 'editor' });

    const editorPatch = await app.request(`/v1/publishers/${owner.publisherId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: editor.cookie },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(editorPatch.status).toBe(403);
  });

  it('rejects invite accept when signed-in email does not match', async () => {
    const app = createApp({
      auth: createMemoryAuthServices({ includeVerificationToken: true, now: () => new Date() }),
    });
    const owner = await registerVerifiedPublisher(app, {
      email: 'owner3@example.com',
      password: 'long-enough-password',
      name: 'Owner Three',
    });
    const other = await registerVerifiedPublisher(app, {
      email: 'other@example.com',
      password: 'long-enough-password',
      name: 'Other Org',
    });

    const invite = await app.request(`/v1/publishers/${owner.publisherId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ email: 'invitee@example.com', role: 'editor' }),
    });
    const inviteBody = (await invite.json()) as { inviteToken?: string };

    const accepted = await app.request('/v1/publishers/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: other.cookie },
      body: JSON.stringify({ token: inviteBody.inviteToken }),
    });
    expect(accepted.status).toBe(403);
    expect(await accepted.json()).toMatchObject({
      error: { code: 'invite_email_mismatch' },
    });
  });
});
