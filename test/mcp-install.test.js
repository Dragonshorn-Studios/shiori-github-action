import assert from 'node:assert/strict';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { installSupportFiles } from '../src/install-support.js';
import {
  ARCHIVE_URL as DOCTOR_ARCHIVE_URL,
  baseDoctorEnv,
  forEachDoctorKind,
  isWindows,
  makeUpstreamRepo,
  runDoctor,
  writeDoctorTree,
  writeFakeGit
} from './doctor-fixtures.js';
import {
  ARCHIVE_ENV,
  CRAFT_APPS,
  applyInstructionFile,
  applyJsonMcpConfig,
  classifyEntry,
  cliGetIsNotFound,
  githubPagesUrl,
  mcpServerCatalog,
  normalizeArchiveUrl,
  parseCliMcpEntry,
  renderMcpDataYaml,
  renderMcpMarkdownTable,
  runMcpCli,
  selectServersForInstall,
  shioriBrainScript
} from '../src/mcp-config.js';

const figcraft = { name: 'figcraft', command: 'figcraft-cli', args: ['mcp'] };
const ARCHIVE_URL = 'https://example.github.io/project/';

function withArchive(env = process.env) {
  return { ...env, [ARCHIVE_ENV]: ARCHIVE_URL };
}

function shioriFor(home, archiveUrl = ARCHIVE_URL) {
  return {
    name: 'shiori-brain',
    command: 'node',
    args: [shioriBrainScript(join(home, '.local/share/shiori/shiori-brain'))],
    env: { [ARCHIVE_ENV]: archiveUrl }
  };
}

async function writeExecutable(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, { mode: 0o755 });
}

async function writeCraftCli(binDir) {
  await writeExecutable(
    join(binDir, isWindows ? 'figcraft-cli.cmd' : 'figcraft-cli'),
    isWindows
      ? '@echo off\r\nif "%~1"=="--version" (echo figcraft-cli 0.0.0 & exit /b 0)\r\necho ok\r\nexit /b 0\r\n'
      : '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\necho ok\nexit 0\n'
  );
}

