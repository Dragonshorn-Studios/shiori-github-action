const DEFAULT_CLIENT_VERSION = '0.26.0';

export function validateAuthConfig(config) {
  const methods = [Boolean(config.token), Boolean(config.cookie), Boolean(config.email || config.password)].filter(Boolean).length;
  if (Boolean(config.email) !== Boolean(config.password)) {
    throw new Error("Inputs 'affine-email' and 'affine-password' must be provided together.");
  }
  if (methods === 0) {
    throw new Error("Configure one AFFiNE authentication method: 'affine-token', 'affine-cookie', or 'affine-email' with 'affine-password'.");
  }
  if (methods > 1) {
    throw new Error('Configure only one AFFiNE authentication method.');
  }
}

export async function resolveAuth(config, fetchImpl = fetch) {
  validateAuthConfig(config);
  if (config.token) return { token: config.token, cookie: '' };
  if (config.cookie) return { token: '', cookie: config.cookie };

  const response = await fetchImpl(new URL('/api/auth/sign-in', config.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-affine-version': process.env.AFFINE_CLIENT_VERSION || DEFAULT_CLIENT_VERSION
    },
    body: JSON.stringify({ email: config.email, password: config.password })
  });
  if (!response.ok) {
    const body = (await response.text()).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`AFFiNE sign-in failed with HTTP ${response.status}${body ? `: ${body}` : '.'}`);
  }

  const rawSetCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : splitSetCookie(response.headers.get('set-cookie') || '');
  const setCookies = rawSetCookies.flatMap(splitSetCookie);
  const cookie = setCookies.map(value => value.split(';', 1)[0]?.trim()).filter(Boolean).join('; ');
  if (!cookie) throw new Error('AFFiNE sign-in succeeded but returned no session cookie.');
  return { token: '', cookie };
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=)/);
}
