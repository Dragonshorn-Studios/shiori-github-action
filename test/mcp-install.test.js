import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { installSupportFiles } from '../src/install-support.js';
import {
  CRAFT_APPS,
  applyInstructionFile,
  applyJsonMcpConfig,
  classifyEntry,
  cliGetIsNotFound,
  mcpServerCatalog,
  parseCliMcpEntry,
  renderMcpDataYaml,
  renderMcpMarkdownTable,
  runMcpCli,
  selectServersForInstall,
  shioriBrainScript
} from '../src/mcp-config.js';

const figcraft = { name: 'figcraft', command: 'figcraft-cli', args: ['mcp'] };

function shioriFor(home) {
  return {
    name: 'shiori-brain',
    command: 'node',
    args: [shioriBrainScript(join(home, '.local/share/shiori/shiori-brain'))]
  };
}

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

function positionalName(tokens) {
  const skipValue = new Set(['--scope', '--transport']);
  const names = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (skipValue.has(tokens[i])) {
      i += 1;
      continue;
    }
    if (String(tokens[i]).startsWith('--')) continue;
    names.push(tokens[i]);
  }
  return names[0];
}

function fakeHostExec(store, { getFailures = {} } = {}) {
  return (command, args = [], opts = {}) => {
    if (command !== 'claude' && command !== 'codex') return execFileSync(command, args, opts);
    const [topic, action, ...rest] = args;
    if (topic !== 'mcp') {
      const error = new Error(`unexpected ${command} ${args.join(' ')}`);
      error.status = 1;
      throw error;
    }
    if (action === 'get') {
      const json = rest.includes('--json');
      const name = rest.find(item => item !== '--json');
      if (getFailures[name]) {
        const error = new Error(getFailures[name]);
        error.status = 2;
        error.stdout = '';
        error.stderr = getFailures[name];
        throw error;
      }
      const entry = store[name];
      if (!entry) {
        const error = new Error(`Unknown MCP server: ${name}`);
        error.status = 1;
        error.stdout = '';
        error.stderr = error.message;
        throw error;
      }
      if (json) return `${JSON.stringify(entry)}\n`;
      const lines = [];
      if (entry.url) lines.push(`url: ${entry.url}`);
      if (entry.command) lines.push(`command: ${entry.command}`);
      if (entry.args) lines.push(`args: ${JSON.stringify(entry.args)}`);
      return `${lines.join('\n')}\n`;
    }
    if (action === 'add') {
      const dash = rest.indexOf('--');
      const before = dash >= 0 ? rest.slice(0, dash) : rest;
      const after = dash >= 0 ? rest.slice(dash + 1) : [];
      const name = positionalName(before);
      store[name] = { command: after[0], args: after.slice(1) };
      return '';
    }
    if (action === 'remove') {
      delete store[positionalName(rest)];
      return '';
    }
    const error = new Error(`unknown mcp action ${action}`);
    error.status = 1;
    throw error;
  };
}

test('craft catalog lists the known Storytold CLIs once', () => {
  assert.deepEqual(CRAFT_APPS.map(app => app.command), [
    'figcraft-cli', 'cadcraft-cli', 'deckcraft-cli', 'gridcraft-cli', 'lightcraft-cli',
    'pdfcraft-cli', 'photocraft-cli', 'wordcraft-cli', 'effectcraft-cli', 'anicraft-cli', 'soundcraft-cli'
  ]);
  const catalog = mcpServerCatalog();
  assert.equal(catalog[0].name, 'shiori-brain');
  assert.equal(catalog[0].command, 'node');
  assert.equal(catalog[0].args[0], '~/.local/share/shiori/shiori-brain/packages/shiori-brain-mcp/src/index.js');
  assert.equal(catalog[0].whenInstalled, false);
  assert.equal(new Set(catalog.map(item => item.name)).size, catalog.length);
  assert.match(renderMcpMarkdownTable(), /figcraft-cli mcp/);
  assert.match(renderMcpMarkdownTable(), /node ~\/.local\/share\/shiori\/shiori-brain\/packages\/shiori-brain-mcp\/src\/index.js/);
  assert.match(renderMcpDataYaml(), /when_installed: true/);
  assert.doesNotMatch(renderMcpMarkdownTable(), /npx|token|secret|password/i);
  assert.doesNotMatch(renderMcpDataYaml(), /npx/);
});

