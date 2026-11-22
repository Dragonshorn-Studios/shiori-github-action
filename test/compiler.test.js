import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

class AgentNavFixtureSource extends FixtureSource {
  async getDocument(id) {
    if (id === 'comment-analyzer') {
      return {
        id: 'comment-analyzer',
        title: 'comment-analyzer',
        updatedAt: '2026-01-06T03:04:05.000Z',
        revision: 'r5',
        markdown: '# Comment Analyzer\n\nReview comments with the project voice.\n'
      };
    }
    const document = await super.getDocument(id);
    if (id === 'root') {
      document.markdown += '\nSee also [Comment Analyzer](https://affine.example/workspace/ws-123/comment-analyzer).';
    }
    return document;
  }

  async listTaggedDocumentIds(tag) {
    return tag === 'agent' ? ['comment-analyzer'] : ['architecture'];
  }
}

function navUrls(nav) {
  return [...nav.matchAll(/^\s*url: (\S+)/gm)].map(match => match[1]);
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

test('pages refuses an output-directory whose parent is the repository root', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-pages-root-'));
  const rawKeep = join(repositoryRoot, 'raw/keep.md');
  await mkdir(join(repositoryRoot, 'raw'), { recursive: true });
  await writeFile(rawKeep, '# keep\n');
  await writeFile(join(repositoryRoot, 'index.json'), '{"keep":true}\n');
  await assert.rejects(
    () => compile(new FixtureSource(), { ...baseConfig, repositoryRoot, pages: true, outputDirectory: 'brain' }),
    /pages requires a nested output-directory/
  );
  assert.equal(await readFile(rawKeep, 'utf8'), '# keep\n');
  assert.equal(await readFile(join(repositoryRoot, 'index.json'), 'utf8'), '{"keep":true}\n');
  assert.equal(existsSync(join(repositoryRoot, 'brain')), false);
});

test('generates a dependency-free Pages shell and recursive navigation', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-pages-'));
  await compile(new TaggedFixtureSource(), {
    ...baseConfig,
    repositoryRoot,
    pages: true,
    skillTag: 'skill',
    agentTag: 'agent',
    skillsDirectory: '.agents/skills',
    pluginDirectory: 'plugins'
  });
  const layout = await readFile(join(repositoryRoot, 'docs/_layouts/default.html'), 'utf8');
  const nav = await readFile(join(repositoryRoot, 'docs/_data/shiori-nav.yml'), 'utf8');
  const css = await readFile(join(repositoryRoot, 'docs/assets/css/shiori.css'), 'utf8');
  const home = await readFile(join(repositoryRoot, 'docs/index.md'), 'utf8');
  const mcp = await readFile(join(repositoryRoot, 'docs/_data/shiori-mcp.yml'), 'utf8');
  const indexText = await readFile(join(repositoryRoot, 'docs/index.json'), 'utf8');
  const index = JSON.parse(indexText);
  const raw = await readFile(join(repositoryRoot, 'docs/raw/architecture-apis.md'), 'utf8');
  const rawNested = await readFile(join(repositoryRoot, 'docs/raw/architecture-apis/use-git-for-history.md'), 'utf8');
  assert.match(layout, /include nav\.html/);
  assert.match(nav, /children:/);
  assert.match(nav, /Architecture & APIs/);
  assert.match(nav, /- title: "Agents"/);
  assert.match(nav, /- title: "Skills"/);
  assert.match(nav, /url: \/brain\/architecture-apis\.html/);
  const tree = nav.split('- title: "Agents"')[0];
  assert.doesNotMatch(tree, /architecture-apis\.html/);
  assert.match(tree, /url: \/brain\/architecture-apis\/use-git-for-history\.html/);
  assert.match(css, /--gold:/);
  assert.match(css, /--accent: #c288f7/);
  assert.match(css, /var\(--glow\)/);
  assert.match(home, /site.data.shiori-mcp/);
  assert.match(mcp, /name: "shiori-brain"/);
  assert.match(mcp, /command: "node ~\/.local\/share\/shiori\/shiori-brain\/packages\/shiori-brain-mcp\/src\/index.js"/);
  assert.match(mcp, /command: "figcraft-cli mcp"/);
  assert.match(mcp, /when_installed: true/);
  assert.doesNotMatch(mcp, /npx/);
  assert.equal(index.schemaVersion, 1);
  assert.deepEqual(index.documents.map(item => item.id).sort(), ['architecture', 'decision-one', 'product', 'root']);
  const architecture = index.documents.find(item => item.id === 'architecture');
  assert.equal(architecture.url, 'raw/architecture-apis.md');
  assert.ok(architecture.summary);
  assert.deepEqual(architecture.tags, ['skill', 'agent']);
  assert.doesNotMatch(JSON.stringify(index), /token/i);
  assert.doesNotMatch(raw, /^---$/m);
  assert.match(raw, /See \[Decision\]/);
  assert.match(rawNested, /# Decision/);
  await compile(new TaggedFixtureSource(), {
    ...baseConfig,
    repositoryRoot,
    pages: true,
    skillTag: 'skill',
    agentTag: 'agent',
    skillsDirectory: '.agents/skills',
    pluginDirectory: 'plugins'
  });
  assert.equal(await readFile(join(repositoryRoot, 'docs/index.json'), 'utf8'), indexText);
});

test('pages compile removes stale generated raw markdown and index.json', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-pages-stale-'));
  const staleRaw = join(repositoryRoot, 'docs/raw/retired.md');
  await mkdir(join(repositoryRoot, 'docs/raw'), { recursive: true });
  await writeFile(staleRaw, '# leftover\n');
  await writeFile(join(repositoryRoot, 'docs/index.json'), '{"documents":[{"id":"retired"}]}');
  await compile(new FixtureSource(), { ...baseConfig, repositoryRoot, pages: true });
  assert.equal(existsSync(staleRaw), false);
  const index = JSON.parse(await readFile(join(repositoryRoot, 'docs/index.json'), 'utf8'));
  assert.equal(index.documents.some(item => item.id === 'retired'), false);
  assert.ok(existsSync(join(repositoryRoot, 'docs/raw/overview.md')));
});

