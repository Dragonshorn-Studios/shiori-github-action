#!/usr/bin/env node
import { accessSync, chmodSync, constants, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CHECKOUT_DISPLAY = '~/.local/share/shiori/shiori-brain';
export const SHIORI_BRAIN_MCP_SCRIPT = 'packages/shiori-brain-mcp/src/index.js';
export const ARCHIVE_ENV = 'SHIORI_BRAIN_BASE_URL';
export const CRAFT_CONTROL_PORT = '7979';
export const MCP_DONE_LINE = 'MCP done';
export const SHIORI_RULE_TEXT = 'Consult shiori-brain on demand (`search` / `read_doc`) before architecture or security decisions; do not dump that knowledge into context. Skills are procedures only.';
const BLOCK_START = '<!-- shiori:start -->';
const BLOCK_END = '<!-- shiori:end -->';
const CRAFT_DIR_RE = /craft/i;
const MAX_CRAFT_DIRS_PER_ROOT = 32;

export const CRAFT_APPS = [
  { name: 'figcraft', command: 'figcraft-cli', summary: 'Interface design (FigCraft)' },
  { name: 'cadcraft', command: 'cadcraft-cli', summary: 'CAD and drafting (CadCraft)' },
  { name: 'deckcraft', command: 'deckcraft-cli', summary: 'Slide decks (DeckCraft)' },
  { name: 'gridcraft', command: 'gridcraft-cli', summary: 'Spreadsheets and tables (GridCraft)' },
  { name: 'lightcraft', command: 'lightcraft-cli', summary: 'Photo library and RAW development (LightCraft)' },
  { name: 'pdfcraft', command: 'pdfcraft-cli', summary: 'PDF documents (PdfCraft)' },
  { name: 'photocraft', command: 'photocraft-cli', summary: 'Image editor (PhotoCraft)' },
  { name: 'wordcraft', command: 'wordcraft-cli', summary: 'Word processing (WordCraft)' },
  { name: 'effectcraft', command: 'effectcraft-cli', summary: 'Motion graphics and VFX (EffectCraft)' },
  { name: 'anicraft', command: 'anicraft-cli', summary: '2D vector animation (AniCraft)' },
  { name: 'soundcraft', command: 'soundcraft-cli', summary: 'Digital audio workstation (SoundCraft)' },
  { name: 'designcraft', command: 'designcraft-cli', summary: 'Product and UI design (DesignCraft)' },
  { name: 'solidcraft', command: 'solidcraft-cli', summary: '3D solid modeling (SolidCraft)' },
  { name: 'vectorcraft', command: 'vectorcraft-cli', summary: 'Vector illustration (VectorCraft)' }
];

export const MCP_HOSTS = {
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    kind: 'json',
    detectPath: '.cursor',
    configPath: '.cursor/mcp.json',
    instructionPath: null
  },
  devin: {
    id: 'devin',
    label: 'Devin',
    kind: 'json',
    detectPath: '.config/devin',
    configPath: '.config/devin/mcp_config.json',
    instructionPath: null
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    kind: 'json',
    jsonShape: 'opencode',
    detectPath: '.config/opencode',
    configPath: '.config/opencode/opencode.jsonc',
    configCandidates: ['.config/opencode/opencode.json', '.config/opencode/opencode.jsonc'],
    instructionPath: null
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    kind: 'claude-cli',
    detectPath: '.claude',
    configPath: '.claude.json',
    instructionPath: '.claude/CLAUDE.md'
  },
  'claude-code': {
    id: 'claude',
    label: 'Claude Code',
    kind: 'claude-cli',
    detectPath: '.claude',
    configPath: '.claude.json',
    instructionPath: '.claude/CLAUDE.md'
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    kind: 'codex-cli',
    detectPath: '.codex',
    configPath: '.codex/config.toml',
    instructionPath: '.codex/AGENTS.md'
  }
};

export function defaultCheckout(home) {
  return join(home, '.local/share/shiori/shiori-brain');
}

export function resolveCheckout(checkout, home) {
  const raw = checkout || defaultCheckout(home);
  if (raw.startsWith('~/')) return resolve(home, raw.slice(2));
  return resolve(raw);
}

export function shioriBrainScript(checkout) {
  return join(checkout, ...SHIORI_BRAIN_MCP_SCRIPT.split('/'));
}

export function githubPagesUrl(repository) {
  const [owner, repo] = String(repository || '').split('/').filter(Boolean);
  if (!owner || !repo) return '';
  const host = owner.toLowerCase();
  if (repo.toLowerCase() === `${host}.github.io`) return `https://${host}.github.io/`;
  return `https://${host}.github.io/${repo}/`;
}

function isLocalArchiveHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function normalizeArchiveUrl(value) {
  const url = new URL(value);
  if (url.protocol === 'https:') {
    // allowed
  } else if (url.protocol === 'http:' && isLocalArchiveHost(url.hostname)) {
    // local debugging only
  } else {
    throw new Error(`${ARCHIVE_ENV} must be an https URL (http is allowed only for localhost).`);
  }
  url.hash = '';
  url.search = '';
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

export function shioriBrainServer(checkout, { display = false, archiveUrl } = {}) {
  const script = display ? `${DEFAULT_CHECKOUT_DISPLAY}/${SHIORI_BRAIN_MCP_SCRIPT}` : shioriBrainScript(checkout);
  const server = {
    name: 'shiori-brain',
    command: 'node',
    args: [script],
    invocation: `node ${script}`,
    summary: 'Search and read the published Shiori knowledge archive',
    whenInstalled: false
  };
  if (archiveUrl) server.env = { [ARCHIVE_ENV]: archiveUrl };
  return server;
}

export function mcpServerCatalog(options = {}) {
  const brain = options.checkout
    ? shioriBrainServer(options.checkout, { archiveUrl: options.archiveUrl })
    : shioriBrainServer(DEFAULT_CHECKOUT_DISPLAY, { display: true, archiveUrl: options.archiveUrl });
  return [
    brain,
    ...CRAFT_APPS.map(app => ({
      name: app.name,
      command: app.command,
      args: ['mcp'],
      invocation: `${app.command} mcp`,
      summary: app.summary,
      whenInstalled: true
    }))
  ];
}

export function renderMcpMarkdownTable() {
  const rows = [
    '| Server | Command | Purpose | When the doctor adds it |',
    '| --- | --- | --- | --- |'
  ];
  for (const server of mcpServerCatalog()) {
    const when = server.whenInstalled
      ? `When \`${server.command}\` is on \`PATH\` or in a bounded Program Files / LocalAppData \`*Craft*\` install (WSL: \`/mnt/c\` Program Files; LocalAppData only if \`SHIORI_CRAFT_LOCALAPPDATA\` is set). Windows and WSL use \`${server.command} mcp --attach ${CRAFT_CONTROL_PORT}\``
      : 'On `--install` / `--update` for Cursor, Devin, OpenCode, Claude Code, and Codex';
    rows.push(`| \`${server.name}\` | \`${server.invocation}\` | ${server.summary} | ${when} |`);
  }
  return `${rows.join('\n')}\n`;
}

export function renderMcpDataYaml() {
  return mcpServerCatalog().map(server => [
    `- name: ${JSON.stringify(server.name)}`,
    `  command: ${JSON.stringify(server.invocation)}`,
    `  summary: ${JSON.stringify(server.summary)}`,
    `  when_installed: ${server.whenInstalled}`
  ].join('\n')).join('\n') + '\n';
}

function envFlag(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return null;
}

export function isWslEnv(env = process.env) {
  const flag = envFlag(env.SHIORI_CRAFT_WSL);
  if (flag != null) return flag;
  if (process.platform !== 'linux') return false;
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

function usableRoot(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(raw)) return '';
  return raw;
}

function uniqueRoots(values) {
  const seen = new Set();
  const roots = [];
  for (const value of values) {
    const root = usableRoot(value);
    if (!root) continue;
    const key = posixPath(root).replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
  }
  return roots;
}

export function craftInstallRoots(env = process.env) {
  const programFiles = env.SHIORI_CRAFT_PROGRAM_FILES || env.ProgramFiles;
  const programFilesX86 = env.SHIORI_CRAFT_PROGRAM_FILES_X86 || env['ProgramFiles(x86)'];
  const wsl = isWslEnv(env);
  const localAppData = wsl ? env.SHIORI_CRAFT_LOCALAPPDATA : (env.SHIORI_CRAFT_LOCALAPPDATA || env.LOCALAPPDATA);
  const roots = [];
  if (programFiles) roots.push(programFiles);
  if (programFilesX86) roots.push(programFilesX86);
  if (localAppData) roots.push(join(localAppData, 'Programs'));

  const wslRoot = usableRoot(env.SHIORI_CRAFT_WSL_WINDOWS_ROOT) || (wsl ? '/mnt/c' : '');
  if (wslRoot) {
    roots.push(join(wslRoot, 'Program Files'));
    roots.push(join(wslRoot, 'Program Files (x86)'));
  }
  return uniqueRoots(roots);
}

function windowsExtensions(env) {
  const exts = String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map(item => item.trim()).filter(Boolean);
  return exts.length ? exts : ['.EXE', '.CMD', '.BAT', '.COM'];
}

function pathExtensions(env) {
  return process.platform === 'win32' ? windowsExtensions(env) : [''];
}

function installExtensions(env) {
  const seen = new Set(['']);
  const extensions = [''];
  for (const ext of windowsExtensions(env)) {
    for (const variant of [ext, ext.toLowerCase(), ext.toUpperCase()]) {
      if (seen.has(variant)) continue;
      seen.add(variant);
      extensions.push(variant);
    }
  }
  return extensions;
}

function executableIfPresent(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    try {
      accessSync(candidate, constants.F_OK);
    } catch {
      return null;
    }
    return /\.(exe|cmd|bat|com)$/i.test(candidate) ? candidate : null;
  }
}

