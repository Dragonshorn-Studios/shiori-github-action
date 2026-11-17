export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const MISSING_ARCHIVE = 'Pass --base-url or set SHIORI_BRAIN_BASE_URL to the published Pages origin. The server will not fall back to another project\'s archive.';

function isLocalArchiveHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function normalizeBaseUrl(value) {
  if (value == null || String(value).trim() === '') throw new Error(MISSING_ARCHIVE);
  const url = new URL(value);
  if (url.protocol === 'https:') {
    // allowed
  } else if (url.protocol === 'http:' && isLocalArchiveHost(url.hostname)) {
    // local debugging only
  } else {
    throw new Error('SHIORI_BRAIN_BASE_URL must be an https URL (http is allowed only for localhost).');
  }
  url.hash = '';
  url.search = '';
  const href = url.href.endsWith('/') ? url.href : `${url.href}/`;
  return new URL(href);
}

export function resolveIndexUrl(baseUrl) {
  return new URL('index.json', baseUrl);
}

export function resolveDocUrl(baseUrl, entry) {
  if (!entry?.url || typeof entry.url !== 'string') throw new Error('Index entry is missing a markdown URL.');
  const resolved = new URL(entry.url, baseUrl);
  if (resolved.origin !== baseUrl.origin) throw new Error(`Refusing to fetch off-origin document URL: ${resolved.href}`);
  if (!resolved.pathname.startsWith(baseUrl.pathname)) throw new Error(`Refusing to fetch document URL outside the archive: ${resolved.href}`);
  return resolved;
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

async function fetchText(url, { fetchImpl, cache, fetchTimeoutMs }) {
  const key = url.href;
  if (cache.has(key)) return cache.get(key);
  const signal = AbortSignal.timeout(fetchTimeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (isTimeoutError(error) || signal.aborted) {
      throw new Error(`Timed out fetching ${url.href} after ${fetchTimeoutMs}ms.`);
    }
    throw error;
  }
  if (!response.ok) throw new Error(`Unable to fetch ${url.href} (${response.status}).`);
  const text = await response.text();
  cache.set(key, text);
  return text;
}

function normalizeDocuments(index) {
  if (!index || typeof index !== 'object' || !Array.isArray(index.documents)) {
    throw new Error('index.json must contain a documents array.');
  }
  return index.documents.map((entry, position) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Invalid index entry at ${position}.`);
    if (!entry.id || !entry.title || !entry.url) throw new Error(`Index entry at ${position} is missing id, title, or url.`);
    return {
      id: String(entry.id),
      title: String(entry.title),
      summary: String(entry.summary ?? ''),
      tags: Array.isArray(entry.tags) ? entry.tags.map(tag => String(tag)) : [],
      url: String(entry.url)
    };
  });
}

function scoreDocument(document, tokens) {
  if (!tokens.length) return 1;
  const haystacks = [
    [document.id, 4],
    [document.title, 3],
    [document.tags.join(' '), 2],
    [document.summary, 1]
  ];
  let score = 0;
  for (const token of tokens) {
    let matched = false;
    for (const [haystack, weight] of haystacks) {
      if (haystack.toLowerCase().includes(token)) {
        score += weight;
        matched = true;
      }
    }
    if (!matched) return 0;
  }
  return score;
}

export function searchDocuments(documents, query) {
  const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return documents
    .map(document => ({ document, score: scoreDocument(document, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title) || a.document.id.localeCompare(b.document.id))
    .map(item => item.document);
}

export function createKnowledgeClient({
  baseUrl,
  fetchImpl = fetch,
  cache = new Map(),
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS
} = {}) {
  const resolvedBase = normalizeBaseUrl(baseUrl);
  let documentsPromise;

  async function loadIndex() {
    if (!documentsPromise) {
      documentsPromise = fetchText(resolveIndexUrl(resolvedBase), { fetchImpl, cache, fetchTimeoutMs })
        .then(text => normalizeDocuments(JSON.parse(text)))
        .catch(error => {
          documentsPromise = undefined;
          throw error;
        });
    }
    return documentsPromise;
  }

  return {
    baseUrl: resolvedBase.href,
    async search(query) {
      return searchDocuments(await loadIndex(), query);
    },
    async readDoc(id) {
      const documents = await loadIndex();
      const entry = documents.find(document => document.id === id);
      if (!entry) throw new Error(`Unknown document id: ${id}`);
      const markdown = await fetchText(resolveDocUrl(resolvedBase, entry), { fetchImpl, cache, fetchTimeoutMs });
      return { ...entry, markdown };
    }
  };
}
