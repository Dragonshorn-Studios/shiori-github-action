const MARKDOWN_LINK = /(!?\[[^\]]*\]\()([^\s)]+)([^)]*\))/g;

export function extractDocumentLinks(markdown, { baseUrl, workspaceId }) {
  const ids = [];
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    if (match[1].startsWith('!')) continue;
    const id = documentIdFromUrl(match[2], { baseUrl, workspaceId });
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function rewriteDocumentLinks(markdown, context, fromPath, pathById) {
  return markdown.replace(MARKDOWN_LINK, (whole, prefix, href, suffix) => {
    if (prefix.startsWith('!')) return whole;
    const id = documentIdFromUrl(href, context);
    const target = id && pathById.get(id);
    if (!target) return whole;
    const relative = relativeMarkdownPath(fromPath, target);
    return `${prefix}${relative}${suffix})`;
  });
}

export function documentIdFromUrl(raw, { baseUrl, workspaceId }) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const base = new URL(baseUrl);
  if (url.protocol !== 'affine:' && url.origin !== base.origin) return null;

  const queryWorkspace = url.searchParams.get('workspaceId') ?? url.searchParams.get('workspace');
  const queryDoc = url.searchParams.get('pageId') ?? url.searchParams.get('docId') ?? url.searchParams.get('page');
  if (queryWorkspace === workspaceId && safeId(queryDoc)) return queryDoc;

  const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
  const workspaceIndex = parts.indexOf(workspaceId);
  if (workspaceIndex >= 0) {
    const tail = parts.slice(workspaceIndex + 1).filter(part => !['doc', 'page'].includes(part));
    const candidate = tail.at(-1);
    if (safeId(candidate)) return candidate;
  }
  return null;
}

function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(value);
}

function relativeMarkdownPath(from, to) {
  const fromParts = from.split('/');
  fromParts.pop();
  const toParts = to.split('/');
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => '..'), ...toParts].join('/') || './';
}
