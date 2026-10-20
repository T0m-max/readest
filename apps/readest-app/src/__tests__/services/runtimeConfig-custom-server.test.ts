import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeConfig } from '@/services/runtimeConfig';

const config = {
  serverBaseUrl: 'https://reader.example.com',
  apiBaseUrl: 'https://reader.example.com',
  supabaseUrl: 'https://auth.example.com',
  supabaseAnonKey: 'public-key',
  fetchedAt: 1,
};

afterEach(() => {
  localStorage.clear();
  delete window.__READEST_RUNTIME_CONFIG;
  vi.unstubAllEnvs();
});

describe('custom server runtime selection', () => {
  it('selects API and auth together in the native client', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    localStorage.setItem('readest_custom_server_config_v1', JSON.stringify(config));
    expect(getRuntimeConfig()).toMatchObject({
      apiBaseUrl: config.apiBaseUrl,
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      selfHosted: true,
    });
  });

  it('preserves the deployed configuration in a web client', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    window.__READEST_RUNTIME_CONFIG = { apiBaseUrl: 'https://web.example.com' };
    localStorage.setItem('readest_custom_server_config_v1', JSON.stringify(config));
    expect(getRuntimeConfig()?.apiBaseUrl).toBe('https://web.example.com');
  });
});
