import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAuthConfig } from '../src/affine-auth.js';

test('requires exactly one complete authentication method', () => {
  assert.throws(() => validateAuthConfig({}), /Configure one/);
  assert.throws(() => validateAuthConfig({ email: 'bot@example.test' }), /must be provided together/);
  assert.throws(() => validateAuthConfig({ token: 'old', cookie: 'affine_session=new' }), /only one/);
  assert.doesNotThrow(() => validateAuthConfig({ email: 'bot@example.test', password: 'secret' }));
});
