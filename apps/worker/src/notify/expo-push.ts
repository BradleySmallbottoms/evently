export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
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
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          throw new Error(`expo_push_http_${res.status}`);
        }
        const json = (await res.json()) as { data?: ExpoPushTicket[] };
        tickets.push(...(json.data ?? []));
      }
      return tickets;
    },
  };
}