test('JSON MCP install adds, skips absent craft CLIs, and leaves other keys alone', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const shiori = shioriFor(home);
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
  assert.deepEqual(parsed.mcpServers['shiori-brain'], { command: 'node', args: shiori.args });

  const again = applyJsonMcpConfig(added.text, [shiori]);
  assert.equal(again.reports[0].status, 'unchanged');
  assert.equal(again.changed, false);
  assert.equal(again.text, added.text);
});

test('JSON MCP install does not overwrite a conflicting non-Shiori entry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const shiori = shioriFor(home);
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

test('JSON MCP install leaves url-only and HTTP entries untouched as conflicts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const shiori = shioriFor(home);
  const existing = JSON.stringify({
    mcpServers: {
      figcraft: { url: 'https://figcraft.example/mcp', headers: { Authorization: 'example' } },
      cadcraft: { url: 'https://cadcraft.example/mcp' },
      'shiori-brain': { url: 'https://other.example/mcp' }
    }
  });
  const result = applyJsonMcpConfig(existing, [shiori, figcraft, { name: 'cadcraft', command: 'cadcraft-cli', args: ['mcp'] }]);
  assert.deepEqual(result.reports.map(item => item.status), ['conflict', 'conflict', 'conflict']);
  assert.equal(result.changed, false);
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.mcpServers.figcraft.command, undefined);
  assert.deepEqual(parsed.mcpServers.figcraft, { url: 'https://figcraft.example/mcp', headers: { Authorization: 'example' } });
  assert.deepEqual(parsed.mcpServers.cadcraft, { url: 'https://cadcraft.example/mcp' });
  assert.deepEqual(parsed.mcpServers['shiori-brain'], { url: 'https://other.example/mcp' });
});

test('JSON MCP install updates a stale Shiori-owned entry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const shiori = shioriFor(home);
  const existing = JSON.stringify({
    mcpServers: {
      'shiori-brain': { command: 'node', args: ['/old/packages/shiori-brain-mcp/src/index.js'], env: { KEEP: 'yes' } }
    }
  });
  const result = applyJsonMcpConfig(existing, [shiori]);
  assert.equal(result.reports[0].status, 'updated');
  const parsed = JSON.parse(result.text);
  assert.deepEqual(parsed.mcpServers['shiori-brain'].args, shiori.args);
  assert.equal(parsed.mcpServers['shiori-brain'].env.KEEP, 'yes');
});

test('npx or other package-registry entries are conflicts, not Shiori-owned', () => {
  const desired = { name: 'shiori-brain', command: 'node', args: ['/x/packages/shiori-brain-mcp/src/index.js'] };
  assert.equal(classifyEntry({ command: 'npx', args: ['-y', 'shiori-brain-mcp'] }, desired), 'conflict');
  assert.equal(classifyEntry({ command: 'npx', args: ['shiori-brain-mcp'] }, desired), 'conflict');
});

test('classifyEntry distinguishes missing, match, stale, and conflict', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const shiori = shioriFor(home);
  assert.equal(classifyEntry(null, shiori), 'missing');
  assert.equal(classifyEntry(shiori, shiori), 'match');
  assert.equal(classifyEntry({ command: 'node', args: ['/old/packages/shiori-brain-mcp/src/index.js'] }, shiori), 'stale');
  assert.equal(classifyEntry({ command: 'python', args: ['mcp'] }, shiori), 'conflict');
  assert.equal(classifyEntry({ command: 'figcraft-cli', args: ['mcp', '--attach', '7979'] }, figcraft), 'conflict');
  assert.equal(classifyEntry({ command: '/opt/figcraft-cli', args: ['mcp'] }, figcraft), 'match');
  assert.equal(classifyEntry({ url: 'https://figcraft.example/mcp' }, figcraft), 'conflict');
  assert.equal(classifyEntry({ url: 'https://figcraft.example/mcp', headers: { Authorization: 'example' } }, figcraft), 'conflict');
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

test('runMcpCli install writes cursor JSON atomically with a backup and does not write Cursor rules', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const original = `${JSON.stringify({
    mcpServers: {
      handwritten: { command: 'keep-me', args: ['ok'] }
    }
  }, null, 2)}\n`;
  await writeFile(join(home, '.cursor/mcp.json'), original);

  const { reports } = runMcpCli(['install', '--home', home, '--host', 'cursor'], { env: fakeCraftPath(binDir) });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers.handwritten, { command: 'keep-me', args: ['ok'] });
  assert.equal(config.mcpServers['shiori-brain'].command, 'node');
  assert.equal(config.mcpServers['shiori-brain'].args[0], shioriFor(home).args[0]);
  assert.deepEqual(config.mcpServers.figcraft, { command: 'figcraft-cli', args: ['mcp'] });
  assert.equal(config.mcpServers.cadcraft, undefined);
  assert.equal(await readFile(join(home, '.cursor/mcp.json.bak'), 'utf8'), original);
  assert.equal(existsSync(join(home, '.cursor/rules/shiori-brain.mdc')), false);
  assert.equal(existsSync(join(home, '.codex/rules')), false);
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'added'));
  assert.ok(reports.some(item => item.name === 'cadcraft' && item.status === 'skipped'));
  assert.ok(!reports.some(item => item.name === 'instructions'));
  assert.doesNotMatch(await readFile(join(home, '.cursor/mcp.json'), 'utf8'), /token|secret|password/i);

  const second = runMcpCli(['install', '--home', home, '--host', 'cursor'], { env: fakeCraftPath(binDir) });
  assert.ok(second.reports.some(item => item.name === 'shiori-brain' && item.status === 'unchanged'));
  assert.ok(second.reports.some(item => item.name === 'figcraft' && item.status === 'unchanged'));
});

