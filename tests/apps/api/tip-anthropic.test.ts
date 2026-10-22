import { describe, expect, it } from 'vitest';

import {
  createAnthropicTipModel,
  readExtraction,
  readReview,
  tipTodayLine,
} from '../../../apps/api/src/services/tips/anthropic';

describe('tip model date', () => {
  it('puts today in Stockholm on the message the model reads', async () => {
    const at = new Date('2026-10-21T10:00:00.000Z');
    let sent = '';
    const model = createAnthropicTipModel(
      { ANTHROPIC_API_KEY: 'test' },
      async (_url, init) => {
        sent = String(init?.body);
        return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }));
      },
      () => at,
    );

    await model.extract({
      locale: 'sv',
      text: 'Jazz nu på lördag',
      tags: [{ id: 'musik', name: 'Musik' }],
    });

    const body = JSON.parse(sent) as { messages: { content: { text: string }[] }[] };
    const text = body.messages[0]?.content[0]?.text ?? '';
    expect(tipTodayLine(at)).toBe('Today: 2026-10-21 (onsdag), Europe/Stockholm.');
    expect(text.startsWith(tipTodayLine(at))).toBe(true);
    expect(text).toContain('Tags:\nMusik');
    expect(text).toContain('Jazz nu på lördag');
  });

  it('keeps a short summary from the model', () => {
    const read = readExtraction(
      '{"title":"Jazz","summary":"Jazz i parken på lördag.","followUpQuestions":[]}',
    );
    expect(read.extraction.summary).toBe('Jazz i parken på lördag.');
  });

  it('reads possible tags from the model', () => {
    const read = readExtraction('{"possibleTags":["Musik","Sport"],"followUpQuestions":[]}');
    expect(read.extraction.tags).toEqual(['Musik', 'Sport']);
  });

  it('keeps a clock the model found', () => {
    const read = readExtraction(
      '{"startsAt":"2026-08-24","startTime":"19:00","endsAt":"2026-08-24T21:00:00+02:00","endTime":"21:00"}',
    );
    expect(read.extraction.startTime).toBe('19:00');
    expect(read.extraction.endTime).toBe('21:00');
  });

  it('reads a warning when the text is not an event', () => {
    const read = readExtraction('{"warning":"Berätta om ett evenemang.","title":null}');
    expect(read.warning).toBe('Berätta om ett evenemang.');
    expect(read.extraction.title).toBeNull();
  });

  it('keeps a typed answer when the review cannot be reached', async () => {
    const model = createAnthropicTipModel({ ANTHROPIC_API_KEY: 'test' }, async () => {
      return new Response('no', { status: 500 });
    });
    await expect(
      model.review({ locale: 'sv', key: 'title', question: 'Vad heter det?', text: 'Jazzkväll' }),
    ).resolves.toEqual({ ok: true, warning: null });
    expect(readReview('{"ok":false,"warning":"Skriv ett namn."}')).toEqual({
      ok: false,
      warning: 'Skriv ett namn.',
    });
    expect(readReview('not json')).toEqual({ ok: true, warning: null });
  });
});
