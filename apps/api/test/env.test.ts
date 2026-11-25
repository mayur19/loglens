import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseTrustProxy } from '../src/config/env.js';

const BASE = { DATABASE_URL: 'postgresql:///x', SESSION_SECRET: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(BASE);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4109,
      trustProxy: false,
      queryTimeoutMs: 5000,
      queryMaxRows: 10000,
    });
  });

  it('lists every invalid variable', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'short', API_PORT: '99999' })).toThrow(
      /DATABASE_URL.*SESSION_SECRET|SESSION_SECRET.*DATABASE_URL/,
    );
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('requires TRUST_PROXY to be set explicitly in production', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /TRUST_PROXY must be set explicitly/,
    );
    expect(loadConfig({ ...BASE, NODE_ENV: 'production', TRUST_PROXY: 'false' }).trustProxy).toBe(
      false,
    );
    expect(loadConfig({ ...BASE, NODE_ENV: 'production', TRUST_PROXY: '1' }).trustProxy).toBe(1);
  });

  it('never derives TRUST_PROXY from NODE_ENV', () => {
    expect(loadConfig({ ...BASE, NODE_ENV: 'development' }).trustProxy).toBe(false);
    expect(loadConfig({ ...BASE, NODE_ENV: 'test' }).trustProxy).toBe(false);
  });

  it('wraps TRUST_PROXY parse failures in ConfigError', () => {
    expect(() => loadConfig({ ...BASE, TRUST_PROXY: 'yes please' })).toThrow(ConfigError);
  });
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['false', false],
    ['2', 2],
    ['127.0.0.1', ['127.0.0.1']],
    ['10.0.0.0/8, ::1', ['10.0.0.0/8', '::1']],
  ])('%s → %j', (raw, expected) => {
    expect(parseTrustProxy(raw)).toEqual(expected);
  });

  it.each(['true', '0', '11', 'proxy.example', ',,'])('rejects %s', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/);
  });
});
