import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compile } from '../src/compiler.js';

const source = { async getDocument() { return { id: 'root', title: 'Root', revision: '1', updatedAt: null, markdown: '# Root' }; } };

test('updates only the managed AGENTS section', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-agent-'));
  const target = join(repositoryRoot, 'AGENTS.md');
  await writeFile(target, '# Local rules\n\nKeep me.\n\n<!-- shiori:start -->\nold\n<!-- shiori:end -->\n');
  const config = { repositoryRoot, baseUrl: 'https://affine.example', workspaceId: 'ws', rootDocumentId: 'root', outputDirectory: 'docs/brain', agentFile: 'AGENTS.md', pages: false, maxDocuments: 2 };
  await compile(source, config);
  const content = await readFile(target, 'utf8');
  assert.match(content, /Keep me\./);
  assert.doesNotMatch(content, /\nold\n/);
  assert.equal((content.match(/shiori:start/g) ?? []).length, 1);
});