test('runMcpCli reports a conflicting JSON craft entry instead of overwriting it', async () => {
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

test('runMcpCli reports a JSON url-only entry as conflict and leaves it untouched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  const original = {
    mcpServers: {
      figcraft: { url: 'https://figcraft.example/mcp', headers: { Authorization: 'example' } }
    }
  };
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(join(home, '.cursor/mcp.json'), `${JSON.stringify(original, null, 2)}\n`);
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'cursor'], { env: fakeCraftPath(binDir) });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers.figcraft, original.mcpServers.figcraft);
  assert.equal(config.mcpServers.figcraft.command, undefined);
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'conflict'));
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

test('parseCliMcpEntry accepts JSON, text, and url-only host CLI output', () => {
  assert.deepEqual(parseCliMcpEntry(JSON.stringify({ command: 'node', args: ['/tmp/index.js'] })), {
    command: 'node',
    args: ['/tmp/index.js']
  });
  assert.deepEqual(parseCliMcpEntry('url: https://figcraft.example/mcp\n'), { url: 'https://figcraft.example/mcp' });
  assert.deepEqual(parseCliMcpEntry('command: figcraft-cli\nargs: ["mcp"]\n'), {
    command: 'figcraft-cli',
    args: ['mcp']
  });
});

test('Claude CLI install adds stdio servers and leaves HTTP entries as conflicts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  const store = {
    figcraft: { url: 'https://figcraft.example/mcp', headers: { Authorization: 'example' } }
  };
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'claude'], {
    env: fakeCraftPath(binDir),
    execFile: fakeHostExec(store)
  });
  assert.equal(store.figcraft.url, 'https://figcraft.example/mcp');
  assert.equal(store.figcraft.command, undefined);
  assert.equal(store['shiori-brain'].command, 'node');
  assert.equal(store['shiori-brain'].args[0], shioriFor(home).args[0]);
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'conflict'));
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));
  assert.match(await readFile(join(home, '.claude/CLAUDE.md'), 'utf8'), /<!-- shiori:start -->/);
  assert.equal(existsSync(join(home, '.claude.json')), false);
});

test('Codex CLI install leaves url-only entries untouched and does not write execpolicy rules', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeExecutable(join(binDir, 'figcraft-cli'), '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  const store = {
    figcraft: { url: 'https://figcraft.example/mcp' }
  };
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'codex'], {
    env: fakeCraftPath(binDir),
    execFile: fakeHostExec(store)
  });
  assert.deepEqual(store.figcraft, { url: 'https://figcraft.example/mcp' });
  assert.equal(store['shiori-brain'].command, 'node');
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'conflict'));
  assert.match(await readFile(join(home, '.codex/AGENTS.md'), 'utf8'), /Consult shiori-brain on demand/);
  assert.equal(existsSync(join(home, '.codex/rules')), false);
  assert.equal(existsSync(join(home, '.codex/config.toml')), false);
});

