import assert from 'node:assert/strict';
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { installSupportFiles } from '../src/install-support.js';
import {
  ARCHIVE_URL as DOCTOR_ARCHIVE_URL,
  baseDoctorEnv,
  forEachDoctorKind,
  isWindows,
  makeUpstreamRepo,
  runDoctor,
  samePath,
  writeDoctorTree,
  writeFakeGit
} from './doctor-fixtures.js';
import {
  ARCHIVE_ENV,
  CRAFT_APPS,
  CRAFT_CONTROL_PORT,
  MCP_DONE_LINE,
  applyInstructionFile,
  applyJsonMcpConfig,
  classifyEntry,
  cliGetIsNotFound,
  detectCraftClis,
  githubPagesUrl,
  isMcpCliEntry,
  mcpServerCatalog,
  normalizeArchiveUrl,
  parseCliMcpEntry,
  renderMcpDataYaml,
  renderMcpMarkdownTable,
  resolveCommand,
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

function craftCliBody(commandName) {
  return isWindows
    ? `@echo off\r\nif "%~1"=="--version" (echo ${commandName} 0.0.0 & exit /b 0)\r\necho ok\r\nexit /b 0\r\n`
    : `#!/bin/sh\n[ "$1" = --version ] && echo ${commandName} 0.0.0 && exit 0\necho ok\nexit 0\n`;
}

async function writeCraftCli(binDir) {
  await writeExecutable(join(binDir, isWindows ? 'figcraft-cli.cmd' : 'figcraft-cli'), craftCliBody('figcraft-cli'));
}

async function writeNamedCraftCli(dir, commandName, fileName = commandName) {
  const path = join(dir, fileName);
  await writeExecutable(path, craftCliBody(commandName));
  return path;
}

function craftSearchEnv(extra = {}) {
  return withArchive({
    ...process.env,
    PATH: '/missing-bin',
    SHIORI_CRAFT_WSL: '0',
    ...extra
  });
}

function fakeCraftPath(binDir) {
  return withArchive({
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH}`
  });
}

function pathCraftArgs() {
  return isWindows ? ['mcp', '--attach', CRAFT_CONTROL_PORT] : ['mcp'];
}

function assertSamePath(actual, expected) {
  assert.equal(samePath(actual, expected), true, `path mismatch:\n  actual:   ${actual}\n  expected: ${expected}`);
}

function assertCraftEntry(entry, command, args) {
  assert.ok(entry, 'missing craft MCP entry');
  assertSamePath(entry.command, command);
  assert.deepEqual(entry.args, args);
}

function assertOutputHasCli(output, fileName) {
  assert.match(String(output || ''), new RegExp(String(fileName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
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
    'pdfcraft-cli', 'photocraft-cli', 'wordcraft-cli', 'effectcraft-cli', 'anicraft-cli', 'soundcraft-cli',
    'designcraft-cli', 'solidcraft-cli', 'vectorcraft-cli'
  ]);
  const catalog = mcpServerCatalog();
  assert.equal(catalog[0].name, 'shiori-brain');
  assert.equal(catalog[0].command, 'node');
  assert.equal(catalog[0].args[0], '~/.local/share/shiori/shiori-brain/packages/shiori-brain-mcp/src/index.js');
  assert.equal(catalog[0].whenInstalled, false);
  assert.equal(new Set(catalog.map(item => item.name)).size, catalog.length);
  assert.match(renderMcpMarkdownTable(), /figcraft-cli mcp/);
  assert.match(renderMcpMarkdownTable(), /--attach 7979/);
  assert.match(renderMcpMarkdownTable(), /Program Files/);
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
  assert.equal(classifyEntry({ command: 'figcraft-cli', args: ['mcp', '--attach', '7979'] }, figcraft), 'stale');
  const figcraftAttach = { ...figcraft, args: ['mcp', '--attach', CRAFT_CONTROL_PORT] };
  assert.equal(classifyEntry({ command: 'figcraft-cli', args: ['mcp', '--attach', '7979'] }, figcraftAttach), 'match');
  assert.equal(classifyEntry({ command: 'figcraft-cli', args: ['mcp'] }, figcraftAttach), 'stale');
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

test('Program Files Craft CLIs are found off PATH, and PATH-only lookup still skips them', async () => {
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const figcraftPath = await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  const cadcraftPath = await writeNamedCraftCli(join(programFiles, 'CadCraft'), 'cadcraft-cli', 'cadcraft-cli.exe');
  const env = craftSearchEnv({ SHIORI_CRAFT_PROGRAM_FILES: programFiles });
  assert.equal(resolveCommand('figcraft-cli', env, { pathOnly: true }), null);
  assert.equal(resolveCommand('cadcraft-cli', env, { pathOnly: true }), null);
  const pathOnly = selectServersForInstall(mcpServerCatalog(), craftSearchEnv());
  assert.ok(pathOnly.skipped.some(item => item.name === 'figcraft'));
  assert.ok(pathOnly.skipped.some(item => item.name === 'cadcraft'));
  assert.ok(!pathOnly.selected.some(item => item.name === 'figcraft'));

  const { selected, skipped } = selectServersForInstall(mcpServerCatalog(), env);
  assertCraftEntry(selected.find(item => item.name === 'figcraft'), figcraftPath, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
  assertCraftEntry(selected.find(item => item.name === 'cadcraft'), cadcraftPath, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
  assert.ok(skipped.some(item => item.name === 'deckcraft'));
});

test('LocalAppData and Program Files (x86) Craft CLIs are found through env overrides', async () => {
  const x86 = await mkdtemp(join(tmpdir(), 'shiori-pfx86-'));
  const localAppData = await mkdtemp(join(tmpdir(), 'shiori-localapp-'));
  const photocraftPath = await writeNamedCraftCli(join(x86, 'PhotoCraft'), 'photocraft-cli', 'photocraft-cli.exe');
  const wordcraftPath = await writeNamedCraftCli(join(localAppData, 'Programs', 'WordCraft'), 'wordcraft-cli', 'wordcraft-cli.cmd');
  const env = craftSearchEnv({
    SHIORI_CRAFT_PROGRAM_FILES_X86: x86,
    SHIORI_CRAFT_LOCALAPPDATA: localAppData
  });
  const { selected } = selectServersForInstall(mcpServerCatalog(), env);
  assertSamePath(selected.find(item => item.name === 'photocraft').command, photocraftPath);
  assertSamePath(selected.find(item => item.name === 'wordcraft').command, wordcraftPath);
});

test('WSL /mnt/c fixture finds the Windows Craft install and prefers it over PATH', {
  skip: isWindows ? 'WSL PATH lookup of extensionless binaries is Linux-side' : false
}, async () => {
  const mntc = await mkdtemp(join(tmpdir(), 'shiori-mntc-'));
  const linuxBin = await mkdtemp(join(tmpdir(), 'shiori-linux-bin-'));
  await writeNamedCraftCli(linuxBin, 'figcraft-cli');
  const figcraftPath = await writeNamedCraftCli(join(mntc, 'Program Files', 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  const cadcraftPath = await writeNamedCraftCli(
    join(mntc, 'Users', 'tester', 'AppData', 'Local', 'Programs', 'CadCraft'),
    'cadcraft-cli',
    'cadcraft-cli.exe'
  );
  const env = craftSearchEnv({
    PATH: `${linuxBin}${delimiter}/missing-bin`,
    SHIORI_CRAFT_WSL: '1',
    SHIORI_CRAFT_WSL_WINDOWS_ROOT: mntc,
    USER: 'tester'
  });
  assert.equal(resolveCommand('figcraft-cli', env, { pathOnly: true }), join(linuxBin, 'figcraft-cli'));
  assert.equal(resolveCommand('figcraft-cli', env), figcraftPath);
  const { selected } = selectServersForInstall(mcpServerCatalog(), env);
  const figcraft = selected.find(item => item.name === 'figcraft');
  const cadcraft = selected.find(item => item.name === 'cadcraft');
  assert.equal(figcraft.command, figcraftPath);
  assert.deepEqual(figcraft.args, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
  assert.equal(cadcraft.command, cadcraftPath);
  assert.deepEqual(cadcraft.args, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
});

test('Windows-style --install writes attach config for Program Files Craft CLIs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const figcraftPath = await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await writeNamedCraftCli(join(programFiles, 'CadCraft'), 'cadcraft-cli', 'cadcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const { reports, lines } = runMcpCli(['install', '--home', home, '--host', 'cursor'], {
    env: craftSearchEnv({ SHIORI_CRAFT_PROGRAM_FILES: programFiles })
  });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assertCraftEntry(config.mcpServers.figcraft, figcraftPath, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
  assert.deepEqual(config.mcpServers.cadcraft.args, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'added'));
  assert.ok(reports.some(item => item.name === 'cadcraft' && item.status === 'added'));
  assert.ok(lines.some(line => /MCP cursor figcraft added/.test(line)));
});

test('WSL-style --install writes attach config using the Windows .exe', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const mntc = await mkdtemp(join(tmpdir(), 'shiori-mntc-'));
  const figcraftPath = await writeNamedCraftCli(join(mntc, 'Program Files', 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const { reports } = runMcpCli(['install', '--home', home, '--host', 'cursor'], {
    env: craftSearchEnv({
      SHIORI_CRAFT_WSL: '1',
      SHIORI_CRAFT_WSL_WINDOWS_ROOT: mntc
    })
  });
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assertCraftEntry(config.mcpServers.figcraft, figcraftPath, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'added'));
});

test('bare doctor stays read-only when a Program Files Craft CLI is present', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  await mkdir(join(home, '.cursor'), { recursive: true });
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  const { reports } = runMcpCli(['verify', '--home', home, '--host', 'cursor'], {
    env: craftSearchEnv({ SHIORI_CRAFT_PROGRAM_FILES: programFiles })
  });
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
  assert.ok(reports.some(item => item.name === 'figcraft' && item.status === 'missing'));
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
  assert.deepEqual(config.mcpServers.figcraft, { command: 'figcraft-cli', args: pathCraftArgs() });
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
  assert.deepEqual(config.mcpServers.figcraft.args, pathCraftArgs());
  assert.equal(config.mcpServers.cadcraft, undefined);
  assert.equal(existsSync(join(home, '.cursor/rules')), false);
  const setup = await readFile(join(repositoryRoot, 'AGENT-SETUP.md'), 'utf8');
  assert.match(setup, /figcraft-cli mcp/);
  assert.match(setup, /--attach 7979/);
  assert.match(setup, /Program Files/);
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

forEachDoctorKind('generated doctor --install cursor writes attach MCP for a Program Files Craft CLI', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const figcraftPath = await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await writeNamedCraftCli(join(programFiles, 'CadCraft'), 'cadcraft-cli', 'cadcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      SHIORI_CRAFT_WSL: '0',
      SHIORI_CRAFT_PROGRAM_FILES: programFiles
    }
  });
  const before = existsSync(join(home, '.cursor/mcp.json'));
  const bare = runDoctor(repositoryRoot, {}, { home, env, kind });
  assert.equal(bare.status, 0, bare.stderr + bare.stdout);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), before);

  const result = runDoctor(repositoryRoot, { install: ['cursor'], verbose: true }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assertCraftEntry(config.mcpServers.figcraft, figcraftPath, ['mcp', '--attach', '7979']);
  assert.deepEqual(config.mcpServers.cadcraft.args, ['mcp', '--attach', '7979']);
  assert.match(result.stdout, /MCP cursor figcraft added/);
  assert.match(result.stdout, /MCP cursor cadcraft added/);
});

forEachDoctorKind('generated doctor --install cursor writes attach MCP for a WSL /mnt/c Craft CLI', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const mntc = await mkdtemp(join(tmpdir(), 'shiori-mntc-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const figcraftPath = await writeNamedCraftCli(join(mntc, 'Program Files', 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      SHIORI_CRAFT_WSL: '1',
      SHIORI_CRAFT_WSL_WINDOWS_ROOT: mntc
    }
  });
  const result = runDoctor(repositoryRoot, { install: ['cursor'], verbose: true }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assertCraftEntry(config.mcpServers.figcraft, figcraftPath, ['mcp', '--attach', '7979']);
  assert.match(result.stdout, /MCP cursor figcraft added/);
});

test('nested ArtCraft/DesignCraft install dirs are found within the per-root limit', async () => {
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const designcraftPath = await writeNamedCraftCli(
    join(programFiles, 'ArtCraft', 'DesignCraft'),
    'designcraft-cli',
    'designcraft-cli.exe'
  );
  const env = craftSearchEnv({ SHIORI_CRAFT_PROGRAM_FILES: programFiles });
  assertSamePath(resolveCommand('designcraft-cli', env), designcraftPath);
  const { found, missing } = detectCraftClis(env);
  assertSamePath(found.find(item => item.name === 'designcraft')?.command, designcraftPath);
  assert.deepEqual(found.find(item => item.name === 'designcraft')?.args, ['mcp', '--attach', CRAFT_CONTROL_PORT]);
  assert.ok(missing.some(item => item.name === 'figcraft'));
});

test('runMcpCli detect does not require an archive URL', () => {
  const env = { ...process.env, PATH: '/missing-bin', SHIORI_CRAFT_WSL: '0' };
  delete env.SHIORI_BRAIN_BASE_URL;
  const { lines } = runMcpCli(['detect'], { env });
  assert.ok(lines.some(line => line === MCP_DONE_LINE));
  assert.ok(lines.some(line => /MCP detect not found:/.test(line)));
});

test('resolveCommand returns the realpath of a found Craft CLI', async () => {
  const realRoot = await mkdtemp(join(tmpdir(), 'shiori-pf-real-'));
  const figcraftPath = await writeNamedCraftCli(join(realRoot, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  const linkRoot = await mkdtemp(join(tmpdir(), 'shiori-pf-link-'));
  await symlink(join(realRoot, 'FigCraft'), join(linkRoot, 'FigCraft'));
  const env = craftSearchEnv({ SHIORI_CRAFT_PROGRAM_FILES: linkRoot });
  assert.equal(resolveCommand('figcraft-cli', env), realpathSync(figcraftPath));
});

test('detect lists Program Files Craft CLIs without writing', async () => {
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const figcraftPath = await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  const pdfcraftPath = await writeNamedCraftCli(join(programFiles, 'PdfCraft'), 'pdfcraft-cli', 'pdfcraft-cli.exe');
  await writeNamedCraftCli(join(programFiles, 'ArtCraft', 'DesignCraft'), 'designcraft-cli', 'designcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const { lines, reports } = runMcpCli(['detect'], {
    env: craftSearchEnv({ SHIORI_CRAFT_PROGRAM_FILES: programFiles })
  });
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
  assertSamePath(reports.find(item => item.name === 'figcraft')?.command, figcraftPath);
  assertSamePath(reports.find(item => item.name === 'pdfcraft')?.command, pdfcraftPath);
  assert.ok(reports.some(item => item.name === 'designcraft' && item.status === 'found'));
  assert.ok(lines.some(line => line === MCP_DONE_LINE));
  assert.ok(lines.some(line => /MCP detect not found: .*solidcraft/.test(line)));
  assert.ok(lines.some(line => /MCP detect figcraft found \(/.test(line)));
});

test('isMcpCliEntry follows realpath through a symlink and ignores undefined argv[1]', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shiori-entry-'));
  const helper = join(dir, 'shiori-mcp.mjs');
  await writeFile(helper, 'export {}\n');
  const link = join(dir, 'via-link.mjs');
  await symlink(helper, link);
  assert.equal(isMcpCliEntry({ moduleUrl: pathToFileURL(helper).href, argv1: link, main: undefined }), true);
  assert.equal(isMcpCliEntry({ moduleUrl: pathToFileURL(helper).href, argv1: undefined, main: undefined }), false);
  assert.equal(isMcpCliEntry({ moduleUrl: pathToFileURL(helper).href, argv1: '-', main: true }), false);
  assert.equal(isMcpCliEntry({
    moduleUrl: pathToFileURL(join(dir, 'dist/index.js')).href,
    argv1: join(dir, 'dist/index.js'),
    main: true
  }), false);
});

test('MCP helper CLI does not run under node -e import', () => {
  const helper = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-config.js');
  const result = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(helper).href)})`], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(String(result.stdout || '').trim(), '');
});

