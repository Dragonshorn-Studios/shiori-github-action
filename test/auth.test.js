import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuth, validateAuthConfig } from '../src/affine-auth.js';

test('requires exactly one complete authentication method', () => {
  assert.throws(() => validateAuthConfig({}), /Configure one/);
  assert.throws(() => validateAuthConfig({ email: 'bot@example.test' }), /must be provided together/);
  assert.throws(() => validateAuthConfig({ token: 'old', cookie: 'affine_session=new' }), /only one/);
  assert.doesNotThrow(() => validateAuthConfig({ email: 'bot@example.test', password: 'secret' }));
});

test('exchanges email and password for a reusable cookie header', async () => {
  const calls = [];
  const auth = await resolveAuth({
    baseUrl: 'https://affine.example.test/base',
    email: 'bot@example.test',
    password: 'secret'
  }, async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{}', {
      status: 200,
      headers: { 'set-cookie': 'affine_session=session-value; Path=/; HttpOnly, affine_user_id=user-value; Path=/' }
    });
  });
  assert.deepEqual(auth, { token: '', cookie: 'affine_session=session-value; affine_user_id=user-value' });
  assert.equal(calls[0].url, 'https://affine.example.test/api/auth/sign-in');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'bot@example.test', password: 'secret' });
});

test('passes through token and cookie credentials without a network request', async () => {
  const failFetch = async () => { throw new Error('unexpected request'); };
  assert.deepEqual(await resolveAuth({ token: 'token' }, failFetch), { token: 'token', cookie: '' });
  assert.deepEqual(await resolveAuth({ cookie: 'affine_session=value' }, failFetch), { token: '', cookie: 'affine_session=value' });
});
