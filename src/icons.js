const MIME_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);

export async function fetchSkillIcon(rawUrl, config) {
  if (!rawUrl) return null;
  const url = validateIconUrl(rawUrl, config);
  const sameOrigin = url.origin === new URL(config.baseUrl).origin;
  const headers = sameOrigin && config.token
    ? { Authorization: `Bearer ${config.token}` }
    : sameOrigin && config.cookie ? { Cookie: config.cookie } : {};
  const response = await (config.fetchImpl ?? fetch)(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Unable to download skill icon from ${url.origin}: HTTP ${response.status}.`);
  const mime = String(response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS.get(mime);
  if (!extension) throw new Error(`Skill icon '${rawUrl}' has unsupported content type '${mime || 'unknown'}'. Use PNG, JPEG, or WebP.`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > config.skillIconMaxBytes) throw new Error(`Skill icon exceeds skill-icon-max-bytes (${config.skillIconMaxBytes}).`);
  const bytes = await readLimitedBody(response, config.skillIconMaxBytes);
  if (!matchesSignature(bytes, extension)) throw new Error(`Skill icon '${rawUrl}' does not match its declared ${mime} content type.`);
  return { bytes, extension, mime };
}

async function readLimitedBody(response, limit) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error(`Skill icon exceeds skill-icon-max-bytes (${limit}).`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error(`Skill icon exceeds skill-icon-max-bytes (${limit}).`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function validateIconUrl(rawUrl, config) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Skill icon value must be an absolute URL: '${rawUrl}'.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Skill icon URL must use HTTP or HTTPS: '${rawUrl}'.`);
  if (url.username || url.password) throw new Error('Skill icon URL must not contain credentials.');
  const baseOrigin = new URL(config.baseUrl).origin;
  const allowed = new Set([baseOrigin, ...(config.skillIconAllowedOrigins ?? [])]);
  if (!allowed.has(url.origin)) throw new Error(`Skill icon origin '${url.origin}' is not allowed. Add it to skill-icon-allowed-origins.`);
  return url;
}

function matchesSignature(bytes, extension) {
  if (extension === 'png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === 'jpg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === 'webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
