import { describe, expect, it } from 'vitest';
import { parseCliOptions } from './options';
import { DEFAULT_HOST, DEFAULT_PORT } from './server';

describe('parseCliOptions', () => {
  it('binds localhost on the fixed port by default', () => {
    expect(parseCliOptions([], {})).toEqual({ host: DEFAULT_HOST, port: DEFAULT_PORT });
    expect(DEFAULT_HOST).toBe('127.0.0.1');
  });

  it('lets flags override the environment, and the environment override the defaults', () => {
    expect(
      parseCliOptions([], { FORMALISE_WEB_HOST: '0.0.0.0', FORMALISE_WEB_PORT: '9000' }),
    ).toEqual({ host: '0.0.0.0', port: 9000 });
    expect(
      parseCliOptions(['--host', '192.168.1.5', '--port', '8080'], {
        FORMALISE_WEB_HOST: '0.0.0.0',
        FORMALISE_WEB_PORT: '9000',
      }),
    ).toEqual({ host: '192.168.1.5', port: 8080 });
    expect(parseCliOptions(['--host=0.0.0.0'], {})).toEqual({
      host: '0.0.0.0',
      port: DEFAULT_PORT,
    });
  });

  it('refuses a port that is not a number in range, an empty host and unknown flags', () => {
    expect(() => parseCliOptions(['--port', 'abc'], {})).toThrow(/--port must be a whole number/);
    expect(() => parseCliOptions(['--port', '0'], {})).toThrow(/--port/);
    expect(() => parseCliOptions(['--port', '70000'], {})).toThrow(/--port/);
    expect(() => parseCliOptions([], { FORMALISE_WEB_PORT: '80.5' })).toThrow(/--port/);
    expect(() => parseCliOptions(['--host', '  '], {})).toThrow(/--host must not be empty/);
    expect(() => parseCliOptions(['--verbose'], {})).toThrow();
  });
});
