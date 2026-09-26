import { createHash } from 'node:crypto';

export function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeMarkdown(value) {
  const normalized = normalizeExportArtifacts(String(value ?? '').replace(/\r\n?/g, '\n'));
  return renumberOrderedLists(normalized).trim() + '\n';
}

export function stableJson(value) {
  return JSON.stringify(sortObject(value), null, 2) + '\n';
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
}

function looksLikeLocalPath(value) {
  return /^(?:\.\.?\/|[\w.-]+\.(?:md|mdx|txt|ya?ml|json|toml|ini|conf)(?:\/|$))/i.test(value);
}

function normalizeExportArtifacts(value) {
  let fence = null;
  return value.split('\n').map(line => {
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!fence) {
        fence = marker;
        return `${fenceMatch[1]}${marker}${fenceMatch[3].replace(/^[ \t]+([\w.+-]+)[ \t]*$/, '$1')}`;
      }
      if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    return line
      .replace(/&#10;|&#x0*a;/gi, '\n')
      .replace(/\\~/g, '~')
      .replace(/\[([^\]\n]+)\]\(https?:\/\/([^\s)]+)\)/gi, (match, label, target) => {
        if (label.toLowerCase() !== target.toLowerCase() || !looksLikeLocalPath(label)) return match;
        return `\`${label}\``;
      });
  }).join('\n');
}

function renumberOrderedLists(value) {
  const counters = new Map();
  let listActive = false;
  let fence = null;
  return value.split('\n').map(line => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    const match = line.match(/^(\s*)1\.([ \t]+.*)$/);
    if (match) {
      const indent = match[1].replace(/\t/g, '    ').length;
      for (const key of counters.keys()) if (key > indent) counters.delete(key);
      const next = (counters.get(indent) ?? 0) + 1;
      counters.set(indent, next);
      listActive = true;
      return `${match[1]}${next}.${match[2]}`;
    }
    if (line.trim() === '' && listActive) return line;
    if (listActive && /^\s+\S/.test(line)) return line;
    counters.clear();
    listActive = false;
    return line;
  }).join('\n');
}
