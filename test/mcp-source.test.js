import assert from 'node:assert/strict';
import test from 'node:test';
import { AffineMcpSource } from '../src/affine-mcp-source.js';

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

test('reads rendered documents and text properties through MCP', async () => {
  const { source, calls } = sourceWith({
    read_doc: { exists: true, title: 'Architecture', revision: 'rev', markdown: '# Architecture' },
    list_doc_properties: { properties: [{ propertyId: 'icon-id', name: 'shiori-icon', type: 'text', value: 'https://example.test/icon.png', set: true }] }
  });
  const doc = await source.getDocument('doc-1');
  assert.equal(doc.title, 'Architecture');
  assert.equal(doc.markdown, '# Architecture');
  assert.equal(doc.properties['shiori-icon'], 'https://example.test/icon.png');
  assert.equal(calls[0].name, 'read_doc');
  assert.equal(calls[1].name, 'list_doc_properties');
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
