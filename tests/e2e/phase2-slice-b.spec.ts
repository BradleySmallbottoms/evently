import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Isolated e2e API (see playwright.config.ts) — never the `pnpm dev` :3000 instance. */
const API = process.env.E2E_API_ORIGIN ?? 'http://localhost:3090';

const NEXT_REACT_CONSOLE_WARNING =
  /(next\.?js|react|hydration|did not match|text content does not match|rendered more hooks|cannot update a component while rendering|minified react error)/i;
const NEXT_INSTANT_VALIDATION_NOISE =
  /Could not validate that a segment in your UI has instant navigation|instant-unrendered-segment/i;

const consoleIssuesByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  consoleIssuesByPage.set(page, issues);

  page.on('console', (message) => {
    const type = message.type();
    const text = message.text();
    if (NEXT_INSTANT_VALIDATION_NOISE.test(text)) return;

    if (type === 'error') {
      issues.push(`[console.error] ${text}`);
      return;
    }

    if (type === 'warning' && NEXT_REACT_CONSOLE_WARNING.test(text)) {
      issues.push(`[console.warning] ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    issues.push(`[pageerror] ${error.message}`);
  });
});

test.afterEach(async ({ page }) => {
  const issues = consoleIssuesByPage.get(page) ?? [];
  expect(
    issues,
    `Browser console/runtime issues detected:\n${issues.map((entry) => `- ${entry}`).join('\n')}`,
  ).toEqual([]);
});

function tsPlusMinutes(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

test('publisher event flow is visible in web workspace', async ({ page, request, context }) => {
  const email = `e2e-publisher-${Date.now()}@example.com`;
  const password = 'long-enough-password';
  const registerRes = await request.post(`${API}/v1/publishers/register`, {
    data: { email, password, name: 'E2E Arrangor', type: 'org' },
  });
  expect(registerRes.ok()).toBeTruthy();
  const registered = (await registerRes.json()) as {
    publisherId: string;
    verificationToken?: string;
  };
  expect(registered.verificationToken).toBeTruthy();

  const verifyRes = await request.post(`${API}/v1/publishers/verify-email`, {
    data: { token: registered.verificationToken },
  });
  expect(verifyRes.ok()).toBeTruthy();

  const loginRes = await request.post(`${API}/v1/publishers/login`, {
    data: { email, password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const cookieHeader = loginRes.headers()['set-cookie'];
  expect(cookieHeader).toBeTruthy();
  const sessionPair = (cookieHeader ?? '').split(';')[0] ?? '';
  const cookieEqIdx = sessionPair.indexOf('=');
  const cookieName = cookieEqIdx > -1 ? sessionPair.slice(0, cookieEqIdx) : '';
  const cookieValue = cookieEqIdx > -1 ? sessionPair.slice(cookieEqIdx + 1) : '';
  expect(cookieName).toBe('le_publisher_session');
  expect(cookieValue).toBeTruthy();
  await context.addCookies([
    {
      name: cookieName!,
      value: cookieValue!,
      url: API,
    },
  ]);

  const tagsRes = await request.get(`${API}/v1/tags`);
  expect(tagsRes.ok()).toBeTruthy();
  const tags = (await tagsRes.json()) as { items: { id: string }[] };
  const tagId = tags.items[0]?.id;
  expect(tagId).toBeTruthy();

  const createRes = await request.post(
    `${API}/v1/publishers/${registered.publisherId}/events`,
    {
      headers: { cookie: sessionPair },
      data: {
        title: 'E2E Test Event',
        description: 'Created in E2E',
        mode: 'physical',
        startsAt: `${tsPlusMinutes(60)}:00.000Z`,
        endsAt: `${tsPlusMinutes(120)}:00.000Z`,
        venueName: 'Soderhamn Centrum',
        location: { lat: 61.3037, lng: 17.0592 },
        tagIds: [tagId],
      },
    },
  );
  expect(createRes.ok()).toBeTruthy();
  const created = (await createRes.json()) as { id: string };

  const publishRes = await request.post(
    `${API}/v1/manage/events/${created.id}/publish`,
    { headers: { cookie: sessionPair } },
  );
  expect(publishRes.ok()).toBeTruthy();

  await page.goto(`/publisher/${registered.publisherId}/events`);
  await expect(page.getByText('E2E Test Event')).toBeVisible();
  await page.goto(`/publisher/${registered.publisherId}/events/${created.id}`);
  await expect(page.getByText(/Current status|Nuvarande status/i)).toBeVisible();
  await expect(page.getByText(/awaiting|verifiering|verification/i)).toBeVisible();
});

test('web pairing sign-in works with generated app code', async ({ page, request }) => {
  const identityRes = await request.post(`${API}/v1/identities`, {
    data: { platform: 'web', locale: 'sv' },
  });
  expect(identityRes.ok()).toBeTruthy();
  const identity = (await identityRes.json()) as { deviceCredential: string };

  const codeRes = await request.post(`${API}/v1/pairing/code`, {
    data: { deviceCredential: identity.deviceCredential },
  });
  expect(codeRes.ok()).toBeTruthy();
  const codeBody = (await codeRes.json()) as { code: string };

  await page.goto(`/login-with-code?code=${encodeURIComponent(codeBody.code)}`);
  await expect(page.getByText(/Inloggad som anvandare|Signed in as user/i)).toBeVisible();

  const meRes = await page.request.get(`${API}/v1/pairing/me`);
  expect(meRes.ok()).toBeTruthy();
  const me = (await meRes.json()) as { userId: string };
  expect(me.userId).toBeTruthy();
});