test('pages nav lists each URL once, uses agent H1 titles, and keeps untagged children', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-nav-titles-'));
  await compile(new AgentNavFixtureSource(), {
    ...baseConfig,
    repositoryRoot,
    pages: true,
    skillTag: 'skill',
    agentTag: 'agent',
    skillsDirectory: '.agents/skills',
    pluginDirectory: 'plugins'
  });
  const nav = await readFile(join(repositoryRoot, 'docs/_data/shiori-nav.yml'), 'utf8');
  const page = await readFile(join(repositoryRoot, 'docs/brain/comment-analyzer.md'), 'utf8');
  const skill = await readFile(join(repositoryRoot, '.agents/skills/comment-analyzer/SKILL.md'), 'utf8');
  const urls = navUrls(nav);
  assert.equal(urls.length, new Set(urls).size);
  assert.match(nav, /- title: "Agents"/);
  assert.match(nav, /- title: "Comment Analyzer"/);
  assert.match(nav, /url: \/brain\/comment-analyzer\.html/);
  assert.match(nav, /- title: "Skills"/);
  assert.match(nav, /Architecture & APIs/);
  const tree = nav.split('- title: "Agents"')[0];
  assert.doesNotMatch(tree, /comment-analyzer/);
  assert.doesNotMatch(tree, /Architecture & APIs/);
  assert.match(tree, /Use Git for history/);
  assert.match(tree, /url: \/brain\/architecture-apis\/use-git-for-history\.html/);
  assert.match(page, /title: "Comment Analyzer"/);
  assert.match(skill, /name: comment-analyzer/);
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
  assert.match(setupGuide, /SHIORI_INSTALL=all sh/);
  assert.match(setupGuide, /\$env:SHIORI_INSTALL='all'/);
  assert.match(setupGuide, /SHIORI_INSTALL='codex,claude,cursor'/);
  assert.match(setupGuide, /SHIORI_UPDATE=all sh/);
  assert.match(setupGuide, /\$env:SHIORI_UPDATE='all'/);
  assert.ok(setupGuide.indexOf('SHIORI_INSTALL=all sh') < setupGuide.indexOf("SHIORI_INSTALL='codex,claude,cursor'"));
  assert.match(setupGuide, /--update/);
  assert.match(setupGuide, /figcraft-cli mcp/);
  assert.match(setupGuide, /--attach 7979/);
  assert.match(setupGuide, /Program Files/);
  assert.match(setupGuide, /ArtCraft/);
  assert.match(setupGuide, /DesignCraft/);
  assert.match(setupGuide, /claude mcp add -s user/);
  assert.match(setupGuide, /Consult shiori-brain on demand/);
  assert.doesNotMatch(setupGuide, /npx -y shiori-brain-mcp/);
  const shellDoctor = await readFile(join(repositoryRoot, 'scripts/shiori-doctor.sh'), 'utf8');
  assert.match(shellDoctor, /context='remote'/);
  assert.doesNotMatch(shellDoctor, /codex plugin marketplace add /);
  assert.doesNotMatch(shellDoctor, /codex plugin add /);
  assert.doesNotMatch(shellDoctor, /claude plugin marketplace add /);
  assert.doesNotMatch(shellDoctor, /claude plugin install --scope user --yes/);
  assert.match(shellDoctor, /codex plugin remove shiori@/);
  assert.match(shellDoctor, /claude plugin uninstall shiori@/);
  assert.match(shellDoctor, /git clone --filter=blob:none/);
  assert.match(shellDoctor, /sync_shared_skills/);
  assert.match(shellDoctor, /sync_skills_dest/);
  assert.match(shellDoctor, /claude_skills_root=/);
  assert.match(shellDoctor, /Shiori: %s/);
  assert.match(shellDoctor, /shared_skills_installed/);
  assert.match(shellDoctor, /host_is_recorded/);
  assert.match(shellDoctor, /record_host codex/);
  assert.match(shellDoctor, /run_mcp_cli install --host cursor/);
  assert.match(shellDoctor, /run_mcp_cli install --host devin/);
  assert.match(shellDoctor, /run_mcp_cli install --host opencode/);
  assert.match(shellDoctor, /run_mcp_cli detect/);
  assert.match(shellDoctor, /produced no status line/);
  assert.match(shellDoctor, /mcp_configured/);
  assert.match(shellDoctor, /host_detected/);
  assert.match(shellDoctor, /select_detected_hosts/);
  assert.match(shellDoctor, /No installable hosts detected/);
  assert.doesNotMatch(shellDoctor, /Pass at least one installer/);
  assert.doesNotMatch(shellDoctor, /run_mcp_cli verify/);
  assert.match(shellDoctor, /--base-url/);
  assert.match(shellDoctor, /https:\/\/example\.github\.io\/project\//);
  assert.match(shellDoctor, /A read-only run does not launch host CLIs/);
  assert.match(shellDoctor, /--attach 7979/);
  assert.match(shellDoctor, /Program Files/);
  assert.match(shellDoctor, /--checkout \"\$checkout\"/);
  assert.match(shellDoctor, /packages\/shiori-brain-mcp\/src\/index.js/);
  assert.match(shellDoctor, /mktemp -d/);
  assert.doesNotMatch(shellDoctor, /shiori-mcp-\$\$/);
  const powerShellDoctor = await readFile(join(repositoryRoot, 'scripts/shiori-doctor.ps1'), 'utf8');
  assert.match(powerShellDoctor, /Get-Command/);
  assert.match(powerShellDoctor, /'remote'/);
  assert.match(powerShellDoctor, /Assert-PluginInstaller/);
  assert.match(powerShellDoctor, /Update-ManagedCheckout/);
  assert.match(powerShellDoctor, /New-Item -ItemType \$LinkType/);
  assert.match(powerShellDoctor, /Get-ShioriInstallStatus/);
  assert.match(powerShellDoctor, /Test-SharedSkillsInstalled/);
  assert.match(powerShellDoctor, /Sync-SkillsDest/);
  assert.match(powerShellDoctor, /\[IO\.Directory\]::Delete/);
  assert.match(powerShellDoctor, /\[IO\.File\]::Delete/);
  assert.match(powerShellDoctor, /FileAttributes\]::ReparsePoint/);
  assert.doesNotMatch(powerShellDoctor, /Remove-Item/);
  assert.match(powerShellDoctor, /ClaudeSkillsRoot/);
  assert.match(powerShellDoctor, /Test-RecordedHost/);
  assert.match(powerShellDoctor, /Add-RecordedHost codex/);
  assert.doesNotMatch(powerShellDoctor, /Install-CodexPlugin/);
  assert.doesNotMatch(powerShellDoctor, /Install-ClaudePlugin/);
  assert.match(powerShellDoctor, /Invoke-McpCli -McpArgs @\('install', '--host', 'cursor'\)/);
  assert.match(powerShellDoctor, /Invoke-McpCli -McpArgs @\('install', '--host', 'devin'\)/);
  assert.match(powerShellDoctor, /Invoke-McpCli -McpArgs @\('install', '--host', 'opencode'\)/);
  assert.match(powerShellDoctor, /Invoke-McpCli -McpArgs @\('detect'\)/);
  assert.match(powerShellDoctor, /produced no status line/);
  assert.match(powerShellDoctor, /Test-McpConfigured/);
  assert.match(powerShellDoctor, /Test-HostDetected/);
  assert.match(powerShellDoctor, /No installable hosts detected/);
  assert.doesNotMatch(powerShellDoctor, /Pass at least one installer/);
  assert.doesNotMatch(powerShellDoctor, /Invoke-McpCli -McpArgs @\('verify'\)/);
  assert.match(powerShellDoctor, /--base-url \$ArchiveUrl/);
  assert.match(powerShellDoctor, /A read-only run does not launch host CLIs/);
  assert.match(powerShellDoctor, /--attach 7979/);
  assert.match(powerShellDoctor, /Program Files/);
  assert.match(powerShellDoctor, /--checkout \$ManagedCheckout/);
  assert.match(powerShellDoctor, /packages\/shiori-brain-mcp\/src\/index.js/);
  const helper = await readFile(join(repositoryRoot, 'scripts/shiori-mcp.mjs'), 'utf8');
  assert.match(helper, /figcraft-cli/);
  assert.match(helper, /designcraft-cli/);
  assert.match(helper, /solidcraft-cli/);
  assert.match(helper, /vectorcraft-cli/);
  assert.match(helper, /MCP done/);
  assert.match(helper, /realpathSync/);
  assert.match(helper, /packages\/shiori-brain-mcp\/src\/index.js/);
  assert.doesNotMatch(helper, /npx -y shiori-brain-mcp/);
  await readFile(join(repositoryRoot, 'packages/shiori-brain-mcp/src/index.js'), 'utf8');
});