test('Claude and Codex CLI paths update stale Shiori-owned entries through remove then add', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const store = {
    'shiori-brain': { command: 'node', args: ['/old/packages/shiori-brain-mcp/src/index.js'] }
  };
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'codex'], {
    env: { ...process.env, PATH: '/missing-bin' },
    execFile: fakeHostExec(store)
  });
  assert.deepEqual(store['shiori-brain'], { command: 'node', args: shioriFor(home).args });
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'updated'));
});

test('cliGetIsNotFound accepts only clear missing-server messages', () => {
  assert.equal(cliGetIsNotFound({ stderr: 'Unknown MCP server: figcraft' }), true);
  assert.equal(cliGetIsNotFound({ stdout: 'No MCP server named shiori-brain' }), true);
  assert.equal(cliGetIsNotFound({ stderr: 'failed to connect to Anthropic API' }), false);
  assert.equal(cliGetIsNotFound({ stderr: 'claude: command not found' }), false);
});

test('Claude and Codex CLI not-found lookups add the missing Shiori server', async () => {
  for (const host of ['claude', 'codex']) {
    const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
    const store = {};
    const { reports } = runMcpCli(['install', '--home', home, '--host', host], {
      env: { ...process.env, PATH: '/missing-bin' },
      execFile: fakeHostExec(store)
    });
    assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'), host);
    assert.equal(store['shiori-brain'].command, 'node', host);
  }
});

test('Claude and Codex CLI get failures other than not-found are errors and do not add', async () => {
  for (const host of ['claude', 'codex']) {
    const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
    const store = {};
    const { reports } = runMcpCli(['install', '--home', home, '--host', host], {
      env: { ...process.env, PATH: '/missing-bin' },
      execFile: fakeHostExec(store, { getFailures: { 'shiori-brain': 'failed to connect to host MCP API' } })
    });
    assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'error'), host);
    assert.ok(reports.some(item => item.name === 'shiori-brain' && /unable to read shiori-brain/.test(item.message ?? '')), host);
    assert.equal(store['shiori-brain'], undefined, host);
  }
});

test('instruction files skip foreign content and only update a marked Shiori block', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const foreign = join(home, '.claude/CLAUDE.md');
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(foreign, '# Keep this\n');
  const skipped = applyInstructionFile(foreign, { write: true });
  assert.equal(skipped.status, 'conflict');
  assert.equal(await readFile(foreign, 'utf8'), '# Keep this\n');

  const managed = join(home, '.codex/AGENTS.md');
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(managed, '# preface\n<!-- shiori:start -->\nold\n<!-- shiori:end -->\n# tail\n');
  const updated = applyInstructionFile(managed, { write: true });
  assert.equal(updated.status, 'updated');
  const next = await readFile(managed, 'utf8');
  assert.match(next, /^# preface\n/);
  assert.match(next, /# tail\n$/);
  assert.match(next, /Consult shiori-brain on demand/);
  assert.doesNotMatch(next, /\nold\n/);
});

test('MCP helper CLI runs from a temp .mjs path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const helper = join(await mkdtemp(join(tmpdir(), 'shiori-helper-')), 'shiori-mcp-temp.mjs');
  await writeFile(helper, await readFile(new URL('../src/mcp-config.js', import.meta.url)));
  await mkdir(join(home, '.cursor'), { recursive: true });
  const stdout = execFileSync(process.execPath, [helper, 'verify', '--home', home, '--host', 'cursor'], { encoding: 'utf8' });
  assert.match(stdout, /shiori-brain missing/);
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
    env: { ...fakeCraftPath(binDir), HOME: home, SHIORI_CHECKOUT: repositoryRoot }
  });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.equal(config.mcpServers['shiori-brain'].command, 'node');
  assert.equal(config.mcpServers['shiori-brain'].args[0], join(repositoryRoot, 'packages/shiori-brain-mcp/src/index.js'));
  assert.deepEqual(config.mcpServers.figcraft.args, ['mcp']);
  assert.equal(config.mcpServers.cadcraft, undefined);
  assert.equal(existsSync(join(home, '.cursor/rules')), false);
  const setup = await readFile(join(repositoryRoot, 'AGENT-SETUP.md'), 'utf8');
  assert.match(setup, /figcraft-cli mcp/);
  assert.match(setup, /Consult shiori-brain on demand/);
  assert.doesNotMatch(setup, /npx -y shiori-brain-mcp/);
});
