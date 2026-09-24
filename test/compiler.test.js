import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import fixture from './fixtures/source.json' with { type: 'json' };
import { assignPaths, collectDocuments, compile } from '../src/compiler.js';
import { documentIdFromUrl } from '../src/links.js';
import { slugify } from '../src/model.js';

class FixtureSource {
  async getDocument(id) {
    if (!fixture[id]) throw new Error(`Unexpected export outside fixture: ${id}`);
    return structuredClone(fixture[id]);
  }
}

class TaggedFixtureSource extends FixtureSource {
  async listTaggedDocumentIds() {
    return ['architecture', 'private-doc'];
  }
}

const baseConfig = {
  baseUrl: 'https://affine.example',
  workspaceId: 'ws-123',
  rootDocumentId: 'root',
  outputDirectory: 'docs/brain',
  agentFile: 'AGENTS.md',
  pages: false,
  maxDocuments: 20
};

test('sanitizes titles into stable safe paths', () => {
  assert.equal(slugify('  Résumé / API: v2?!  '), 'resume-api-v2');
  assert.equal(slugify('../../'), 'untitled');
});

test('accepts only links bound to the configured origin and workspace', () => {
  const context = { baseUrl: baseConfig.baseUrl, workspaceId: baseConfig.workspaceId };
  assert.equal(documentIdFromUrl('https://affine.example/workspace/ws-123/good_doc', context), 'good_doc');
  assert.equal(documentIdFromUrl('https://evil.example/workspace/ws-123/secret', context), null);
  assert.equal(documentIdFromUrl('https://affine.example/workspace/other/secret', context), null);
});

test('collects only the selected same-workspace link subtree', async () => {
  const docs = await collectDocuments(new FixtureSource(), baseConfig);
  assert.deepEqual([...docs.keys()], ['root', 'architecture', 'product', 'decision-one']);
  assert.equal(docs.get('decision-one').parentId, 'architecture');
});

test('assigns hierarchy-derived deterministic paths', async () => {
  const docs = await collectDocuments(new FixtureSource(), baseConfig);
  const paths = assignPaths(docs, 'root');
  assert.equal(paths.get('root'), 'overview.md');
  assert.equal(paths.get('architecture'), 'architecture-apis.md');
  assert.equal(paths.get('decision-one'), 'architecture-apis/use-git-for-history.md');
});

test('compiles identical output and manifest across runs', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-'));
  const config = { ...baseConfig, repositoryRoot };
  const first = await compile(new FixtureSource(), config);
  const manifest1 = await readFile(join(first.outputRoot, 'manifest.json'), 'utf8');
  const overview1 = await readFile(join(first.outputRoot, 'overview.md'), 'utf8');
  const second = await compile(new FixtureSource(), config);
  const manifest2 = await readFile(join(second.outputRoot, 'manifest.json'), 'utf8');
  const overview2 = await readFile(join(second.outputRoot, 'overview.md'), 'utf8');
  assert.equal(manifest1, manifest2);
  assert.equal(overview1, overview2);
  assert.match(overview1, /\[Architecture\]\(architecture-apis\.md\)/);
  assert.doesNotMatch(manifest1, /token/i);
  const agents = await readFile(join(repositoryRoot, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Read `docs\/brain\/README\.md`/);
});

test('rejects an output directory outside the repository', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-'));
  await assert.rejects(() => compile(new FixtureSource(), { ...baseConfig, repositoryRoot, outputDirectory: '../escape' }), /escapes the repository/);
});

test('generates a dependency-free Pages shell and recursive navigation', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-pages-'));
  await compile(new FixtureSource(), { ...baseConfig, repositoryRoot, pages: true });
  const layout = await readFile(join(repositoryRoot, 'docs/_layouts/default.html'), 'utf8');
  const nav = await readFile(join(repositoryRoot, 'docs/_data/shiori-nav.yml'), 'utf8');
  const css = await readFile(join(repositoryRoot, 'docs/assets/css/shiori.css'), 'utf8');
  assert.match(layout, /include nav\.html/);
  assert.match(nav, /children:/);
  assert.match(nav, /Architecture & APIs/);
  assert.match(css, /--gold:/);
});

test('turns only exported documents with the skill tag into cross-agent skills and marketplaces', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-skills-'));
  await mkdir(join(repositoryRoot, '.claude-plugin'), { recursive: true });
  await writeFile(join(repositoryRoot, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'existing-marketplace', plugins: [{ name: 'handwritten', source: './plugins/handwritten' }] }));
  const config = {
    ...baseConfig,
    repositoryRoot,
    skillTag: 'skill',
    skillsDirectory: '.agents/skills',
    pluginDirectory: 'plugins',
    marketplaceName: 'project-knowledge',
    repository: 'example/project'
  };
  const result = await compile(new TaggedFixtureSource(), config);
  assert.equal(result.skillCount, 1);

  const canonical = await readFile(join(repositoryRoot, '.agents/skills/architecture-apis/SKILL.md'), 'utf8');
  const reference = await readFile(join(repositoryRoot, '.agents/skills/architecture-apis/references/source.md'), 'utf8');
  const claudeMarketplace = JSON.parse(await readFile(join(repositoryRoot, '.claude-plugin/marketplace.json'), 'utf8'));
  const cursorMarketplace = JSON.parse(await readFile(join(repositoryRoot, '.cursor-plugin/marketplace.json'), 'utf8'));
  const devinPlugin = JSON.parse(await readFile(join(repositoryRoot, '.devin-plugin/plugin.json'), 'utf8'));

  assert.match(canonical, /name: architecture-apis/);
  assert.match(canonical, /references\/source\.md/);
  assert.match(reference, /See \[Decision\]/);
  assert.deepEqual(claudeMarketplace.plugins.map(item => item.name), ['handwritten', 'shiori-architecture-apis']);
  assert.deepEqual(cursorMarketplace.plugins.map(item => item.name), ['shiori-architecture-apis']);
  assert.equal(devinPlugin.requiredPlugins[0].path, 'plugins/shiori-architecture-apis');
  await readFile(join(repositoryRoot, '.claude/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.cursor/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.windsurf/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.vibe/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.devin/skills/architecture-apis/SKILL.md'), 'utf8');
});
