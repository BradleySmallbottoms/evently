type IssuedCode = { status: 'code_sent'; code?: string };

/** Sends the code when mail is configured, then returns it only when the response may include it. */
export async function deliverAdminLoginCode(
  env: {
    includeLoginOtp: boolean;
    sendAdminLoginCode?: (input: { to: string; code: string }) => Promise<void>;
  },
  input: { to: string; code: string },
): Promise<IssuedCode> {
  if (env.sendAdminLoginCode) await env.sendAdminLoginCode(input);
  return env.includeLoginOtp ? { status: 'code_sent', code: input.code } : { status: 'code_sent' };
}

/**
 * Resend mailer for the admin sign-in code. Both `RESEND_API_KEY` and `RESEND_FROM`
 * are required. Either one alone is a misconfiguration. Neither means no mail.
 */
export function createAdminLoginMailer(
  env: NodeJS.ProcessEnv,
): ((input: { to: string; code: string }) => Promise<void>) | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();
  if (!apiKey && !from) return undefined;
  if (!apiKey || !from) {
    throw new Error('admin_login_email_requires_RESEND_API_KEY_and_RESEND_FROM');
  }
  return async ({ to, code }) => {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: 'Admin-kod / Admin sign-in code',
          text: [
            `Din kod för att logga in i admin är ${code}.`,
            'Den gäller i 10 minuter.',
            '',
            `Your admin sign-in code is ${code}.`,
            'It lasts 10 minutes.',
          ].join('\n'),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      throw new Error(`admin_login_email_failed:${name}`);
    }
    if (response.ok) return;
    let name = 'Error';
    try {
      const body = (await response.json()) as { name?: unknown };
      if (typeof body.name === 'string' && body.name.length > 0) name = body.name;
    } catch {
      // The status is enough when the body is not JSON.
    }
    throw new Error(`admin_login_email_failed:${response.status}:${name}`);
  };
}
