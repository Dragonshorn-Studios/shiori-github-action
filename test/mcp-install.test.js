import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { installSupportFiles } from '../src/install-support.js';
import {
  CRAFT_APPS,
  applyJsonMcpConfig,
  applyTomlMcpConfig,
  classifyEntry,
  mcpServerCatalog,
  renderMcpDataYaml,
  renderMcpMarkdownTable,
  runMcpCli,
  selectServersForInstall
} from '../src/mcp-config.js';

const shiori = { name: 'shiori-brain', command: 'npx', args: ['-y', 'shiori-brain-mcp'] };
const figcraft = { name: 'figcraft', command: 'figcraft-cli', args: ['mcp'] };

async function writeExecutable(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, { mode: 0o755 });
}

function fakeCraftPath(binDir) {
  return {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH}`
  };
}

test('craft catalog lists the known Storytold CLIs once', () => {
  assert.deepEqual(CRAFT_APPS.map(app => app.command), [
    'figcraft-cli', 'cadcraft-cli', 'deckcraft-cli', 'gridcraft-cli', 'lightcraft-cli',
    'pdfcraft-cli', 'photocraft-cli', 'wordcraft-cli', 'effectcraft-cli', 'anicraft-cli', 'soundcraft-cli'
  ]);
  const catalog = mcpServerCatalog();
  assert.equal(catalog[0].name, 'shiori-brain');
  assert.equal(catalog[0].whenInstalled, false);
  assert.equal(new Set(catalog.map(item => item.name)).size, catalog.length);
  assert.match(renderMcpMarkdownTable(), /figcraft-cli mcp/);
  assert.match(renderMcpDataYaml(), /when_installed: true/);
  assert.doesNotMatch(renderMcpMarkdownTable(), /token|secret|password/i);
});

test('JSON MCP install adds, skips absent craft CLIs, and leaves other keys alone', () => {
  const existing = JSON.stringify({
    theme: 'keep-me',
    mcpServers: {
      other: { command: 'uvx', args: ['something'] }
    }
  }, null, 2);
  const added = applyJsonMcpConfig(existing, [shiori]);
  assert.equal(added.reports[0].status, 'added');
  const parsed = JSON.parse(added.text);
  assert.equal(parsed.theme, 'keep-me');
  assert.deepEqual(parsed.mcpServers.other, { command: 'uvx', args: ['something'] });
  assert.deepEqual(parsed.mcpServers['shiori-brain'], { command: 'npx', args: ['-y', 'shiori-brain-mcp'] });

  const again = applyJsonMcpConfig(added.text, [shiori]);
  assert.equal(again.reports[0].status, 'unchanged');
  assert.equal(again.changed, false);
  assert.equal(again.text, added.text);
});

test('JSON MCP install does not overwrite a conflicting non-Shiori entry', () => {
  const existing = JSON.stringify({
    mcpServers: {
      figcraft: { command: 'docker', args: ['run', 'figcraft'] },
      'shiori-brain': { command: 'python', args: ['not-shiori'] }
    }
  });
  const result = applyJsonMcpConfig(existing, [shiori, figcraft]);
  assert.deepEqual(result.reports.map(item => item.status), ['conflict', 'conflict']);
  assert.equal(result.changed, false);
  const parsed = JSON.parse(result.text);
  assert.deepEqual(parsed.mcpServers.figcraft.command, 'docker');
  assert.deepEqual(parsed.mcpServers['shiori-brain'].command, 'python');
});

test('JSON MCP install updates a stale Shiori-owned entry', () => {
  const existing = JSON.stringify({
    mcpServers: {
      'shiori-brain': { command: 'npx', args: ['shiori-brain-mcp'], env: { KEEP: 'yes' } }
    }
  });
  const result = applyJsonMcpConfig(existing, [shiori]);
  assert.equal(result.reports[0].status, 'updated');
  const parsed = JSON.parse(result.text);
  assert.deepEqual(parsed.mcpServers['shiori-brain'].args, ['-y', 'shiori-brain-mcp']);
  assert.equal(parsed.mcpServers['shiori-brain'].env.KEEP, 'yes');
});

test('TOML MCP install appends, skips conflicts, and preserves unrelated tables', () => {
  const existing = 'model = "gpt"\n\n[projects.foo]\ntrust = true\n';
  const added = applyTomlMcpConfig(existing, [shiori]);
  assert.equal(added.reports[0].status, 'added');
  assert.match(added.text, /model = "gpt"/);
  assert.match(added.text, /\[projects\.foo\]/);
  assert.match(added.text, /\[mcp_servers\.shiori-brain\]/);

  const again = applyTomlMcpConfig(added.text, [shiori]);
  assert.equal(again.reports[0].status, 'unchanged');
  assert.equal(again.changed, false);

  const conflicted = applyTomlMcpConfig(`${added.text}\n[mcp_servers.figcraft]\ncommand = "docker"\nargs = ["run"]\n`, [figcraft]);
  assert.equal(conflicted.reports[0].status, 'conflict');
  assert.match(conflicted.text, /command = "docker"/);
});

test('classifyEntry distinguishes missing, match, stale, and conflict', () => {
  assert.equal(classifyEntry(null, shiori), 'missing');
  assert.equal(classifyEntry(shiori, shiori), 'match');
  assert.equal(classifyEntry({ command: 'npx', args: ['shiori-brain-mcp'] }, shiori), 'stale');
  assert.equal(classifyEntry({ command: 'python', args: ['mcp'] }, shiori), 'conflict');
  assert.equal(classifyEntry({ command: 'figcraft-cli', args: ['mcp', '--attach', '7979'] }, figcraft), 'conflict');
  assert.equal(classifyEntry({ command: '/opt/figcraft-cli', args: ['mcp'] }, figcraft), 'match');
});

test('selectServersForInstall skips Craft CLIs that are not on PATH', async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\necho ok\n');
  const { selected, skipped } = selectServersForInstall(mcpServerCatalog(), fakeCraftPath(binDir));
  assert.ok(selected.some(item => item.name === 'shiori-brain'));
  assert.ok(selected.some(item => item.name === 'figcraft'));
  assert.ok(skipped.some(item => item.name === 'cadcraft'));
  assert.ok(!selected.some(item => item.name === 'cadcraft'));
});

test('runMcpCli install writes cursor JSON, craft CLI, and a one-line rule without touching other servers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(join(home, '.cursor/mcp.json'), `${JSON.stringify({
    mcpServers: {
      handwritten: { command: 'keep-me', args: ['ok'] }
    }
  }, null, 2)}\n`);

  const { reports } = runMcpCli(['install', '--home', home, '--host', 'cursor'], { env: fakeCraftPath(binDir) });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers.handwritten, { command: 'keep-me', args: ['ok'] });
  assert.deepEqual(config.mcpServers['shiori-brain'].args, ['-y', 'shiori-brain-mcp']);
  assert.deepEqual(config.mcpServers.figcraft, { command: 'figcraft-cli', args: ['mcp'] });
  assert.equal(config.mcpServers.cadcraft, undefined);
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'added'));
  assert.ok(reports.some(item => item.name === 'cadcraft' && item.status === 'skipped'));
  assert.match(await readFile(join(home, '.cursor/rules/shiori-brain.mdc'), 'utf8'), /Consult shiori-brain on demand/);
  assert.doesNotMatch(await readFile(join(home, '.cursor/mcp.json'), 'utf8'), /token|secret|password/i);

  const second = runMcpCli(['install', '--home', home, '--host', 'cursor'], { env: fakeCraftPath(binDir) });
  assert.ok(second.reports.some(item => item.name === 'shiori-brain' && item.status === 'unchanged'));
  assert.ok(second.reports.some(item => item.name === 'figcraft' && item.status === 'unchanged'));
});

test('runMcpCli reports a conflicting craft entry instead of overwriting it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(join(home, '.cursor/mcp.json'), `${JSON.stringify({
    mcpServers: {
      figcraft: { command: 'docker', args: ['run', 'figcraft'] }
    }
  }, null, 2)}\n`);
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'cursor'], { env: fakeCraftPath(binDir) });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers.figcraft, { command: 'docker', args: ['run', 'figcraft'] });
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'conflict'));
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));
});

test('runMcpCli verify reports missing, ok, and conflict without writing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(join(home, '.cursor/mcp.json'), `${JSON.stringify({
    mcpServers: {
      figcraft: { command: 'docker', args: ['run'] }
    }
  }, null, 2)}\n`);
  const before = await readFile(join(home, '.cursor/mcp.json'), 'utf8');
  const { reports } = runMcpCli(['verify', '--home', home, '--host', 'cursor'], { env: { ...process.env, PATH: '/missing-bin' } });
  assert.equal(await readFile(join(home, '.cursor/mcp.json'), 'utf8'), before);
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'missing'));
});

test('generated doctor --install cursor writes MCP config using the shared helper', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  const files = installSupportFiles({ repository: 'example/project', marketplaceName: 'project-knowledge' });
  for (const [path, content] of files) {
    await mkdir(join(repositoryRoot, dirname(path)), { recursive: true });
    await writeFile(join(repositoryRoot, path), content, path.endsWith('.sh') ? { mode: 0o755 } : undefined);
  }
  execFileSync('sh', ['scripts/shiori-doctor.sh', '--install', 'cursor'], {
    cwd: repositoryRoot,
    env: { ...fakeCraftPath(binDir), HOME: home }
  });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers['shiori-brain'].command, 'npx');
  assert.deepEqual(config.mcpServers.figcraft.args, ['mcp']);
  assert.equal(config.mcpServers.cadcraft, undefined);
  const setup = await readFile(join(repositoryRoot, 'AGENT-SETUP.md'), 'utf8');
  assert.match(setup, /figcraft-cli mcp/);
  assert.match(setup, /Consult shiori-brain on demand/);
});