test('MCP helper CLI via symlink prints MCP done', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shiori-helper-link-'));
  const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-config.js');
  const helper = join(dir, 'shiori-mcp.mjs');
  await writeFile(helper, await readFile(source, 'utf8'));
  const link = join(dir, 'via-link.mjs');
  await symlink(helper, link);
  const result = spawnSync(process.execPath, [link, 'detect'], {
    encoding: 'utf8',
    env: craftSearchEnv()
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MCP done/);
  assert.match(result.stdout, /MCP detect not found:/);
});

forEachDoctorKind('bare doctor reports nested Program Files Craft CLIs without writing', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await writeNamedCraftCli(join(programFiles, 'PdfCraft'), 'pdfcraft-cli', 'pdfcraft-cli.exe');
  await writeNamedCraftCli(
    join(programFiles, 'ArtCraft', 'DesignCraft'),
    'designcraft-cli',
    'designcraft-cli.exe'
  );
  await mkdir(join(home, '.cursor'), { recursive: true });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      SHIORI_CRAFT_WSL: '0',
      SHIORI_CRAFT_PROGRAM_FILES: programFiles
    }
  });
  const bare = runDoctor(repositoryRoot, {}, { home, env, kind });
  assert.equal(bare.status, 0, bare.stderr + bare.stdout);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
  assert.match(bare.stdout, /craft: figcraft found/);
  assert.match(bare.stdout, /craft: pdfcraft found/);
  assert.match(bare.stdout, /craft: designcraft found/);
  assert.match(bare.stdout, /craft: not found: .*solidcraft/);
  assert.match(bare.stdout, /vectorcraft/);
  assertOutputHasCli(bare.stdout, 'figcraft-cli.exe');
  assertOutputHasCli(bare.stdout, 'designcraft-cli.exe');
});

