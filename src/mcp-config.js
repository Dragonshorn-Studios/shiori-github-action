#!/usr/bin/env node
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHIORI_BRAIN_MCP_PACKAGE = 'shiori-brain-mcp';
export const SHIORI_BRAIN_MCP_ARGS = ['-y', SHIORI_BRAIN_MCP_PACKAGE];
export const SHIORI_RULE_TEXT = 'Consult shiori-brain on demand (`search` / `read_doc`) before architecture or security decisions; do not dump that knowledge into context. Skills are procedures only.';

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
  { name: 'soundcraft', command: 'soundcraft-cli', summary: 'Digital audio workstation (SoundCraft)' }
];

export const MCP_HOSTS = {
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    format: 'json',
    detectPath: '.cursor',
    configPath: '.cursor/mcp.json',
    rulePath: '.cursor/rules/shiori-brain.mdc',
    ruleKind: 'mdc'
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    format: 'json',
    detectPath: '.claude',
    configPath: '.claude.json',
    rulePath: '.claude/rules/shiori-brain.md',
    ruleKind: 'md'
  },
  'claude-code': {
    id: 'claude',
    label: 'Claude Code',
    format: 'json',
    detectPath: '.claude',
    configPath: '.claude.json',
    rulePath: '.claude/rules/shiori-brain.md',
    ruleKind: 'md'
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    format: 'toml',
    detectPath: '.codex',
    configPath: '.codex/config.toml',
    rulePath: '.codex/rules/shiori-brain.md',
    ruleKind: 'md'
  }
};

export function mcpServerCatalog() {
  return [
    {
      name: 'shiori-brain',
      command: 'npx',
      args: [...SHIORI_BRAIN_MCP_ARGS],
      invocation: `npx ${SHIORI_BRAIN_MCP_ARGS.join(' ')}`,
      summary: 'Search and read the published Shiori knowledge archive',
      whenInstalled: false
    },
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
      ? `Only when \`${server.command}\` is on \`PATH\``
      : 'On `--install` / `--update` for Cursor, Claude Code, and Codex';
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

export function renderCursorRule() {
  return `---\ndescription: Consult shiori-brain on demand\nalwaysApply: true\n---\n\n${SHIORI_RULE_TEXT}\n`;
}

export function renderPlainRule() {
  return `${SHIORI_RULE_TEXT}\n`;
}

export function resolveCommand(name, env = process.env) {
  const paths = String(env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const dir of paths) {
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // try the next candidate
      }
    }
  }
  return null;
}

export function commandBasename(command) {
  return basename(String(command || '')).replace(/\.exe$/i, '');
}

function argsList(value) {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function isHttpEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const type = String(entry.type || '').toLowerCase();
  return Boolean(entry.url || entry.serverUrl || ['http', 'sse', 'streamable-http', 'ws'].includes(type));
}

export function isShioriBrainEntry(entry) {
  if (isHttpEntry(entry)) return false;
  if (commandBasename(entry?.command) !== 'npx') return false;
  const args = argsList(entry.args);
  const packageArg = args.find(arg => arg === SHIORI_BRAIN_MCP_PACKAGE || arg.startsWith(`${SHIORI_BRAIN_MCP_PACKAGE}@`));
  if (!packageArg) return false;
  return args.every(arg => arg === '-y' || arg === '--yes' || arg === packageArg);
}

export function isCraftEntry(entry, commandName) {
  if (isHttpEntry(entry)) return false;
  if (commandBasename(entry?.command) !== commandName) return false;
  const args = argsList(entry.args);
  return args.length === 1 && args[0] === 'mcp';
}

export function entriesEquivalent(existing, desired) {
  if (!existing) return false;
  if (commandBasename(existing.command) !== commandBasename(desired.command)) return false;
  const existingArgs = argsList(existing.args);
  const desiredArgs = argsList(desired.args);
  return existingArgs.length === desiredArgs.length && existingArgs.every((arg, index) => arg === desiredArgs[index]);
}

function desiredEntry(server) {
  return { command: server.command, args: [...server.args] };
}

export function classifyEntry(existing, server) {
  if (!existing || (existing.command == null && !argsList(existing.args).length)) return 'missing';
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

function parseJsonConfig(text) {
  if (text == null || !String(text).trim()) return { mcpServers: {} };
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP config must be a JSON object.');
  if (parsed.mcpServers == null) parsed.mcpServers = {};
  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers)) {
    throw new Error('mcpServers must be an object.');
  }
  return parsed;
}

