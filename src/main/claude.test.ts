import { describe, expect, it } from 'vitest';
import {
  API_KEY_ENV,
  MissingApiKeyError,
  NotImplementedError,
  requireApiKey,
  rewrite,
} from './claude';

describe('claude stub', () => {
  it('names the missing variable and promises the text is untouched when the key is absent', () => {
    expect(() => requireApiKey({})).toThrow(MissingApiKeyError);
    expect(() => requireApiKey({})).toThrow(API_KEY_ENV);
    expect(() => requireApiKey({ [API_KEY_ENV]: '   ' })).toThrow(MissingApiKeyError);
    expect(() => requireApiKey({})).toThrow(/untouched/);
  });

  it('returns the key when present', () => {
    expect(requireApiKey({ [API_KEY_ENV]: 'sk-test' })).toBe('sk-test');
  });

  it('rewrite() refuses without a key before doing anything else', () => {
    expect(() => rewrite('wakao', 'formalise', {})).toThrow(MissingApiKeyError);
  });

  it('rewrite() is an honest stub: key present, no network, NotImplemented', async () => {
    await expect(rewrite('wakao', 'formalise', { [API_KEY_ENV]: 'sk-test' })).rejects.toThrow(
      NotImplementedError,
    );
    await expect(rewrite('i dont care', 'beautify', { [API_KEY_ENV]: 'sk-test' })).rejects.toThrow(
      /03-claude-client/,
    );
  });
});