forEachDoctorKind('quiet --install cursor reports Craft MCP added then unchanged, and a new Craft as updated', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const figcraftPath = await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await writeNamedCraftCli(join(programFiles, 'PdfCraft'), 'pdfcraft-cli', 'pdfcraft-cli.exe');
  await writeNamedCraftCli(join(programFiles, 'ArtCraft', 'DesignCraft'), 'designcraft-cli', 'designcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      SHIORI_CRAFT_WSL: '0',
      SHIORI_CRAFT_PROGRAM_FILES: programFiles
    }
  });
  const installed = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind });
  assert.equal(installed.status, 0, installed.stderr + installed.stdout);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assertCraftEntry(config.mcpServers.figcraft, figcraftPath, ['mcp', '--attach', '7979']);
  assert.deepEqual(config.mcpServers.pdfcraft.args, ['mcp', '--attach', '7979']);
  assert.deepEqual(config.mcpServers.designcraft.args, ['mcp', '--attach', '7979']);
  assert.match(installed.stdout, /cursor: MCP figcraft added/);
  assert.match(installed.stdout, /cursor: MCP pdfcraft added/);
  assert.match(installed.stdout, /cursor: MCP designcraft added/);
  assert.match(installed.stdout, /cursor: MCP shiori-brain added/);
  assert.match(installed.stdout, /^updated$/m);
  assert.doesNotMatch(installed.stdout, /already current/);

  const again = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind });
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.match(again.stdout, /cursor: MCP figcraft unchanged/);
  assert.match(again.stdout, /cursor: MCP shiori-brain unchanged/);
  assert.match(again.stdout, /^already current$/m);

  const wordcraftPath = await writeNamedCraftCli(join(programFiles, 'WordCraft'), 'wordcraft-cli', 'wordcraft-cli.exe');
  const afterNew = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind });
  assert.equal(afterNew.status, 0, afterNew.stderr + afterNew.stdout);
  const updated = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assertCraftEntry(updated.mcpServers.wordcraft, wordcraftPath, ['mcp', '--attach', '7979']);
  assert.match(afterNew.stdout, /cursor: MCP wordcraft added/);
  assert.match(afterNew.stdout, /cursor: MCP figcraft unchanged/);
  assert.match(afterNew.stdout, /^updated$/m);
});

