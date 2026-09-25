import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSkillIcon } from '../src/icons.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const config = {
  baseUrl: 'https://affine.example',
  token: 'secret',
  skillIconAllowedOrigins: [],
  skillIconMaxBytes: 1024
};

test('downloads a same-origin AFFiNE icon with bearer authentication', async () => {
  let authorization;
  const result = await fetchSkillIcon('https://affine.example/api/icon', {
    ...config,
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }
  });
  assert.equal(authorization, 'Bearer secret');
  assert.equal(result.extension, 'png');
  assert.deepEqual(result.bytes, png);
});

test('downloads a same-origin AFFiNE icon with session-cookie authentication', async () => {
  let cookie;
  await fetchSkillIcon('https://affine.example/api/icon', {
    ...config,
    token: '',
    cookie: 'affine_session=session-value',
    fetchImpl: async (_url, options) => {
      cookie = options.headers.Cookie;
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }
  });
  assert.equal(cookie, 'affine_session=session-value');
});

test('rejects icon origins that were not explicitly allowed', async () => {
  await assert.rejects(() => fetchSkillIcon('https://cdn.example/icon.png', config), /not allowed/);
});

test('allows configured external origins without leaking the AFFiNE token', async () => {
  let authorization = 'not-called';
  const result = await fetchSkillIcon('https://cdn.example/icon.png', {
    ...config,
    skillIconAllowedOrigins: ['https://cdn.example'],
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }
  });
  assert.equal(authorization, undefined);
  assert.equal(result.extension, 'png');
});

test('enforces the byte limit when content-length is absent', async () => {
  await assert.rejects(() => fetchSkillIcon('https://affine.example/icon.png', {
    ...config,
    skillIconMaxBytes: 8,
    fetchImpl: async () => new Response(png, { headers: { 'content-type': 'image/png' } })
  }), /exceeds skill-icon-max-bytes/);
});

test('rejects mismatched image content', async () => {
  await assert.rejects(() => fetchSkillIcon('https://affine.example/icon.png', {
    ...config,
    fetchImpl: async () => new Response('not a png', { headers: { 'content-type': 'image/png' } })
  }), /does not match/);
});
