#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeClient } from './knowledge.js';

const PROTOCOL_VERSION = '2024-11-05';
const TOOLS = [
  {
    name: 'search',
    description: 'Search the published Shiori knowledge archive. Returns matching document ids, titles, summaries, tags, and markdown URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive words to match against id, title, summary, and tags. Empty lists the archive.' }
      }
    }
  },
  {
    name: 'read_doc',
    description: 'Read the raw markdown for one published Shiori document by id from the Pages snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id from search or index.json.' }
      },
      required: ['id']
    }
  }
];

export function parseBaseUrl(argv, env) {
  const flagIndex = argv.indexOf('--base-url');
  if (flagIndex >= 0) {
    const value = argv[flagIndex + 1];
    if (!value || value.startsWith('-')) {
      throw new Error('Pass a Pages origin after --base-url. The server will not fall back to another project\'s archive.');
    }
    return value;
  }
  if (env.SHIORI_BRAIN_BASE_URL) return env.SHIORI_BRAIN_BASE_URL;
  throw new Error('Pass --base-url or set SHIORI_BRAIN_BASE_URL to the published Pages origin. The server will not fall back to another project\'s archive.');
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

export async function handleRequest(message, knowledge) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'shiori-brain', version: '1.0.0' }
    };
  }
  if (message.method === 'ping' || message.method === 'notifications/initialized') return null;
  if (message.method === 'tools/list') return { tools: TOOLS };
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (name === 'search') {
      const hits = await knowledge.search(args.query ?? '');
      return textResult(JSON.stringify(hits, null, 2));
    }
    if (name === 'read_doc') {
      if (!args.id) throw new Error('read_doc requires id.');
      const document = await knowledge.readDoc(String(args.id));
      return textResult(document.markdown);
    }
    throw new Error(`Unknown tool: ${name}`);
  }
  throw new Error(`Unknown method: ${message.method}`);
}

export function createStdioServer(knowledge) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (message.method && String(message.method).startsWith('notifications/')) {
      try { await handleRequest(message, knowledge); } catch { /* notifications have no response */ }
      return;
    }
    if (message.id == null) return;
    try {
      const result = await handleRequest(message, knowledge);
      send({ jsonrpc: '2.0', id: message.id, result: result ?? {} });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (message.method === 'tools/call') {
        send({ jsonrpc: '2.0', id: message.id, result: textResult(text, true) });
        return;
      }
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: text } });
    }
  });
  return rl;
}

function invokedDirectly() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(argv1);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const knowledge = createKnowledgeClient({ baseUrl: parseBaseUrl(process.argv.slice(2), process.env) });
  createStdioServer(knowledge);
}
