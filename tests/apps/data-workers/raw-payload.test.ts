import { rawPayloadKey, serializeRawPayload } from '../../../apps/data-workers/src/raw-payload';
import { describe, expect, it } from 'vitest';

describe('rawPayloadKey', () => {
  it('uses raw/<slug>/<runId>', () => {
    expect(rawPayloadKey('visit-soderhamn', 'run-1')).toBe('raw/visit-soderhamn/run-1');
  });
});

describe('serializeRawPayload', () => {
  it('JSON-encodes objects', () => {
    const { body, contentType } = serializeRawPayload({ hello: 'world' });
    expect(contentType).toContain('application/json');
    expect(JSON.parse(body.toString('utf8'))).toEqual({ hello: 'world' });
  });

  it('keeps strings as utf8', () => {
    const { body, contentType } = serializeRawPayload('{"a":1}');
    expect(contentType).toContain('application/json');
    expect(body.toString('utf8')).toBe('{"a":1}');
  });

  it('keeps buffers as octet-stream', () => {
    const buf = Buffer.from([1, 2, 3]);
    const { body, contentType } = serializeRawPayload(buf);
    expect(contentType).toBe('application/octet-stream');
    expect(body.equals(buf)).toBe(true);
  });
});
