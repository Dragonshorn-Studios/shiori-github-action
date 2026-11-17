import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { createKnowledgeClient, searchDocuments } from '../src/knowledge.js';

const documents = [
  { id: 'root', title: 'Project Brain', summary: 'Start here for architecture and product.', tags: [], url: 'raw/overview.md' },
  { id: 'architecture', title: 'Architecture & APIs', summary: 'Boundaries and public APIs.', tags: ['skill', 'agent'], url: 'raw/architecture-apis.md' },
  { id: 'product', title: 'Product / Vision', summary: 'What we are building.', tags: [], url: 'raw/product-vision.md' }
];

const files = {
  '/shiori-brain/index.json': JSON.stringify({ schemaVersion: 1, generator: 'shiori', documents }, null, 2),
  '/shiori-brain/raw/overview.md': '# Project Brain\n\nStart here.\n',
  '/shiori-brain/raw/architecture-apis.md': '# Architecture\n\nKeep secrets out of docs.\n',
  '/shiori-brain/raw/product-vision.md': '# Product\n'
};

function fetchImpl(url) {
  const path = new URL(url).pathname;
  if (!files[path]) return new Response('missing', { status: 404 });
  return new Response(files[path], { headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'text/markdown' } });
}

function client(baseUrl = 'https://example.test/shiori-brain/') {
  return createKnowledgeClient({ baseUrl, fetchImpl });
}

test('search matches title, summary, tags, and id from the published index', async () => {
  const knowledge = client();
  const architecture = await knowledge.search('architecture');
  assert.equal(architecture[0].id, 'architecture');
  assert.equal(architecture[0].url, 'raw/architecture-apis.md');
  const tagged = await knowledge.search('skill');
  assert.deepEqual(tagged.map(item => item.id), ['architecture']);
  const listed = await knowledge.search('');
  assert.equal(listed.length, 3);
});

test('search ranks title hits above summary hits', () => {
  const ranked = searchDocuments(documents, 'product');
  assert.equal(ranked[0].id, 'product');
});

test('read_doc returns the raw markdown for an index id', async () => {
  const knowledge = client();
  const document = await knowledge.readDoc('architecture');
  assert.match(document.markdown, /Keep secrets out of docs/);
  assert.equal(document.title, 'Architecture & APIs');
});

test('knowledge client caches fetches in a plain Map', async () => {
  let calls = 0;
  const countingFetch = url => {
    calls += 1;
    return fetchImpl(url);
  };
  const knowledge = createKnowledgeClient({ baseUrl: 'https://example.test/shiori-brain/', fetchImpl: countingFetch });
  await knowledge.search('architecture');
  await knowledge.search('product');
  assert.equal(calls, 1);
  await knowledge.readDoc('root');
  await knowledge.readDoc('root');
  assert.equal(calls, 2);
});

test('read_doc refuses unknown ids and off-origin URLs', async () => {
  const knowledge = client();
  await assert.rejects(() => knowledge.readDoc('missing'), /Unknown document id/);
  const poisoned = createKnowledgeClient({
    baseUrl: 'https://example.test/shiori-brain/',
    fetchImpl: url => {
      if (String(url).endsWith('index.json')) {
        return new Response(JSON.stringify({
          documents: [{ id: 'leak', title: 'Leak', summary: '', tags: [], url: 'https://evil.test/secret.md' }]
        }));
      }
      return fetchImpl(url);
    }
  });
  await assert.rejects(() => poisoned.readDoc('leak'), /off-origin|outside the archive/);
});

test('fetch times out with a clear MCP error', async () => {
  const hangingFetch = (_url, { signal } = {}) => new Promise((_, reject) => {
    const keepAlive = setTimeout(() => {}, 1000);
    const fail = reason => {
      clearTimeout(keepAlive);
      reject(reason);
    };
    if (!signal) {
      fail(new Error('fetch is missing AbortSignal.timeout'));
      return;
    }
    if (signal.aborted) {
      fail(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => fail(signal.reason));
  });
  const knowledge = createKnowledgeClient({
    baseUrl: 'https://example.test/shiori-brain/',
    fetchImpl: hangingFetch,
    fetchTimeoutMs: 20
  });
  await assert.rejects(() => knowledge.search('architecture'), /Timed out fetching https:\/\/example\.test\/shiori-brain\/index\.json after 20ms/);
  const mcpError = await handleRequest(
    { method: 'tools/call', params: { name: 'search', arguments: { query: 'architecture' } } },
    knowledge
  ).catch(error => error);
  assert.equal(mcpError instanceof Error, true);
  assert.match(mcpError.message, /Timed out fetching https:\/\/example\.test\/shiori-brain\/index\.json after 20ms/);
});

test('MCP search and read_doc tools wrap the knowledge client', async () => {
  const knowledge = client();
  const listed = await handleRequest({ method: 'tools/list' }, knowledge);
  assert.deepEqual(listed.tools.map(tool => tool.name), ['search', 'read_doc']);
  const search = await handleRequest({ method: 'tools/call', params: { name: 'search', arguments: { query: 'apis' } } }, knowledge);
  assert.match(search.content[0].text, /architecture/);
  const read = await handleRequest({ method: 'tools/call', params: { name: 'read_doc', arguments: { id: 'root' } } }, knowledge);
  assert.match(read.content[0].text, /Start here/);
  const missing = await handleRequest({ method: 'tools/call', params: { name: 'read_doc', arguments: { id: 'nope' } } }, knowledge).catch(error => error);
  assert.equal(missing instanceof Error, true);
});

test('stdio server answers initialize', async () => {
  const serverPath = `${dirname(fileURLToPath(import.meta.url))}/../src/index.js`;
  const child = spawn(process.execPath, [serverPath, '--base-url', 'https://example.test/shiori-brain/'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } })}\n`);
  const chunks = [];
  const reply = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for MCP initialize')), 5000);
    child.stdout.on('data', chunk => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.includes('\n')) {
        clearTimeout(timeout);
        resolve(text);
      }
    });
    child.on('error', reject);
  });
  assert.match(reply, /shiori-brain/);
  child.kill();
});