function stringifyJsonConfig(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function applyJsonMcpConfig(text, servers) {
  const config = parseJsonConfig(text);
  const reports = [];
  let changed = false;
  for (const server of servers) {
    const existing = config.mcpServers[server.name];
    const classification = classifyEntry(existing, server);
    if (classification === 'match') {
      reports.push({ name: server.name, status: 'unchanged' });
      continue;
    }
    if (classification === 'conflict') {
      reports.push({ name: server.name, status: 'conflict', message: 'existing non-Shiori entry left untouched' });
      continue;
    }
    if (classification === 'stale') {
      config.mcpServers[server.name] = { ...existing, command: server.command, args: [...server.args] };
      reports.push({ name: server.name, status: 'updated' });
      changed = true;
      continue;
    }
    config.mcpServers[server.name] = desiredEntry(server);
    reports.push({ name: server.name, status: 'added' });
    changed = true;
  }
  return { text: stringifyJsonConfig(config), changed, reports, config };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTomlTable(text, header) {
  const re = new RegExp(`^\\[${escapeRegExp(header)}\\][ \\t]*$`, 'm');
  const match = re.exec(text);
  if (!match) return null;
  const headerEnd = match.index + match[0].length;
  const rest = text.slice(headerEnd);
  const next = rest.search(/^\[[^\]]+\][ \t]*$/m);
  const end = next === -1 ? text.length : headerEnd + next;
  return { start: match.index, headerEnd, end, body: text.slice(headerEnd, end) };
}

function unquoteToml(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTomlStringArray(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map(part => unquoteToml(part));
}

export function parseTomlMcpEntry(body) {
  const entry = {};
  for (const line of String(body).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    if (match[1] === 'command') entry.command = unquoteToml(match[2]);
    if (match[1] === 'args') {
      const args = parseTomlStringArray(match[2]);
      if (args) entry.args = args;
    }
  }
  return entry;
}

function tomlStringArray(args) {
  return `[${args.map(arg => JSON.stringify(arg)).join(', ')}]`;
}

function renderTomlServerBlock(server) {
  return `[mcp_servers.${server.name}]\ncommand = ${JSON.stringify(server.command)}\nargs = ${tomlStringArray(server.args)}\n`;
}

function replaceTomlKey(body, key, rendered) {
  const re = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*.*$`, 'm');
  if (re.test(body)) return body.replace(re, rendered);
  const prefix = body.startsWith('\n') ? '' : '\n';
  return `${prefix}${rendered}\n${body.replace(/^\n/, '')}`;
}

export function applyTomlMcpConfig(text, servers) {
  let next = text == null ? '' : String(text);
  const reports = [];
  let changed = false;
  for (const server of servers) {
    const table = findTomlTable(next, `mcp_servers.${server.name}`);
    if (!table) {
      const prefix = !next || next.endsWith('\n') ? '' : '\n';
      const blank = !next || next.endsWith('\n\n') ? '' : (next.length ? '\n' : '');
      next = `${next}${prefix}${blank}${renderTomlServerBlock(server)}`;
      reports.push({ name: server.name, status: 'added' });
      changed = true;
      continue;
    }
    const existing = parseTomlMcpEntry(table.body);
    const classification = classifyEntry(existing, server);
    if (classification === 'match') {
      reports.push({ name: server.name, status: 'unchanged' });
      continue;
    }
    if (classification === 'conflict') {
      reports.push({ name: server.name, status: 'conflict', message: 'existing non-Shiori entry left untouched' });
      continue;
    }
    let body = table.body;
    body = replaceTomlKey(body, 'command', `command = ${JSON.stringify(server.command)}`);
    body = replaceTomlKey(body, 'args', `args = ${tomlStringArray(server.args)}`);
    next = `${next.slice(0, table.headerEnd)}${body}${next.slice(table.end)}`;
    reports.push({ name: server.name, status: 'updated' });
    changed = true;
  }
  return { text: next, changed, reports };
}

function readJsonEntry(text, name) {
  try {
    return parseJsonConfig(text).mcpServers?.[name] ?? null;
  } catch {
    return undefined;
  }
}

function readTomlEntry(text, name) {
  const table = findTomlTable(text ?? '', `mcp_servers.${name}`);
  if (!table) return null;
  return parseTomlMcpEntry(table.body);
}

export function selectServersForInstall(catalog, env = process.env) {
  const selected = [];
  const skipped = [];
  for (const server of catalog) {
    if (!server.whenInstalled) {
      selected.push(server);
      continue;
    }
    if (resolveCommand(server.command, env)) selected.push(server);
    else skipped.push(server);
  }
  return { selected, skipped };
}

function verifyBinary(server, env) {
  if (!server.whenInstalled) return { ok: true };
  const resolved = resolveCommand(server.command, env);
  if (!resolved) return { ok: false, message: `${server.command} is not on PATH` };
  try {
    execFileSync(resolved, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `${server.command} --version failed${error?.message ? ` (${error.message})` : ''}` };
  }
}

export function planHostMcp(host, home, env, { write }) {
  const catalog = mcpServerCatalog();
  const configPath = join(home, host.configPath);
  const currentText = readText(configPath);
  const { selected, skipped } = selectServersForInstall(catalog, env);
  const reports = skipped.map(server => ({ name: server.name, status: 'skipped', message: `${server.command} is not on PATH` }));
  let nextText = currentText;
  let changed = false;
  if (write) {
    const applied = host.format === 'toml'
      ? applyTomlMcpConfig(currentText, selected)
      : applyJsonMcpConfig(currentText, selected);
    reports.push(...applied.reports);
    nextText = applied.text;
    changed = applied.changed;
  } else {
    for (const server of selected) {
      const existing = host.format === 'toml'
        ? readTomlEntry(currentText, server.name)
        : readJsonEntry(currentText, server.name);
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
      if (classification === 'missing') reports.push({ name: server.name, status: 'missing' });
      else if (classification === 'stale') reports.push({ name: server.name, status: 'stale' });
      else reports.push({ name: server.name, status: 'conflict', message: 'existing non-Shiori entry left untouched' });
    }
  }
  return { host, configPath, currentText, nextText, changed, reports };
}

export function applyRuleFile(host, home, { write }) {
  const path = join(home, host.rulePath);
  const desired = host.ruleKind === 'mdc' ? renderCursorRule() : renderPlainRule();
  const current = readText(path);
  if (current === desired) return { path, status: 'unchanged' };
  if (!write) return { path, status: current == null ? 'missing' : 'stale' };
  writeText(path, desired);
  return { path, status: current == null ? 'added' : 'updated' };
}

export function detectedHosts(home) {
  const seen = new Set();
  const hosts = [];
  for (const host of Object.values(MCP_HOSTS)) {
    if (seen.has(host.id)) continue;
    seen.add(host.id);
    const detect = join(home, host.detectPath);
    const config = join(home, host.configPath);
    try {
      accessSync(detect);
      hosts.push(host);
      continue;
    } catch {
      // fall through to config path
    }
    try {
      accessSync(config);
      hosts.push(host);
    } catch {
      // host is not present
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

export function runMcpCli(argv, options = {}) {
  const env = options.env ?? process.env;
  const lines = [];
  const args = [...argv];
  let operation = args.shift();
  if (!operation || operation.startsWith('--')) throw new Error('Pass install, update, or verify.');
  if (operation === 'update') operation = 'install';
  if (!['install', 'verify'].includes(operation)) throw new Error(`Unknown MCP operation: ${operation}`);
  let home = options.home ?? homedir();
  const hostNames = [];
  while (args.length) {
    const flag = args.shift();
    if (flag === '--home') home = args.shift();
    else if (flag === '--host') hostNames.push(args.shift());
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!home || !isAbsolute(home)) throw new Error('MCP home directory must be an absolute path.');
  const write = operation === 'install';
  const hosts = hostNames.length
    ? hostNames.map(resolveHost)
    : detectedHosts(home);
  if (write && !hostNames.length) throw new Error('Pass at least one --host: cursor, claude, or codex.');
  if (!hosts.length) {
    lines.push('MCP no supported agent hosts detected');
    return { lines, reports: [] };
  }
  const allReports = [];
  for (const host of hosts) {
    const plan = planHostMcp(host, home, env, { write });
    if (write && plan.changed) writeText(plan.configPath, plan.nextText);
    for (const report of plan.reports) {
      lines.push(formatReport(host, report));
      allReports.push({ host: host.id, ...report });
    }
    if (write || detectedHosts(home).some(item => item.id === host.id) || hostNames.length) {
      const rule = applyRuleFile(host, home, { write });
      lines.push(`MCP ${host.id} rule ${rule.status}`);
      allReports.push({ host: host.id, name: 'rule', status: rule.status });
    }
  }
  return { lines, reports: allReports };
}

function invokedDirectly() {
  const self = fileURLToPath(import.meta.url);
  if (!(self.endsWith('mcp-config.js') || self.endsWith('shiori-mcp.js'))) return false;
  const argv1 = process.argv[1];
  if (!argv1 || argv1 === '-') return true;
  try {
    return self === resolve(argv1);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    const { lines } = runMcpCli(process.argv.slice(2));
    for (const line of lines) console.log(line);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
