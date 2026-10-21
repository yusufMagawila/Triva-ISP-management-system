import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../../config/env', () => ({
  env: { AI_PROVIDER: 'deterministic', GEMINI_API_KEY: undefined, GEMINI_MODEL: 'test' },
}));

import { parseJsonLoose } from '../ai-provider';

describe('parseJsonLoose', () => {
  it('parses plain JSON', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips markdown fences', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('extracts the object from surrounding prose', () => {
    expect(parseJsonLoose('Sure! Here you go: {"a":{"b":2}} Hope that helps.')).toEqual({ a: { b: 2 } });
  });
  it('returns undefined for truncated or non-JSON text', () => {
    expect(parseJsonLoose('{"a":1,"b":[1,2')).toBeUndefined();
    expect(parseJsonLoose('no json here')).toBeUndefined();
  });
});