function fakeCraftPath(binDir) {
  return withArchive({
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH}`
  });
}

function positionalName(tokens) {
  const skipValue = new Set(['--scope', '--transport', '--env']);
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

function parseEnvFlags(tokens) {
  const env = {};
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== '--env') continue;
    const assignment = tokens[i + 1];
    i += 1;
    if (!assignment) continue;
    const eq = assignment.indexOf('=');
    if (eq <= 0) continue;
    env[assignment.slice(0, eq)] = assignment.slice(eq + 1);
  }
  return Object.keys(env).length ? env : undefined;
}

function formatClaudeGet(name, entry) {
  if (entry.url) {
    return `${name}:
  Scope: User config (available in all your projects)
  Status: ✓ Connected
  Type: http
  URL: ${entry.url}
`;
  }
  const args = Array.isArray(entry.args) ? entry.args.join(' ') : '';
  const envLines = entry.env
    ? Object.entries(entry.env).map(([key, value]) => `    ${key}: ${value}`).join('\n')
    : '';
  return `${name}:
  Scope: User config (available in all your projects)
  Status: ✓ Connected
  Type: stdio
  Command: ${entry.command}
  Args: ${args}
  Environment:
${envLines}
To remove this server, run: claude mcp remove "${name}" -s user
`;
}

function formatCodexGet(name, entry) {
  if (entry.url) {
    return JSON.stringify({
      name,
      enabled: true,
      transport: {
        type: 'streamable_http',
        url: entry.url,
        http_headers: entry.headers ?? null
      }
    }, null, 2);
  }
  return JSON.stringify({
    name,
    enabled: true,
    transport: {
      type: 'stdio',
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env ?? null,
      cwd: null
    }
  }, null, 2);
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
        const error = new Error(`not found: ${name}`);
        error.status = 1;
        error.stdout = '';
        error.stderr = command === 'claude'
          ? `No MCP server found with name: "${name}". Configured servers:`
          : `No MCP server named '${name}' found.`;
        throw error;
      }
      return json ? `${formatCodexGet(name, entry)}\n` : formatClaudeGet(name, entry);
    }
    if (action === 'add') {
      const dash = rest.indexOf('--');
      const before = dash >= 0 ? rest.slice(0, dash) : rest;
      const after = dash >= 0 ? rest.slice(dash + 1) : [];
      const name = positionalName(before);
      const env = parseEnvFlags(before);
      store[name] = { command: after[0], args: after.slice(1), ...(env ? { env } : {}) };
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
  assert.deepEqual(parsed.mcpServers['shiori-brain'], { command: 'node', args: shiori.args, env: shiori.env });

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
  assert.equal(parsed.mcpServers['shiori-brain'].env[ARCHIVE_ENV], ARCHIVE_URL);
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
  assert.equal(classifyEntry({ command: 'node', args: shiori.args }, shiori), 'stale');
  assert.equal(classifyEntry({ command: 'node', args: shiori.args, env: { [ARCHIVE_ENV]: ARCHIVE_URL } }, shiori), 'match');
});

test('selectServersForInstall skips Craft CLIs that are not on PATH', async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeCraftCli(binDir);
  const { selected, skipped } = selectServersForInstall(mcpServerCatalog(), fakeCraftPath(binDir));
  assert.ok(selected.some(item => item.name === 'shiori-brain'));
  assert.ok(selected.some(item => item.name === 'figcraft'));
  assert.ok(skipped.some(item => item.name === 'cadcraft'));
  assert.ok(!selected.some(item => item.name === 'cadcraft'));
});

test('runMcpCli install writes cursor JSON atomically with a backup and does not write Cursor rules', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeCraftCli(binDir);
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
  assert.equal(config.mcpServers['shiori-brain'].env[ARCHIVE_ENV], ARCHIVE_URL);
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

test('runMcpCli install writes Devin user-scope MCP config', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  await mkdir(join(home, '.config/devin'), { recursive: true });
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'devin'], {
    env: withArchive({ ...process.env, PATH: '/missing-bin' })
  });
  const config = JSON.parse(await readFile(join(home, '.config/devin/mcp_config.json'), 'utf8'));
  assert.equal(config.mcpServers['shiori-brain'].command, 'node');
  assert.deepEqual(config.mcpServers['shiori-brain'].args, shioriFor(home).args);
  assert.equal(config.mcpServers['shiori-brain'].env[ARCHIVE_ENV], ARCHIVE_URL);
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));

  const second = runMcpCli(['install', '--home', home, '--host', 'devin'], {
    env: withArchive({ ...process.env, PATH: '/missing-bin' })
  });
  assert.ok(second.reports.some(item => item.name === 'shiori-brain' && item.status === 'unchanged'));
});

test('runMcpCli install writes OpenCode mcp.servers entries to opencode.jsonc', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  await mkdir(join(home, '.config/opencode'), { recursive: true });
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'opencode'], {
    env: withArchive({ ...process.env, PATH: '/missing-bin' })
  });
  assert.equal(existsSync(join(home, '.config/opencode/opencode.json')), false);
  const config = JSON.parse(await readFile(join(home, '.config/opencode/opencode.jsonc'), 'utf8'));
  const shiori = config.mcp.servers['shiori-brain'];
  assert.equal(shiori.type, 'local');
  assert.deepEqual(shiori.command, ['node', ...shioriFor(home).args]);
  assert.equal(shiori.environment[ARCHIVE_ENV], ARCHIVE_URL);
  assert.equal(config.mcp.servers.figcraft, undefined);
  assert.equal(config.mcpServers, undefined);
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));

  const second = runMcpCli(['install', '--home', home, '--host', 'opencode'], {
    env: withArchive({ ...process.env, PATH: '/missing-bin' })
  });
  assert.ok(second.reports.some(item => item.name === 'shiori-brain' && item.status === 'unchanged'));
});

test('runMcpCli updates an existing opencode.json in place and preserves other keys', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  await mkdir(join(home, '.config/opencode'), { recursive: true });
  await writeFile(join(home, '.config/opencode/opencode.json'), `${JSON.stringify({
    model: 'anthropic/claude-sonnet-5-5',
    mcp: { servers: { other: { type: 'local', command: ['other-cmd'] } } }
  }, null, 2)}\n`);
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'opencode'], {
    env: withArchive({ ...process.env, PATH: '/missing-bin' })
  });
  assert.equal(existsSync(join(home, '.config/opencode/opencode.jsonc')), false);
  const config = JSON.parse(await readFile(join(home, '.config/opencode/opencode.json'), 'utf8'));
  assert.equal(config.model, 'anthropic/claude-sonnet-5-5');
  assert.deepEqual(config.mcp.servers.other, { type: 'local', command: ['other-cmd'] });
  assert.equal(config.mcp.servers['shiori-brain'].type, 'local');
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));
});

test('OpenCode shape classifies foreign, stale, and matching entries like other hosts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const shiori = shioriFor(home);
  const existing = JSON.stringify({
    mcp: {
      servers: {
        'shiori-brain': { type: 'local', command: ['node', '/old/packages/shiori-brain-mcp/src/index.js'], disabled: true },
        figcraft: { type: 'remote', url: 'https://figcraft.example/mcp' }
      }
    }
  });
  const result = applyJsonMcpConfig(existing, [shiori, figcraft], 'opencode');
  assert.deepEqual(result.reports.map(item => item.status), ['updated', 'conflict']);
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.mcp.servers['shiori-brain'].disabled, true);
  assert.deepEqual(parsed.mcp.servers['shiori-brain'].command, ['node', ...shiori.args]);
  assert.equal(parsed.mcp.servers['shiori-brain'].environment[ARCHIVE_ENV], ARCHIVE_URL);
  assert.deepEqual(parsed.mcp.servers.figcraft, { type: 'remote', url: 'https://figcraft.example/mcp' });
});

test('runMcpCli reports a conflicting JSON craft entry instead of overwriting it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeCraftCli(binDir);
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
  await writeCraftCli(binDir);
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
  const { reports } = runMcpCli(['verify', '--home', home, '--host', 'cursor'], { env: withArchive({ ...process.env, PATH: '/missing-bin' }) });
  assert.equal(await readFile(join(home, '.cursor/mcp.json'), 'utf8'), before);
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'missing'));
});

function shellDoctorFn(name) {
  const doctor = installSupportFiles({ repository: 'nopath' }).get('scripts/shiori-doctor.sh');
  const match = doctor.match(new RegExp(`\\n${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`));
  assert.ok(match, `${name} missing from doctor`);
  return match[0];
}

function shellArchiveUrl(repository) {
  const script = [
    'repository="$1"',
    'default_archive_url=""',
    'unset SHIORI_BRAIN_BASE_URL',
    shellDoctorFn('archive_url'),
    'archive_url'
  ].join('\n');
  try {
    return execFileSync('sh', ['-c', script, 'archive_url', repository], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function shellAllowsArchiveUrl(url) {
  const script = [shellDoctorFn('is_allowed_archive_url'), 'is_allowed_archive_url "$1"'].join('\n');
  try {
    execFileSync('sh', ['-c', script, 'is_allowed_archive_url', url], { encoding: 'utf8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('githubPagesUrl derives the published Pages origin', () => {
  assert.equal(githubPagesUrl('example/project'), 'https://example.github.io/project/');
  assert.equal(githubPagesUrl('example/Project'), 'https://example.github.io/Project/');
  assert.equal(githubPagesUrl('Dragonshorn-Studios/shiori-brain'), 'https://dragonshorn-studios.github.io/shiori-brain/');
  assert.equal(githubPagesUrl('Acme/acme.github.io'), 'https://acme.github.io/');
  assert.equal(githubPagesUrl('Acme/Acme.github.io'), 'https://acme.github.io/');
  assert.equal(githubPagesUrl(''), '');
  if (!isWindows) {
    for (const repository of ['example/project', 'example/Project', 'Dragonshorn-Studios/shiori-brain', 'Acme/acme.github.io', 'Acme/Acme.github.io', '']) {
      assert.equal(shellArchiveUrl(repository), githubPagesUrl(repository), repository);
    }
  }
});

test('normalizeArchiveUrl allows https and localhost http only', () => {
  assert.equal(normalizeArchiveUrl('https://example.github.io/project'), 'https://example.github.io/project/');
  assert.equal(normalizeArchiveUrl('http://localhost:4173/archive'), 'http://localhost:4173/archive/');
  assert.equal(normalizeArchiveUrl('http://127.0.0.1/'), 'http://127.0.0.1/');
  assert.equal(normalizeArchiveUrl('http://[::1]/brain'), 'http://[::1]/brain/');
  assert.throws(() => normalizeArchiveUrl('http://example.github.io/project/'), /https URL/);
  assert.throws(() => normalizeArchiveUrl('http://localhost.evil.example/'), /https URL/);
  assert.throws(
    () => runMcpCli(['verify', '--home', '/tmp', '--host', 'cursor'], { env: { ...process.env, [ARCHIVE_ENV]: 'http://example.github.io/project/' } }),
    /https URL/
  );
  if (!isWindows) {
    assert.ok(shellAllowsArchiveUrl('https://example.github.io/Project/'));
    assert.ok(shellAllowsArchiveUrl('http://localhost:4173/archive'));
    assert.ok(shellAllowsArchiveUrl('http://127.0.0.1/'));
    assert.ok(shellAllowsArchiveUrl('http://[::1]/brain'));
    assert.equal(shellAllowsArchiveUrl('http://example.github.io/project/'), false);
    assert.equal(shellAllowsArchiveUrl('http://localhost.evil.example/'), false);
  }
});

test('parseCliMcpEntry reads Claude labeled get and Codex transport JSON', () => {
  const claudeFound = `shiori-brain:
  Scope: User config (available in all your projects)
  Status: ✓ Connected
  Type: stdio
  Command: node
  Args: /tmp/packages/shiori-brain-mcp/src/index.js
  Environment:
    SHIORI_BRAIN_BASE_URL: https://example.github.io/project/
To remove this server, run: claude mcp remove "shiori-brain" -s user
`;
  assert.deepEqual(parseCliMcpEntry(claudeFound), {
    type: 'stdio',
    command: 'node',
    args: ['/tmp/packages/shiori-brain-mcp/src/index.js'],
    env: { [ARCHIVE_ENV]: ARCHIVE_URL }
  });
  assert.deepEqual(parseCliMcpEntry(`figcraft:
  Scope: User config (available in all your projects)
  Status: ✓ Connected
  Type: http
  URL: https://figcraft.example/mcp
`), {
    type: 'http',
    url: 'https://figcraft.example/mcp'
  });
  assert.deepEqual(parseCliMcpEntry(JSON.stringify({
    name: 'shiori-brain',
    enabled: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: ['/tmp/packages/shiori-brain-mcp/src/index.js'],
      env: { [ARCHIVE_ENV]: ARCHIVE_URL },
      cwd: null
    }
  }, null, 2)), {
    command: 'node',
    args: ['/tmp/packages/shiori-brain-mcp/src/index.js'],
    url: undefined,
    type: 'stdio',
    env: { [ARCHIVE_ENV]: ARCHIVE_URL },
    headers: undefined
  });
  assert.deepEqual(parseCliMcpEntry(JSON.stringify({
    name: 'figcraft',
    enabled: true,
    transport: { type: 'streamable_http', url: 'https://figcraft.example/mcp', http_headers: null }
  })), {
    command: undefined,
    args: undefined,
    url: 'https://figcraft.example/mcp',
    type: 'streamable_http',
    env: undefined,
    headers: undefined
  });
});

test('Claude CLI install adds stdio servers and leaves HTTP entries as conflicts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeCraftCli(binDir);
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
  assert.equal(store['shiori-brain'].env[ARCHIVE_ENV], ARCHIVE_URL);
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'conflict'));
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));
  assert.match(await readFile(join(home, '.claude/CLAUDE.md'), 'utf8'), /<!-- shiori:start -->/);
  assert.equal(existsSync(join(home, '.claude.json')), false);
});

test('Codex CLI install leaves url-only entries untouched and does not write execpolicy rules', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  await writeCraftCli(binDir);
  const store = {
    figcraft: { url: 'https://figcraft.example/mcp' }
  };
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'codex'], {
    env: fakeCraftPath(binDir),
    execFile: fakeHostExec(store)
  });
  assert.deepEqual(store.figcraft, { url: 'https://figcraft.example/mcp' });
  assert.equal(store['shiori-brain'].command, 'node');
  assert.equal(store['shiori-brain'].env[ARCHIVE_ENV], ARCHIVE_URL);
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
    env: withArchive({ ...process.env, PATH: '/missing-bin' }),
    execFile: fakeHostExec(store)
  });
  assert.deepEqual(store['shiori-brain'], { command: 'node', args: shioriFor(home).args, env: { [ARCHIVE_ENV]: ARCHIVE_URL } });
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'updated'));
});

test('cliGetIsNotFound accepts only Claude and Codex missing-server messages', () => {
  assert.equal(cliGetIsNotFound({ stderr: 'No MCP server found with name: "shiori-brain". Configured servers:' }), true);
  assert.equal(cliGetIsNotFound({ stdout: 'No MCP server found with name: "shiori-brain"' }), true);
  assert.equal(cliGetIsNotFound({ stderr: "No MCP server named 'shiori-brain' found." }), true);
  assert.equal(cliGetIsNotFound({ stdout: 'No MCP servers configured. Use `claude mcp add` to add a server.' }), true);
  assert.equal(cliGetIsNotFound({ stderr: 'Unknown MCP server: figcraft' }), false);
  assert.equal(cliGetIsNotFound({ stderr: 'failed to connect to Anthropic API' }), false);
  assert.equal(cliGetIsNotFound({ stderr: 'claude: command not found' }), false);
  assert.equal(cliGetIsNotFound({ stderr: 'unable to parse mcp get output' }), false);
});

test('Claude and Codex CLI not-found lookups add the missing Shiori server', async () => {
  for (const host of ['claude', 'codex']) {
    const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
    const store = {};
    const { reports } = runMcpCli(['install', '--home', home, '--host', host], {
      env: withArchive({ ...process.env, PATH: '/missing-bin' }),
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
      env: withArchive({ ...process.env, PATH: '/missing-bin' }),
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
  const stdout = execFileSync(process.execPath, [helper, 'verify', '--home', home, '--host', 'cursor', '--base-url', ARCHIVE_URL], { encoding: 'utf8' });
  assert.match(stdout, /shiori-brain missing/);
});

test('runMcpCli refuses to install without a Pages archive origin', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const env = { ...process.env, PATH: '/missing-bin' };
  delete env[ARCHIVE_ENV];
  assert.throws(
    () => runMcpCli(['install', '--home', home, '--host', 'cursor'], { env }),
    /will not fall back to another project's archive/
  );
});

test('writeJsonAtomic preserves the existing Cursor config mode', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const path = join(home, '.cursor/mcp.json');
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(path, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  chmodSync(path, 0o600);
  runMcpCli(['install', '--home', home, '--host', 'cursor'], { env: withArchive({ ...process.env, PATH: '/missing-bin' }) });
  if (!isWindows) assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(existsSync(path), true);
});

test('Claude mcp get not-found on stdout still adds, and other parse failures do not', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const store = {};
  const execFile = (command, args = [], opts = {}) => {
    if (command !== 'claude') return execFileSync(command, args, opts);
    const [topic, action, ...rest] = args;
    if (topic === 'mcp' && action === 'get') {
      return `No MCP server found with name: "${rest[0]}". Configured servers:\n`;
    }
    return fakeHostExec(store)(command, args, opts);
  };
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'claude'], {
    env: withArchive({ ...process.env, PATH: '/missing-bin' }),
    execFile
  });
  assert.ok(reports.some(item => item.name === 'shiori-brain' && item.status === 'added'));
  assert.equal(store['shiori-brain'].command, 'node');

  const opaque = {};
  const opaqueExec = (command, args = [], opts = {}) => {
    if (command !== 'claude') return execFileSync(command, args, opts);
    const [topic, action] = args;
    if (topic === 'mcp' && action === 'get') return 'unexpected claude diagnostic without an entry\n';
    return fakeHostExec(opaque)(command, args, opts);
  };
  const failed = runMcpCli(['install', '--home', home, '--host', 'claude'], {
    env: withArchive({ ...process.env, PATH: '/missing-bin' }),
    execFile: opaqueExec
  });
  assert.ok(failed.reports.some(item => item.name === 'shiori-brain' && item.status === 'error'));
  assert.equal(opaque['shiori-brain'], undefined);
});

forEachDoctorKind('generated doctor --install cursor writes MCP config using the shared helper', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const figcraftName = isWindows ? 'figcraft-cli.cmd' : 'figcraft-cli';
  await writeExecutable(join(binDir, figcraftName), isWindows
    ? '@echo off\r\nif "%~1"=="--version" (echo figcraft-cli 0.0.0 & exit /b 0)\r\nexit /b 1\r\n'
    : '#!/bin/sh\n[ "$1" = --version ] && echo figcraft-cli 0.0.0 && exit 0\nexit 1\n');
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: { SHIORI_MARKETPLACE: 'project-knowledge' }
  });
  const result = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  const checkoutScript = join(home, '.local/share/shiori/shiori-brain/packages/shiori-brain-mcp/src/index.js');
  assert.equal(config.mcpServers['shiori-brain'].command, 'node');
  assert.equal(config.mcpServers['shiori-brain'].args[0], checkoutScript);
  assert.equal(config.mcpServers['shiori-brain'].env[ARCHIVE_ENV], DOCTOR_ARCHIVE_URL);
  assert.deepEqual(config.mcpServers.figcraft.args, ['mcp']);
  assert.equal(config.mcpServers.cadcraft, undefined);
  assert.equal(existsSync(join(home, '.cursor/rules')), false);
  const setup = await readFile(join(repositoryRoot, 'AGENT-SETUP.md'), 'utf8');
  assert.match(setup, /figcraft-cli mcp/);
  assert.match(setup, /Consult shiori-brain on demand/);
  assert.doesNotMatch(setup, /npx -y shiori-brain-mcp/);
});

forEachDoctorKind('generated doctor --install devin writes MCP config using the shared helper', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const env = baseDoctorEnv(home, { binDir, gitEnv: gitVars });
  const result = runDoctor(repositoryRoot, { install: ['devin'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const config = JSON.parse(await readFile(join(home, '.config/devin/mcp_config.json'), 'utf8'));
  const checkoutScript = join(home, '.local/share/shiori/shiori-brain/packages/shiori-brain-mcp/src/index.js');
  assert.equal(config.mcpServers['shiori-brain'].command, 'node');
  assert.equal(config.mcpServers['shiori-brain'].args[0], checkoutScript);
  assert.equal(config.mcpServers['shiori-brain'].env[ARCHIVE_ENV], DOCTOR_ARCHIVE_URL);
  const recorded = await readFile(join(home, '.local/state/shiori/installed-hosts'), 'utf8');
  assert.match(recorded, /^devin$/m);
});