forEachDoctorKind('bare doctor reports Craft CLIs without SHIORI_BRAIN_BASE_URL', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      SHIORI_CRAFT_WSL: '0',
      SHIORI_CRAFT_PROGRAM_FILES: programFiles
    }
  });
  delete env.SHIORI_BRAIN_BASE_URL;
  const bare = runDoctor(repositoryRoot, {}, { home, env, kind });
  assert.equal(bare.status, 0, bare.stderr + bare.stdout);
  assert.match(bare.stdout, /craft: figcraft found/);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
});

forEachDoctorKind('bare doctor ignores an invalid SHIORI_BRAIN_BASE_URL', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: { SHIORI_BRAIN_BASE_URL: 'http://brain.internal/' }
  });
  const bare = runDoctor(repositoryRoot, {}, { home, env, kind });
  assert.equal(bare.status, 0, bare.stderr + bare.stdout);
  assert.match(bare.stdout, /detected:/);
  assert.doesNotMatch(`${bare.stdout}\n${bare.stderr}`, /must be an https URL/);
});

forEachDoctorKind('bare doctor continues when the MCP helper omits MCP done', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const stub = join(repositoryRoot, 'stub-mcp.mjs');
  await writeFile(stub, 'console.log("MCP detect figcraft found (figcraft-cli mcp)");\n');
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: { SHIORI_MCP_HELPER: stub }
  });
  const bare = runDoctor(repositoryRoot, {}, { home, env, kind });
  assert.equal(bare.status, 0, bare.stderr + bare.stdout);
  assert.match(bare.stdout, /Skipping Craft CLI detect: helper produced no status line/);
  assert.match(bare.stdout, /detected:/);
});

forEachDoctorKind('install fails when the MCP helper omits MCP done', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  await mkdir(join(home, '.cursor'), { recursive: true });
  const stub = join(repositoryRoot, 'stub-mcp.mjs');
  await writeFile(stub, 'console.log("MCP cursor shiori-brain added");\n');
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: { SHIORI_MCP_HELPER: stub }
  });
  const result = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /produced no status line/);
});

forEachDoctorKind('quiet install prints MCP error reports', async (_t, kind) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  await mkdir(join(home, '.cursor'), { recursive: true });
  const stub = join(repositoryRoot, 'stub-mcp.mjs');
  await writeFile(stub, 'console.log("MCP cursor shiori-brain error (get failed)");\nconsole.log("MCP done");\n');
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: { SHIORI_MCP_HELPER: stub }
  });
  const result = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /cursor: MCP shiori-brain error \(get failed\)/);
});

