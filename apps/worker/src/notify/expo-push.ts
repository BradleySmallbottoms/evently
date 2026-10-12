export type ExpoPushMessage = {
  to: string;
  /** Omit for silent/data pushes (client may present a local OS notification). */
  title?: string;
  body?: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  badge?: number;
  /** iOS content-available / background delivery. */
  _contentAvailable?: boolean;
  priority?: 'default' | 'normal' | 'high';
};

export type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushClient = {
  send: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

/**
 * HTTP Expo Push client. Batches of 100 per docs/project-description.
 * Inject a stub in tests.
 */
export function createExpoPushClient(fetchImpl: typeof fetch = fetch): ExpoPushClient {
  return {
    async send(messages) {
      const tickets: ExpoPushTicket[] = [];
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const chunk = messages.slice(i, i + BATCH_SIZE);
        if (process.env.PUSH_DEBUG !== '0') {
          console.log(
            JSON.stringify({
              duePushDebug: {
                step: 'expo_http',
                url: EXPO_PUSH_URL,
                count: chunk.length,
                recipients: chunk.map((m) => {
                  const to = m.to;
                  return to.length > 12 ? `${to.slice(0, 10)}…${to.slice(-6)}` : to;
                }),
              },
            }),
          );
        }
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          if (process.env.PUSH_DEBUG !== '0') {
            console.log(
              JSON.stringify({
                duePushDebug: {
                  step: 'expo_http_error',
                  status: res.status,
                  body: body.slice(0, 500),
                },
              }),
            );
          }
          throw new Error(`expo_push_http_${res.status}`);
        }
        const json = (await res.json()) as { data?: ExpoPushTicket[] };
        tickets.push(...(json.data ?? []));
        if (process.env.PUSH_DEBUG !== '0') {
          console.log(
            JSON.stringify({
              duePushDebug: {
                step: 'expo_http_ok',
                ticketCount: json.data?.length ?? 0,
                tickets: (json.data ?? []).map((t) => ({
                  status: t.status,
                  id: t.id ?? null,
                  message: t.message ?? null,
                  error: t.details?.error ?? null,
                })),
              },
            }),
          );
        }
      }
      return tickets;
    },
  };
}
