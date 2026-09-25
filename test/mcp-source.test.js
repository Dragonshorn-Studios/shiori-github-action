import assert from 'node:assert/strict';
import test from 'node:test';
import { AffineMcpSource, mcpEnvironment } from '../src/affine-mcp-source.js';

function sourceWith(responses) {
  const calls = [];
  const client = {
    async callTool(request) {
      calls.push(request);
      return { structuredContent: responses[request.name] };
    }
  };
  return { calls, source: new AffineMcpSource({ workspaceId: 'ws', skillIconProperty: 'shiori-icon' }, client) };
}

test('reads rendered documents through MCP', async () => {
  const { source, calls } = sourceWith({
    read_doc: { exists: true, title: 'Architecture', revision: 'rev', markdown: '# Architecture' }
  });
  const doc = await source.getDocument('doc-1');
  assert.equal(doc.title, 'Architecture');
  assert.equal(doc.markdown, '# Architecture');
  assert.deepEqual(doc.properties, {});
  assert.equal(calls[0].name, 'read_doc');
});

test('reads optional text properties through MCP', async () => {
  const { source } = sourceWith({
    list_doc_properties: { properties: [{ propertyId: 'icon-id', name: 'shiori-icon', type: 'text', value: 'https://example.test/icon.png', set: true }] }
  });
  assert.equal(await source.getTextProperty('doc-1', 'shiori-icon'), 'https://example.test/icon.png');
});

test('treats unavailable icon properties as optional', async () => {
  const client = { async callTool() { return { isError: true, content: [{ type: 'text', text: 'permission denied' }] }; } };
  const source = new AffineMcpSource({ workspaceId: 'ws' }, client);
  assert.equal(await source.getTextProperty('doc-1', 'shiori-icon'), null);
});

test('lists only live tagged documents through MCP', async () => {
  const { source } = sourceWith({ list_docs_by_tag: { docs: [{ id: 'live', inTrash: false }, { id: 'trashed', inTrash: true }] } });
  assert.deepEqual(await source.listTaggedDocumentIds('skill'), ['live']);
});

test('falls back to JSON text results for compatible MCP servers', async () => {
  const client = { async callTool() { return { content: [{ type: 'text', text: '{"docs":[{"id":"doc"}]}' }] }; } };
  const source = new AffineMcpSource({ workspaceId: 'ws', skillIconProperty: '' }, client);
  assert.deepEqual(await source.listTaggedDocumentIds('skill'), ['doc']);
});

test('delegates email and password authentication directly to AFFiNE MCP', () => {
  const env = mcpEnvironment({
    baseUrl: 'https://affine.example',
    workspaceId: 'ws',
    email: 'shiori@example.test',
    password: 'secret'
  });
  assert.equal(env.AFFINE_EMAIL, 'shiori@example.test');
  assert.equal(env.AFFINE_PASSWORD, 'secret');
  assert.equal(env.AFFINE_COOKIE, undefined);
  assert.equal(env.AFFINE_API_TOKEN, undefined);
});