function resolveOnPath(name, env) {
  const paths = String(env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of paths) {
    for (const extension of pathExtensions(env)) {
      const found = executableIfPresent(join(dir, `${name}${extension}`));
      if (found) return found;
    }
  }
  return null;
}

function listCraftDirEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function listCraftInstallDirs(root) {
  const dirs = [];
  for (const entry of listCraftDirEntries(root)) {
    if (dirs.length >= MAX_CRAFT_DIRS_PER_ROOT) break;
    if (!CRAFT_DIR_RE.test(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const installDir = join(root, entry.name);
    dirs.push(installDir);
    for (const nested of listCraftDirEntries(installDir)) {
      if (dirs.length >= MAX_CRAFT_DIRS_PER_ROOT) break;
      if (!CRAFT_DIR_RE.test(nested.name)) continue;
      if (!nested.isDirectory() && !nested.isSymbolicLink()) continue;
      dirs.push(join(installDir, nested.name));
    }
  }
  return dirs;
}

function resolveInInstallDir(installDir, name, env) {
  for (const sub of ['', 'bin']) {
    const dir = sub ? join(installDir, sub) : installDir;
    for (const extension of installExtensions(env)) {
      const found = executableIfPresent(join(dir, `${name}${extension}`));
      if (found) return found;
    }
  }
  return null;
}

function resolveCraftInstall(name, env) {
  for (const root of craftInstallRoots(env)) {
    for (const installDir of listCraftInstallDirs(root)) {
      const found = resolveInInstallDir(installDir, name, env);
      if (found) return found;
    }
  }
  return null;
}

export function isWindowsCraftCli(path) {
  const value = String(path || '');
  if (/\.(exe|cmd|bat|com)$/i.test(value)) return true;
  const posix = posixPath(value);
  if (/\/mnt\/[a-z]\//i.test(posix)) return true;
  if (/\/Program Files(?: \(x86\))?\//i.test(posix)) return true;
  if (/\/AppData\/Local\/Programs\//i.test(posix)) return true;
  return false;
}

export function resolveCommand(name, env = process.env, options = {}) {
  if (!name) return null;
  if (isAbsolute(name)) return executableIfPresent(name);
  const fromPath = resolveOnPath(name, env);
  if (options.pathOnly) return fromPath;
  const fromInstall = resolveCraftInstall(name, env);
  if (isWslEnv(env) && fromInstall && isWindowsCraftCli(fromInstall)) return fromInstall;
  return fromPath || fromInstall;
}

function shouldAttachCraft(resolved) {
  return process.platform === 'win32' || isWindowsCraftCli(resolved);
}

function craftMissingMessage(command) {
  return `${command} is not on PATH or in a known Craft install location`;
}

function selectedCraftServer(server, resolved, env) {
  const fromPath = resolveCommand(server.command, env, { pathOnly: true });
  const attach = shouldAttachCraft(resolved);
  const command = !fromPath || resolved !== fromPath ? resolved : server.command;
  const args = attach ? ['mcp', '--attach', CRAFT_CONTROL_PORT] : [...server.args];
  return {
    ...server,
    command,
    args,
    invocation: `${commandBasename(command)} ${args.join(' ')}`
  };
}

function serverInvocation(server) {
  return `${server.command} ${argsList(server.args).join(' ')}`.trim();
}

function craftReportMessage(server) {
  if (!server?.whenInstalled) return undefined;
  return serverInvocation(server);
}

export function detectCraftClis(env = process.env) {
  const found = [];
  const missing = [];
  for (const server of mcpServerCatalog().filter(item => item.whenInstalled)) {
    const resolved = resolveCommand(server.command, env);
    if (resolved) found.push(selectedCraftServer(server, resolved, env));
    else missing.push(server);
  }
  return { found, missing };
}

export function commandBasename(command) {
  return basename(String(command || '')).replace(/\.(exe|cmd|bat|com)$/i, '');
}

function argsList(value) {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function posixPath(value) {
  return String(value || '').replaceAll('\\', '/');
}

function isHttpEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const type = String(entry.type || '').toLowerCase().replaceAll('_', '-');
  return Boolean(entry.url || entry.serverUrl || ['http', 'sse', 'streamable-http', 'ws'].includes(type));
}

export function isShioriBrainEntry(entry) {
  if (!entry || typeof entry !== 'object' || isHttpEntry(entry)) return false;
  if (commandBasename(entry.command) !== 'node') return false;
  const args = argsList(entry.args);
  if (args.length !== 1) return false;
  const arg = posixPath(args[0]);
  return arg === SHIORI_BRAIN_MCP_SCRIPT || arg.endsWith(`/${SHIORI_BRAIN_MCP_SCRIPT}`);
}

function isCraftAttachTarget(value) {
  const raw = String(value || '');
  if (raw === CRAFT_CONTROL_PORT) return true;
  return raw.endsWith(`:${CRAFT_CONTROL_PORT}`);
}

export function isCraftEntry(entry, commandName) {
  if (!entry || typeof entry !== 'object' || isHttpEntry(entry)) return false;
  if (commandBasename(entry.command) !== commandBasename(commandName)) return false;
  const args = argsList(entry.args);
  if (args[0] !== 'mcp') return false;
  if (args.length === 1) return true;
  return args.length === 3 && args[1] === '--attach' && isCraftAttachTarget(args[2]);
}

function archiveEnv(entry) {
  const value = entry?.env?.[ARCHIVE_ENV];
  if (!value) return '';
  try {
    return normalizeArchiveUrl(value);
  } catch {
    return String(value);
  }
}

function normalizeFsPath(value) {
  return posixPath(String(value || '')).replace(/^\\\\\?\\/, '').replace(/\/+$/, '');
}

function sameExecutable(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return true;
  if (commandBasename(a) !== commandBasename(b)) return false;
  if (!isAbsolute(a) || !isAbsolute(b)) return true;
  try {
    const leftKey = normalizeFsPath(realpathSync(a));
    const rightKey = normalizeFsPath(realpathSync(b));
    return process.platform === 'win32' ? leftKey.toLowerCase() === rightKey.toLowerCase() : leftKey === rightKey;
  } catch {
    return false;
  }
}

export function entriesEquivalent(existing, desired) {
  if (!existing || !desired) return false;
  if (!sameExecutable(existing.command, desired.command)) return false;
  const existingArgs = argsList(existing.args);
  const desiredArgs = argsList(desired.args);
  if (existingArgs.length !== desiredArgs.length) return false;
  const argsMatch = existingArgs.every((arg, index) => {
    const left = posixPath(arg);
    const right = posixPath(desiredArgs[index]);
    if (left === right) return true;
    try {
      return resolve(left) === resolve(right);
    } catch {
      return false;
    }
  });
  if (!argsMatch) return false;
  if (desired.env?.[ARCHIVE_ENV] && archiveEnv(existing) !== archiveEnv(desired)) return false;
  return true;
}

function desiredEntry(server) {
  const entry = { command: server.command, args: [...server.args] };
  if (server.env) entry.env = { ...server.env };
  return entry;
}

export function classifyEntry(existing, server) {
  if (existing == null) return 'missing';
  if (typeof existing !== 'object' || Array.isArray(existing)) return 'conflict';
  if (entriesEquivalent(existing, desiredEntry(server))) return 'match';
  const owned = server.name === 'shiori-brain'
    ? isShioriBrainEntry(existing)
    : isCraftEntry(existing, server.command);
  return owned ? 'stale' : 'conflict';
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function fileMode(path) {
  try {
    return statSync(path).mode;
  } catch {
    return undefined;
  }
}

export function writeJsonAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const mode = fileMode(path);
  const fileModeBits = mode == null ? undefined : mode & 0o777;
  const options = fileModeBits == null ? { encoding: 'utf8' } : { encoding: 'utf8', mode: fileModeBits };
  const current = readText(path);
  if (current != null) writeFileSync(`${path}.bak`, current, options);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, options);
  renameSync(temp, path);
  if (fileModeBits != null) chmodSync(path, fileModeBits);
}

function parseJsonConfig(text, shape = 'mcpServers') {
  if (shape === 'opencode') {
    if (text == null || !String(text).trim()) return { mcp: { servers: {} } };
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP config must be a JSON object.');
    if (parsed.mcp == null) parsed.mcp = {};
    if (typeof parsed.mcp !== 'object' || Array.isArray(parsed.mcp)) throw new Error('mcp must be an object.');
    if (parsed.mcp.servers == null) parsed.mcp.servers = {};
    if (typeof parsed.mcp.servers !== 'object' || Array.isArray(parsed.mcp.servers)) {
      throw new Error('mcp.servers must be an object.');
    }
    return parsed;
  }
  if (text == null || !String(text).trim()) return { mcpServers: {} };
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP config must be a JSON object.');
  if (parsed.mcpServers == null) parsed.mcpServers = {};
  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers)) {
    throw new Error('mcpServers must be an object.');
  }
  return parsed;
}

function jsonServerMap(config, shape) {
  return shape === 'opencode' ? config.mcp.servers : config.mcpServers;
}

function normalizeJsonEntry(entry, shape) {
  if (shape !== 'opencode' || !entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  if (entry.url || entry.serverUrl || String(entry.type || '').toLowerCase() === 'remote') {
    return { url: entry.url ?? entry.serverUrl, headers: entry.headers };
  }
  const command = Array.isArray(entry.command)
    ? entry.command.map(String)
    : [String(entry.command ?? '')];
  const normalized = { command: command[0] ?? '', args: command.slice(1) };
  const env = entry.environment ?? entry.env;
  if (env && typeof env === 'object') normalized.env = env;
  return normalized;
}

function hostJsonEntry(server, shape, existing) {
  const entry = existing && typeof existing === 'object' ? { ...existing } : {};
  if (shape === 'opencode') {
    entry.type = 'local';
    entry.command = [server.command, ...server.args];
    if (server.env) {
      const current = existing?.environment;
      entry.environment = { ...(current && typeof current === 'object' ? current : {}), ...server.env };
    }
    return entry;
  }
  entry.command = server.command;
  entry.args = [...server.args];
  if (server.env) {
    const current = existing?.env;
    entry.env = { ...(current && typeof current === 'object' ? current : {}), ...server.env };
  }
  return entry;
}

function stringifyJsonConfig(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function applyJsonMcpConfig(text, servers, shape = 'mcpServers') {
  const config = parseJsonConfig(text, shape);
  const bucket = jsonServerMap(config, shape);
  const reports = [];
  let changed = false;
  for (const server of servers) {
    const has = Object.prototype.hasOwnProperty.call(bucket, server.name);
    const existing = has ? bucket[server.name] : null;
    const classification = !has
      ? 'missing'
      : (existing == null || typeof existing !== 'object' || Array.isArray(existing))
        ? 'conflict'
        : classifyEntry(normalizeJsonEntry(existing, shape), server);
    if (classification === 'match') {
      reports.push({ name: server.name, status: 'unchanged', message: craftReportMessage(server) });
      continue;
    }
    if (classification === 'conflict') {
      reports.push({ name: server.name, status: 'conflict', message: 'existing non-Shiori entry left untouched' });
      continue;
    }
    if (classification === 'stale') {
      bucket[server.name] = hostJsonEntry(server, shape, existing);
      reports.push({ name: server.name, status: 'updated', message: craftReportMessage(server) });
      changed = true;
      continue;
    }
    bucket[server.name] = hostJsonEntry(server, shape);
    reports.push({ name: server.name, status: 'added', message: craftReportMessage(server) });
    changed = true;
  }
  return { text: stringifyJsonConfig(config), changed, reports, config };
}

function readJsonEntry(text, name, shape = 'mcpServers') {
  try {
    const config = parseJsonConfig(text, shape);
    const bucket = jsonServerMap(config, shape);
    if (!Object.prototype.hasOwnProperty.call(bucket, name)) return null;
    const existing = bucket[name];
    if (existing == null || typeof existing !== 'object' || Array.isArray(existing)) return { url: 'invalid-entry' };
    return normalizeJsonEntry(existing, shape);
  } catch {
    return undefined;
  }
}

export function selectServersForInstall(catalog, env = process.env) {
  const selected = [];
  const skipped = [];
  for (const server of catalog) {
    if (!server.whenInstalled) {
      selected.push(server);
      continue;
    }
    const resolved = resolveCommand(server.command, env);
    if (resolved) selected.push(selectedCraftServer(server, resolved, env));
    else skipped.push(server);
  }
  return { selected, skipped };
}

function verifyBinary(server, env) {
  if (!server.whenInstalled) return { ok: true };
  const resolved = resolveCommand(server.command, env);
  if (!resolved) return { ok: false, message: craftMissingMessage(server.command) };
  try {
    execFileSync(resolved, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `${server.command} --version failed${error?.message ? ` (${error.message})` : ''}` };
  }
}

function unwrapCliEntry(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.transport && typeof value.transport === 'object') {
    const transport = value.transport;
    return {
      command: transport.command ?? value.command,
      args: transport.args ?? value.args,
      url: transport.url ?? value.url,
      type: transport.type ?? value.type,
      env: transport.env ?? value.env,
      headers: transport.http_headers ?? transport.headers ?? value.headers
    };
  }
  if (value.config && typeof value.config === 'object') return unwrapCliEntry(value.config);
  if (value.server && typeof value.server === 'object') return unwrapCliEntry(value.server);
  return value;
}

function parseLabeledEnv(text) {
  const block = text.match(/^\s*Environment:\s*\n((?:[ \t]+.+\n?)*)/mi);
  if (!block) return undefined;
  const env = {};
  for (const line of block[1].split('\n')) {
    const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    if (!value || value === '[REDACTED]' || value === '***') continue;
    env[match[1]] = value;
  }
  return Object.keys(env).length ? env : undefined;
}

function parseLabeledGet(text) {
  const entry = {};
  const type = text.match(/^\s*Type:\s*(\S+)/mi)?.[1];
  const commandLine = text.match(/^\s*Command:\s*(.*)$/mi)?.[1]?.trim();
  const argsLine = text.match(/^\s*Args:\s*(.*)$/mi)?.[1]?.trim();
  const url = text.match(/^\s*URL:\s*(\S+)/mi)?.[1];
  if (type) entry.type = type;
  if (url) entry.url = url.replace(/^["']|["']$/g, '');
  if (commandLine && commandLine.toLowerCase() !== 'stdio') {
    const parts = commandLine.split(/\s+/).filter(Boolean);
    entry.command = parts[0];
    if (parts.length > 1 && !argsLine) entry.args = parts.slice(1);
  }
  if (argsLine) {
    try {
      entry.args = JSON.parse(argsLine);
    } catch {
      entry.args = argsLine.split(/\s+/).filter(Boolean);
    }
  }
  const env = parseLabeledEnv(text);
  if (env) entry.env = env;
  return Object.keys(entry).length ? entry : null;
}

export function parseCliMcpEntry(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  try {
    return unwrapCliEntry(JSON.parse(text));
  } catch {
    // Claude `mcp get` prints a labeled block, not JSON.
  }
  if (/^\s*(Type|Command|Args|URL|Scope):/mi.test(text) || /^\S+:\n\s+Scope:/m.test(text)) {
    return parseLabeledGet(text);
  }
  const entry = {};
  const url = text.match(/^\s*url:\s*(\S+)/mi)?.[1];
  const command = text.match(/^\s*command:\s*(\S+)/mi)?.[1];
  const argsLine = text.match(/^\s*args:\s*(.+)$/mi)?.[1];
  if (url) entry.url = url.replace(/^["']|["']$/g, '');
  if (command) entry.command = command.replace(/^["']|["']$/g, '');
  if (argsLine) {
    try {
      entry.args = JSON.parse(argsLine);
    } catch {
      entry.args = argsLine.split(/\s+/).filter(Boolean);
    }
  }
  return Object.keys(entry).length ? entry : null;
}

function runHostCli(bin, args, env, execFile) {
  try {
    const stdout = execFile(bin, args, { encoding: 'utf8', env, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout: String(stdout ?? '') };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? error.message ?? ''),
      status: error.status
    };
  }
}

export function cliGetIsNotFound(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  if (/No MCP server found with name:/i.test(text)) return true;
  if (/No MCP servers configured/i.test(text)) return true;
  if (/No MCP server named '.+' found/i.test(text)) return true;
  return false;
}

function getCliEntry(host, name, env, execFile) {
  const bin = host.kind === 'claude-cli' ? 'claude' : 'codex';
  const result = host.kind === 'claude-cli'
    ? runHostCli(bin, ['mcp', 'get', name], env, execFile)
    : runHostCli(bin, ['mcp', 'get', name, '--json'], env, execFile);
  if (cliGetIsNotFound(result)) return { ok: true, entry: null };
  if (!result.ok) {
    const detail = String(result.stderr || result.stdout || `${bin} mcp get failed`).trim();
    return { ok: false, error: `unable to read ${name} through ${bin} mcp get (${detail})` };
  }
  const entry = parseCliMcpEntry(result.stdout);
  if (entry) return { ok: true, entry };
  return { ok: false, error: `unable to parse ${bin} mcp get output for ${name}` };
}

function envFlags(server) {
  if (!server.env) return [];
  return Object.entries(server.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
}

function addCliEntry(host, server, env, execFile) {
  const args = host.kind === 'claude-cli'
    ? ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', ...envFlags(server), server.name, '--', server.command, ...server.args]
    : ['mcp', 'add', server.name, ...envFlags(server), '--', server.command, ...server.args];
  const bin = host.kind === 'claude-cli' ? 'claude' : 'codex';
  const result = runHostCli(bin, args, env, execFile);
  if (!result.ok) throw new Error(`Unable to add ${server.name} through ${bin} mcp add.`);
}

function removeCliEntry(host, name, env, execFile) {
  const args = host.kind === 'claude-cli'
    ? ['mcp', 'remove', '--scope', 'user', name]
    : ['mcp', 'remove', name];
  const bin = host.kind === 'claude-cli' ? 'claude' : 'codex';
  const result = runHostCli(bin, args, env, execFile);
  if (!result.ok) throw new Error(`Unable to replace ${name} through ${bin} mcp remove.`);
}

function applyCliMcpConfig(host, servers, env, execFile, { write }) {
  const reports = [];
  for (const server of servers) {
    const lookup = getCliEntry(host, server.name, env, execFile);
    if (!lookup.ok) {
      reports.push({ name: server.name, status: 'error', message: lookup.error });
      continue;
    }
    const existing = lookup.entry;
    const classification = classifyEntry(existing, server);
    if (classification === 'match') {
      if (!write) {
        const binary = verifyBinary(server, env);
        reports.push(binary.ok
          ? { name: server.name, status: 'ok' }
          : { name: server.name, status: 'error', message: binary.message });
      } else {
        reports.push({ name: server.name, status: 'unchanged', message: craftReportMessage(server) });
      }
      continue;
    }
    if (classification === 'conflict') {
      reports.push({ name: server.name, status: 'conflict', message: 'existing non-Shiori entry left untouched' });
      continue;
    }
    if (!write) {
      reports.push({ name: server.name, status: classification, message: craftReportMessage(server) });
      continue;
    }
    if (classification === 'stale') removeCliEntry(host, server.name, env, execFile);
    addCliEntry(host, server, env, execFile);
    reports.push({
      name: server.name,
      status: classification === 'stale' ? 'updated' : 'added',
      message: craftReportMessage(server)
    });
  }
  return reports;
}

function resolveJsonConfigPath(home, host) {
  const candidates = host.configCandidates ?? [host.configPath];
  for (const candidate of candidates) {
    try {
      accessSync(join(home, candidate));
      return join(home, candidate);
    } catch {
      // try the next candidate
    }
  }
  return join(home, host.configPath);
}

export function planHostMcp(host, home, env, { write, checkout, execFile, archiveUrl }) {
  const catalog = mcpServerCatalog({ checkout, archiveUrl });
  const { selected, skipped } = selectServersForInstall(catalog, env);
  const reports = skipped.map(server => ({ name: server.name, status: 'skipped', message: craftMissingMessage(server.command) }));
  const shape = host.jsonShape ?? 'mcpServers';
  const configPath = host.kind === 'json' ? resolveJsonConfigPath(home, host) : join(home, host.configPath);
  if (host.kind !== 'json') {
    reports.push(...applyCliMcpConfig(host, selected, env, execFile, { write }));
    return { host, configPath, changed: false, reports };
  }
  const currentText = readText(configPath);
  if (write) {
    const applied = applyJsonMcpConfig(currentText, selected, shape);
    return { host, configPath, currentText, nextText: applied.text, changed: applied.changed, reports: [...reports, ...applied.reports] };
  }
  for (const server of selected) {
    const existing = readJsonEntry(currentText, server.name, shape);
    if (existing === undefined) {
      reports.push({ name: server.name, status: 'error', message: `unable to parse ${host.configPath}` });
      continue;
    }
    const classification = classifyEntry(existing, server);
    if (classification === 'match') {
      const binary = verifyBinary(server, env);
      reports.push(binary.ok
        ? { name: server.name, status: 'ok' }
        : { name: server.name, status: 'error', message: binary.message });
      continue;
    }
    reports.push({
      name: server.name,
      status: classification,
      ...(classification === 'conflict' ? { message: 'existing non-Shiori entry left untouched' } : {})
    });
  }
  return { host, configPath, currentText, nextText: currentText, changed: false, reports };
}

function instructionBlock() {
  return `${BLOCK_START}\n${SHIORI_RULE_TEXT}\n${BLOCK_END}`;
}

export function applyInstructionFile(path, { write }) {
  const current = readText(path);
  const block = instructionBlock();
  if (current == null) {
    if (write) writeText(path, `${block}\n`);
    return { path, status: write ? 'added' : 'missing' };
  }
  if (current.includes(BLOCK_START) && current.includes(BLOCK_END)) {
    const next = current.replace(new RegExp(`${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), block);
    if (next === current) return { path, status: 'unchanged' };
    if (write) writeText(path, next);
    return { path, status: write ? 'updated' : 'stale' };
  }
  return { path, status: 'conflict', message: 'existing instructions file left untouched' };
}

export function detectedHosts(home) {
  const seen = new Set();
  const hosts = [];
  for (const host of Object.values(MCP_HOSTS)) {
    if (seen.has(host.id)) continue;
    seen.add(host.id);
    const detect = join(home, host.detectPath);
    try {
      accessSync(detect);
      hosts.push(host);
      continue;
    } catch {
      // fall through to config paths
    }
    for (const candidate of host.configCandidates ?? [host.configPath]) {
      try {
        accessSync(join(home, candidate));
        hosts.push(host);
        break;
      } catch {
        // host is not present at this path
      }
    }
  }
  return hosts;
}

export function resolveHost(name) {
  const host = MCP_HOSTS[String(name || '').trim().toLowerCase()];
  if (!host) throw new Error(`No MCP installer is available for: ${name}`);
  return host;
}

function formatReport(host, report) {
  const suffix = report.message ? ` (${report.message})` : '';
  return `MCP ${host.id} ${report.name} ${report.status}${suffix}`;
}

function finishMcpCli(lines, reports) {
  lines.push(MCP_DONE_LINE);
  return { lines, reports };
}

function detectCraftReport(env) {
  const { found, missing } = detectCraftClis(env);
  const lines = [];
  const reports = [];
  for (const server of found) {
    const message = serverInvocation(server);
    lines.push(`MCP detect ${server.name} found (${message})`);
    reports.push({ host: 'detect', name: server.name, status: 'found', message, command: server.command, args: server.args });
  }
  lines.push(`MCP detect not found: ${missing.length ? missing.map(app => app.name).join(', ') : 'none'}`);
  return finishMcpCli(lines, reports);
}

export function runMcpCli(argv, options = {}) {
  const env = options.env ?? process.env;
  const execFile = options.execFile ?? ((command, args, opts) => execFileSync(command, args, opts));
  const lines = [];
  const args = [...argv];
  let operation = args.shift();
  if (!operation || operation.startsWith('--')) throw new Error('Pass install, update, verify, or detect.');
  if (operation === 'update') operation = 'install';
  if (operation === 'list') operation = 'detect';
  if (!['install', 'verify', 'detect'].includes(operation)) throw new Error(`Unknown MCP operation: ${operation}`);
  let home = options.home ?? homedir();
  let checkout;
  let archiveUrl = env[ARCHIVE_ENV];
  const hostNames = [];
  while (args.length) {
    const flag = args.shift();
    if (flag === '--home') home = args.shift();
    else if (flag === '--host') hostNames.push(args.shift());
    else if (flag === '--checkout') checkout = args.shift();
    else if (flag === '--base-url') archiveUrl = args.shift();
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (operation === 'detect') return detectCraftReport(env);
  if (!home || !isAbsolute(home)) throw new Error('MCP home directory must be an absolute path.');
  if (!archiveUrl) {
    throw new Error(`Pass --base-url or set ${ARCHIVE_ENV} to the published Pages origin. The installer will not fall back to another project's archive.`);
  }
  archiveUrl = normalizeArchiveUrl(archiveUrl);
  checkout = resolveCheckout(checkout, home);
  const write = operation === 'install';
  const hosts = hostNames.length
    ? hostNames.map(resolveHost)
    : detectedHosts(home);
  if (write && !hostNames.length) throw new Error('Pass at least one --host: cursor, devin, opencode, claude, or codex.');
  if (!hosts.length) {
    lines.push('MCP no supported agent hosts detected');
    return finishMcpCli(lines, []);
  }
  const allReports = [];
  for (const host of hosts) {
    const plan = planHostMcp(host, home, env, { write, checkout, execFile, archiveUrl });
    if (write && host.kind === 'json' && plan.changed) writeJsonAtomic(plan.configPath, plan.nextText);
    for (const report of plan.reports) {
      lines.push(formatReport(host, report));
      allReports.push({ host: host.id, ...report });
    }
    if (!host.instructionPath) continue;
    if (!(write || detectedHosts(home).some(item => item.id === host.id) || hostNames.length)) continue;
    const instruction = applyInstructionFile(join(home, host.instructionPath), { write });
    lines.push(formatReport(host, { name: 'instructions', status: instruction.status, message: instruction.message }));
    allReports.push({ host: host.id, name: 'instructions', status: instruction.status, message: instruction.message });
  }
  return finishMcpCli(lines, allReports);
}

function canonicalPath(value) {
  const resolved = realpathSync(value).replace(/^\\\\\?\\/, '').replaceAll('\\', '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isMcpCliEntry(options = {}) {
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const argv1 = Object.prototype.hasOwnProperty.call(options, 'argv1') ? options.argv1 : process.argv[1];
  const main = Object.prototype.hasOwnProperty.call(options, 'main') ? options.main : import.meta.main;
  let self;
  try {
    self = fileURLToPath(moduleUrl).replaceAll('\\', '/');
  } catch {
    return false;
  }
  if (self.endsWith('/dist/index.js') || self.endsWith('/src/main.js')) return false;
  if (!argv1 || argv1 === '-') return false;
  if (main === true) return true;
  if (main === false) return false;
  try {
    return canonicalPath(fileURLToPath(moduleUrl)) === canonicalPath(argv1);
  } catch {
    try {
      return self === resolve(argv1).replaceAll('\\', '/');
    } catch {
      return false;
    }
  }
}

if (isMcpCliEntry()) {
  try {
    const { lines } = runMcpCli(process.argv.slice(2));
    for (const line of lines) console.log(line);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
