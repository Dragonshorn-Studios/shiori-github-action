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
  async getDocument(id) {
    const document = await super.getDocument(id);
    if (id === 'architecture') {
      document.properties = { 'shiori-icon': 'https://affine.example/assets/architecture.png' };
      document.markdown = `> Review architecture changes proactively.\n\n${document.markdown}`;
    }
    return document;
  }

  async listTaggedDocumentIds(tag) {
    return tag === 'agent' ? ['architecture'] : ['architecture', 'private-doc'];
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
  assert.match(css, /--accent: #c288f7/);
  assert.match(css, /var\(--glow\)/);
});

test('turns only exported tagged documents into cross-agent skills, native agents, and marketplaces', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-skills-'));
  await mkdir(join(repositoryRoot, '.claude-plugin'), { recursive: true });
  await writeFile(join(repositoryRoot, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'existing-marketplace', plugins: [{ name: 'handwritten', source: './plugins/handwritten' }] }));
  const config = {
    ...baseConfig,
    repositoryRoot,
    skillTag: 'skill',
    agentTag: 'agent',
    skillsDirectory: '.agents/skills',
    pluginDirectory: 'plugins',
    marketplaceName: 'project-knowledge',
    pluginVersion: '1.1.0',
    repository: 'example/project',
    skillIconProperty: 'shiori-icon',
    skillIconAllowedOrigins: [],
    skillIconMaxBytes: 524288,
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'https://affine.example/assets/architecture.png');
      assert.equal(options.headers.Authorization, undefined);
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), { headers: { 'content-type': 'image/png' } });
    }
  };
  const result = await compile(new TaggedFixtureSource(), config);
  assert.equal(result.skillCount, 1);
  assert.equal(result.agentCount, 1);

  const canonical = await readFile(join(repositoryRoot, '.agents/skills/architecture-apis/SKILL.md'), 'utf8');
  const reference = await readFile(join(repositoryRoot, '.agents/skills/architecture-apis/references/source.md'), 'utf8');
  const claudeMarketplace = JSON.parse(await readFile(join(repositoryRoot, '.claude-plugin/marketplace.json'), 'utf8'));
  const cursorMarketplace = JSON.parse(await readFile(join(repositoryRoot, '.cursor-plugin/marketplace.json'), 'utf8'));
  const zcodeMarketplace = JSON.parse(await readFile(join(repositoryRoot, 'marketplace.json'), 'utf8'));
  const cursorPlugin = JSON.parse(await readFile(join(repositoryRoot, 'plugins/shiori/.cursor-plugin/plugin.json'), 'utf8'));
  const zcodePlugin = JSON.parse(await readFile(join(repositoryRoot, 'plugins/shiori/.zcode-plugin/plugin.json'), 'utf8'));
  const codexPlugin = JSON.parse(await readFile(join(repositoryRoot, 'plugins/shiori/.codex-plugin/plugin.json'), 'utf8'));
  const portablePlugin = JSON.parse(await readFile(join(repositoryRoot, 'plugins/shiori/plugin.json'), 'utf8'));
  const codexMarketplace = JSON.parse(await readFile(join(repositoryRoot, '.agents/plugins/marketplace.json'), 'utf8'));
  const devinPlugin = JSON.parse(await readFile(join(repositoryRoot, '.devin-plugin/plugin.json'), 'utf8'));
  const claudeAgent = await readFile(join(repositoryRoot, '.claude/agents/architecture-apis.md'), 'utf8');
  const pluginAgent = await readFile(join(repositoryRoot, 'plugins/shiori/agents/architecture-apis.md'), 'utf8');

  assert.match(canonical, /name: architecture-apis/);
  assert.match(canonical, /references\/source\.md/);
  assert.match(reference, /See \[Decision\]/);
  assert.deepEqual(claudeMarketplace.plugins.map(item => item.name), ['handwritten', 'shiori']);
  assert.equal(claudeMarketplace.plugins.at(-1).version, '1.1.0');
  assert.deepEqual(cursorMarketplace.plugins.map(item => item.name), ['shiori']);
  assert.equal(cursorMarketplace.metadata.version, '1.1.0');
  assert.equal(cursorPlugin.logo, 'assets/icon.png');
  assert.equal(cursorPlugin.version, '1.1.0');
  assert.equal(zcodePlugin.skills, 'skills');
  assert.equal(zcodePlugin.agents, 'agents');
  assert.equal(codexPlugin.skills, './skills/');
  assert.equal(portablePlugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(codexMarketplace.plugins[0].source.path, './plugins/shiori');
  assert.equal(codexMarketplace.plugins[0].policy.installation, 'AVAILABLE');
  assert.equal(codexMarketplace.plugins[0].category, 'Productivity');
  assert.equal(zcodeMarketplace.plugins[0].icon, 'https://raw.githubusercontent.com/example/project/HEAD/plugins/shiori/assets/icon.png');
  assert.equal(zcodeMarketplace.plugins[0].version, '1.1.0');
  assert.equal(codexPlugin.version, '1.1.0');
  assert.equal(devinPlugin.version, '1.1.0');
  assert.deepEqual(devinPlugin.requiredPlugins, []);
  assert.match(claudeAgent, /name: architecture-apis/);
  assert.match(claudeAgent, /description: "Review architecture changes proactively\."/);
  assert.equal(pluginAgent, claudeAgent);
  assert.deepEqual(await readFile(join(repositoryRoot, 'plugins/shiori/assets/icon.png')), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
  await readFile(join(repositoryRoot, 'plugins/shiori/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, 'skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.claude/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.cursor/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.windsurf/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.vibe/skills/architecture-apis/SKILL.md'), 'utf8');
  await readFile(join(repositoryRoot, '.devin/skills/architecture-apis/SKILL.md'), 'utf8');
  const setupGuide = await readFile(join(repositoryRoot, 'AGENT-SETUP.md'), 'utf8');
  assert.match(setupGuide, /curl -fsSL/);
  assert.match(setupGuide, /irm .* \| iex/);
  assert.match(await readFile(join(repositoryRoot, 'scripts/shiori-doctor.sh'), 'utf8'), /context='remote'/);
  const powerShellDoctor = await readFile(join(repositoryRoot, 'scripts/shiori-doctor.ps1'), 'utf8');
  assert.match(powerShellDoctor, /Get-Command/);
  assert.match(powerShellDoctor, /'remote'/);
});
