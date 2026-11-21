import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubPagesUrl, MCP_HOSTS, renderMcpMarkdownTable } from './mcp-config.js';

const DEFAULT_REPOSITORY = 'Dragonshorn-Studios/shiori-brain';

export const SKILL_DESTINATIONS = {
  agents: {
    id: 'agents',
    homePath: '.agents/skills',
    envName: 'SHIORI_SKILLS_HOME',
    managedFile: 'managed-skills',
    tempPrefix: '.shiori-link-',
    display: '~/.agents/skills'
  },
  claude: {
    id: 'claude',
    homePath: '.claude/skills',
    envName: 'SHIORI_CLAUDE_SKILLS_HOME',
    managedFile: 'managed-claude-skills',
    tempPrefix: '.shiori-link-',
    display: '~/.claude/skills'
  }
};

export const DOCTOR_HOSTS = [
  {
    id: 'opencode',
    aliases: [],
    statusName: 'OpenCode',
    guideName: 'opencode',
    nativeName: 'OpenCode',
    detectCommand: 'opencode',
    detectHome: ['.config/opencode'],
    detectFiles: [],
    skillsDest: 'agents',
    mcp: true,
    mcpHost: 'opencode',
    installable: true,
    skipWindows: false,
    cloud: false,
    statusKnown: true,
    legacyPlugin: null,
    installEffect: 'Managed checkout + Agent Skills links in `~/.agents/skills` + MCP config in `~/.config/opencode/opencode.jsonc`',
    projectUse: 'Automatic through `.agents/skills`',
    nativeSetup: '`--install opencode` uses the managed checkout and global `~/.agents/skills` links, and writes MCP config to `~/.config/opencode/opencode.jsonc`.',
    recipe: 'OpenCode: --install opencode links skills through ~/.agents/skills and writes MCP config.',
    psRecipe: 'OpenCode: select -Install opencode to link skills through ~/.agents/skills and write MCP config.'
  },
  {
    id: 'codex',
    aliases: [],
    statusName: 'Codex',
    guideName: 'codex',
    nativeName: 'Codex / ChatGPT desktop',
    detectCommand: 'codex',
    detectHome: ['.codex'],
    detectFiles: [],
    skillsDest: 'agents',
    mcp: true,
    mcpHost: 'codex',
    installable: true,
    skipWindows: false,
    cloud: false,
    statusKnown: true,
    legacyPlugin: 'codex',
    installEffect: 'Managed checkout + Agent Skills links in `~/.agents/skills` + MCP via `codex mcp add`. Does not install the Codex plugin.',
    projectUse: 'Repository skills work through `.agents/skills`',
    nativeSetup: '`--install codex` links skills through `~/.agents/skills` and writes MCP via `codex mcp add`. The plugin marketplace remains a separate channel for ChatGPT web (`codex plugin marketplace add ${repository}`), not owned by the doctor.',
    recipe: 'Codex:    --install codex links skills through ~/.agents/skills and writes MCP config. Plugin marketplace is a separate ChatGPT web channel.',
    psRecipe: 'Codex:    -Install codex links skills through ~/.agents/skills and writes MCP config. Plugin marketplace is a separate ChatGPT web channel.'
  },
  {
    id: 'claude',
    aliases: ['claude-code'],
    statusName: 'Claude Code',
    guideName: 'claude',
    nativeName: 'Claude Code',
    detectCommand: 'claude',
    detectHome: ['.claude'],
    detectFiles: [],
    skillsDest: 'claude',
    mcp: true,
    mcpHost: 'claude',
    installable: true,
    skipWindows: false,
    cloud: false,
    statusKnown: true,
    legacyPlugin: 'claude',
    installEffect: 'Managed checkout + Agent Skills links in `~/.claude/skills` + MCP via `claude mcp add -s user`. Does not install the Claude plugin.',
    projectUse: 'Automatic through `.claude/skills` and `.claude/agents`',
    nativeSetup: '`--install claude` links skills through `~/.claude/skills` and writes MCP via `claude mcp add -s user`. The plugin marketplace remains a separate channel (`/plugin marketplace add ${repository}`), not owned by the doctor.',
    recipe: 'Claude:   --install claude links skills through ~/.claude/skills and writes MCP config. Plugin marketplace is a separate channel.',
    psRecipe: 'Claude:   -Install claude links skills through ~/.claude/skills and writes MCP config. Plugin marketplace is a separate channel.'
  },
  {
    id: 'glm',
    aliases: ['glm-acp'],
    statusName: 'glm-acp-agent',
    guideName: 'glm',
    nativeName: 'glm-acp-agent',
    detectCommand: 'glm-acp-agent',
    detectHome: ['.local/share/zed/external_agents/registry/npx/glm-acp-agent/node_modules/.bin/glm-acp-agent'],
    detectFiles: ['.local/share/zed/external_agents/registry/npx/glm-acp-agent/node_modules/.bin/glm-acp-agent'],
    skillsDest: 'claude',
    mcp: false,
    mcpHost: null,
    installable: true,
    skipWindows: true,
    cloud: false,
    statusKnown: true,
    legacyPlugin: null,
    installEffect: 'Managed checkout + Agent Skills links in `~/.claude/skills` (shared with Claude Code). A Zed directory alone does not count as detection.',
    projectUse: 'Zed glm-acp-agent reads `~/.claude/skills`',
    nativeSetup: '`--install glm` (alias `glm-acp`) links skills through `~/.claude/skills`. Detection is file existence only (`glm-acp-agent` on `PATH` or the npx registry binary under `~/.local/share/zed`); the doctor never runs the binary. Windows support is out of scope.',
    recipe: 'glm:      --install glm links skills through ~/.claude/skills when glm-acp-agent is present as a file.',
    psRecipe: 'glm:      skipped on Windows; Unix --install glm links skills through ~/.claude/skills.'
  },
  {
    id: 'zcode',
    aliases: [],
    statusName: 'ZCode',
    guideName: 'zcode',
    nativeName: 'ZCode',
    detectCommand: 'zcode',
    detectHome: ['.zcode'],
    detectFiles: [],
    skillsDest: null,
    mcp: false,
    mcpHost: null,
    installable: false,
    skipWindows: false,
    cloud: false,
    statusKnown: false,
    legacyPlugin: null,
    installEffect: '',
    projectUse: 'Install the generated plugin',
    nativeSetup: 'Open **Settings -> Plugins -> Create -> Add marketplace**, enter `${repository}`, then install **Shiori**. Do not add `--install zcode`.',
    recipe: 'ZCode:    Settings -> Plugins -> Create -> Add marketplace -> ${repository}; install Shiori.',
    psRecipe: 'ZCode:    Settings -> Plugins -> Create -> Add marketplace -> ${repository}; install Shiori.'
  },
  {
    id: 'cursor',
    aliases: [],
    statusName: 'Cursor',
    guideName: 'cursor',
    nativeName: 'Cursor',
    detectCommand: 'cursor',
    detectHome: ['.cursor'],
    detectFiles: [],
    skillsDest: 'agents',
    mcp: true,
    mcpHost: 'cursor',
    installable: true,
    skipWindows: false,
    cloud: false,
    statusKnown: true,
    legacyPlugin: null,
    installEffect: 'Managed checkout + Agent Skills links in `~/.agents/skills` + MCP config in `~/.cursor/mcp.json`. Does not write `~/.cursor/skills`. Cursor Cloud gets no user-level skills.',
    projectUse: 'Automatic through `.cursor/skills` in the repository; local agent also reads `~/.agents/skills`',
    nativeSetup: '`--install cursor` writes MCP config and joins the shared `~/.agents/skills` sync. The doctor does not copy files into `~/.cursor/skills`. Cursor Cloud support is out of scope.',
    recipe: 'Cursor:   --install cursor writes MCP config and links skills through ~/.agents/skills. It does not write ~/.cursor/skills.',
    psRecipe: 'Cursor:   -Install cursor writes MCP config and links skills through ~/.agents/skills. It does not write ~/.cursor/skills.'
  },
  {
    id: 'mcode',
    aliases: [],
    statusName: 'MCode / MiniMax',
    guideName: 'mcode',
    nativeName: 'MCode / MiniMax Code',
    detectCommand: 'mcode',
    detectHome: ['.minimax'],
    detectFiles: [],
    skillsDest: 'agents',
    mcp: false,
    mcpHost: null,
    installable: true,
    skipWindows: false,
    cloud: false,
    statusKnown: true,
    legacyPlugin: null,
    installEffect: 'Managed checkout + Agent Skills links in `~/.agents/skills`',
    projectUse: 'Automatic through `.agents/skills` in this checkout',
    nativeSetup: '`--install mcode` uses the same managed checkout and global `~/.agents/skills` links.',
    recipe: 'MCode:    select --install mcode to use the same managed checkout and global Agent Skills links.',
    psRecipe: 'MCode:    select -Install mcode to use the same managed checkout and global Agent Skills links.'
  },
  {
    id: 'windsurf',
    aliases: [],
    statusName: 'Windsurf',
    guideName: 'windsurf',
    nativeName: 'Windsurf',
    detectCommand: 'windsurf',
    detectHome: ['.windsurf'],
    detectFiles: [],
    skillsDest: null,
    mcp: false,
    mcpHost: null,
    installable: false,
    skipWindows: false,
    cloud: false,
    statusKnown: false,
    legacyPlugin: null,
    installEffect: '',
    projectUse: 'Automatic through `.windsurf/skills`',
    nativeSetup: 'Keep the generated project adapter; no marketplace step is required.',
    recipe: '',
    psRecipe: ''
  },
  {
    id: 'vibe',
    aliases: [],
    statusName: 'Vibe',
    guideName: 'vibe',
    nativeName: 'Vibe',
    detectCommand: 'vibe',
    detectHome: ['.vibe'],
    detectFiles: [],
    skillsDest: 'agents',
    mcp: false,
    mcpHost: null,
    installable: true,
    skipWindows: false,
    cloud: false,
    statusKnown: true,
    legacyPlugin: null,
    installEffect: 'Managed checkout + Agent Skills links in `~/.agents/skills` only — does not copy into `~/.vibe/skills`',
    projectUse: 'Automatic through `.vibe/skills` in the repository; local Vibe also reads `~/.agents/skills`',
    nativeSetup: '`--install vibe` uses the same managed checkout and global `~/.agents/skills` links. It does not write `~/.vibe/skills`.',
    recipe: 'Vibe:     select --install vibe to use the same managed checkout and global Agent Skills links.',
    psRecipe: 'Vibe:     select -Install vibe to use the same managed checkout and global Agent Skills links.'
  },
  {
    id: 'devin',
    aliases: [],
    statusName: 'Devin',
    guideName: 'devin',
    nativeName: 'Devin',
    detectCommand: 'devin',
    detectHome: ['.config/devin', '.devin'],
    detectFiles: [],
    skillsDest: 'agents',
    mcp: true,
    mcpHost: 'devin',
    installable: true,
    skipWindows: false,
    cloud: true,
    statusKnown: true,
    legacyPlugin: null,
    installEffect: 'Managed checkout + Agent Skills links in `~/.agents/skills` + MCP config in `~/.config/devin/mcp_config.json`. Does not write `~/.config/devin/skills`.',
    projectUse: 'Automatic through committed `.devin/skills` in repository sessions; local Devin also reads `~/.agents/skills`',
    nativeSetup: '`--install devin` writes user-scope MCP config to `~/.config/devin/mcp_config.json` and joins the shared `~/.agents/skills` sync when selected. Devin may be cloud-only, so absence of a local executable is not an error. The doctor does not write `~/.config/devin/skills`.',
    recipe: 'Devin:    --install devin writes user-scope MCP config and links skills through ~/.agents/skills.',
    psRecipe: 'Devin:    -Install devin writes user-scope MCP config and links skills through ~/.agents/skills.'
  },
  {
    id: 'zed',
    aliases: [],
    statusName: 'Zed',
    guideName: 'zed',
    nativeName: 'Zed Agent',
    detectCommand: 'zed',
    detectHome: ['.config/zed', '.local/share/zed'],
    detectFiles: [],
    skillsDest: 'agents',
    mcp: false,
    mcpHost: null,
    installable: true,
    skipWindows: true,
    cloud: false,
    statusKnown: true,
    legacyPlugin: null,
    installEffect: 'Managed checkout + Agent Skills links in `~/.agents/skills` only. Does not write a Zed-specific skill tree.',
    projectUse: 'Automatic through `~/.agents/skills`',
    nativeSetup: '`--install zed` links skills through `~/.agents/skills`. Detected if `zed` is on `PATH`, or `~/.config/zed` / `~/.local/share/zed` exists. Windows support is out of scope.',
    recipe: 'Zed:      --install zed links skills through ~/.agents/skills.',
    psRecipe: 'Zed:      skipped on Windows; Unix --install zed links skills through ~/.agents/skills.'
  }
];

const CLI_HOST_ORDER = ['opencode', 'mcode', 'vibe', 'codex', 'claude', 'cursor', 'devin', 'zed', 'glm'];

export function installableDoctorHosts() {
  return DOCTOR_HOSTS.filter(host => host.installable);
}

export function installableDoctorHostsInCliOrder() {
  const hosts = installableDoctorHosts();
  const rank = new Map(CLI_HOST_ORDER.map((id, index) => [id, index]));
  return [...hosts].sort((a, b) => (rank.get(a.id) ?? 1000) - (rank.get(b.id) ?? 1000));
}

export function canonicalDoctorHostId(name) {
  const raw = String(name || '').trim().toLowerCase();
  for (const host of DOCTOR_HOSTS) {
    if (host.id === raw || host.aliases.includes(raw)) return host.id;
  }
  return raw;
}

function hostCasePattern(host) {
  return [host.id, ...host.aliases].join('|');
}

function fillRepo(text, repository) {
  return text.replaceAll('${repository}', repository);
}

function installableNamesList() {
  const names = installableDoctorHostsInCliOrder().map(host => host.id);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}`;
}

function renderInstallEffectTable() {
  const rows = installableDoctorHosts().map(host => `| ${host.guideName} | ${host.installEffect} |`);
  return ['| Host | `--install` effect |', '| --- | --- |', ...rows].join('\n');
}

function renderNativeSetupTable(repository) {
  const rows = DOCTOR_HOSTS.map(host => `| ${host.nativeName} | ${host.projectUse} | ${fillRepo(host.nativeSetup, repository)} |`);
  return ['| Host | Project use | Native reusable installation |', '| --- | --- | --- |', ...rows].join('\n');
}

function shellDetectExpr(host) {
  const parts = [];
  if (host.detectCommand) parts.push(`has_command ${host.detectCommand}`);
  for (const dir of host.detectHome) parts.push(`has_home '${dir}'`);
  for (const file of host.detectFiles) parts.push(`[ -f "$HOME/${file}" ]`);
  return parts.join(' || ') || 'return 1';
}

function shellHostDetectedCases() {
  return DOCTOR_HOSTS.map(host => `    ${hostCasePattern(host)}) ${shellDetectExpr(host)} ;;`).join('\n');
}

function shellNormalizeCases() {
  const lines = [];
  for (const host of DOCTOR_HOSTS) {
    for (const alias of host.aliases) {
      lines.push(`    ${alias}) printf '%s\\n' '${host.id}' ;;`);
    }
  }
  lines.push("    *) printf '%s\\n' \"$1\" ;;");
  return lines.join('\n');
}

function shellSkillsDestCases() {
  const groups = new Map();
  for (const host of installableDoctorHosts()) {
    if (!host.skillsDest) continue;
    const list = groups.get(host.skillsDest) || [];
    list.push(hostCasePattern(host));
    groups.set(host.skillsDest, list);
  }
  return [...groups.entries()].map(([dest, patterns]) => `    ${patterns.join('|')}) ${dest}_skills_selected='true' ;;`).join('\n');
}

function shellMcpCases() {
  const patterns = installableDoctorHosts().filter(host => host.mcp).map(hostCasePattern);
  return `    ${patterns.join('|')}) mcp_selected='true' ;;`;
}

function shellStatusSkillsCases() {
  const groups = new Map();
  for (const host of installableDoctorHosts()) {
    if (!host.skillsDest) continue;
    const list = groups.get(host.skillsDest) || [];
    list.push(hostCasePattern(host));
    groups.set(host.skillsDest, list);
  }
  return [...groups.entries()].map(([dest, patterns]) => {
    const check = dest === 'claude' ? 'claude_skills_installed' : 'shared_skills_installed';
    return `    ${patterns.join('|')})\n      ${check} && parts='managed Agent Skills'\n      ;;`;
  }).join('\n');
}

function shellMcpStatusPatterns() {
  return installableDoctorHosts().filter(host => host.mcp).map(hostCasePattern).join('|');
}

function shellKnownStatusPatterns() {
  return DOCTOR_HOSTS.filter(host => host.statusKnown).map(hostCasePattern).join('|');
}

function shellInstallCases() {
  return installableDoctorHosts().map(host => {
    const ids = [host.id, ...host.aliases];
    const patterns = ids.flatMap(id => [`install:${id}`, `update:${id}`]).join('|');
    const steps = [`record_host ${host.id}`];
    if (host.mcp) steps.push(`run_mcp_cli install --host ${host.mcpHost || host.id}`);
    return `      ${patterns}) ${steps.join('; ')} ;;`;
  }).join('\n');
}

function shellAssertCases() {
  return installableDoctorHosts().map(host => {
    const lines = [`    ${hostCasePattern(host)})`];
    if (host.skillsDest) {
      lines.push('      has_command git && has_command ln && has_command readlink && has_command rm && has_command mkdir && has_command mv || { printf \'%s\\n\' \'Cannot install shared skills: git, ln, readlink, rm, mkdir, and mv are required. On Windows use the PowerShell installer.\' >&2; return 1; }');
    }
    if (host.mcp) {
      lines.push(`      has_command node || { printf '%s\\n' 'Cannot install ${host.statusName} MCP: node is not available.' >&2; return 1; }`);
    }
    if (!host.skillsDest && !host.mcp) {
      lines.push(`      printf 'No command-line installer is available for: %s\\n' \"$1\" >&2; return 1`);
    }
    lines.push('      ;;');
    return lines.join('\n');
  }).join('\n');
}

function shellStatusRows() {
  return DOCTOR_HOSTS.map(host => {
    const mode = host.cloud ? 'cloud' : 'local';
    const home = host.detectHome[0] ? `'${host.detectHome[0]}'` : "''";
    const command = host.detectCommand || host.id;
    return `row '${host.statusName}' ${command} ${home} ${mode} ${host.id}`;
  }).join('\n');
}

function shellRecipes(repository) {
  return installableDoctorHosts().concat(DOCTOR_HOSTS.filter(host => !host.installable && host.recipe))
    .filter(host => host.recipe)
    .map(host => `  ${fillRepo(host.recipe, repository)}`)
    .join('\n');
}

function psDetectExpr(host) {
  const parts = [];
  if (host.detectCommand) {
    parts.push(`((Get-Command ${host.detectCommand} -ErrorAction SilentlyContinue) -ne $null)`);
  }
  for (const dir of host.detectHome) {
    parts.push(`(Test-Path -LiteralPath (Join-Path $HOME '${dir.replaceAll("'", "''")}'))`);
  }
  for (const file of host.detectFiles) {
    parts.push(`(Test-Path -LiteralPath (Join-Path $HOME '${file.replaceAll("'", "''")}'))`);
  }
  return parts.join(' -or ') || '$false';
}

function psHostDetectedSwitch() {
  return DOCTOR_HOSTS.map(host => {
    if (host.skipWindows) {
      return `        { $_ -in @(${[host.id, ...host.aliases].map(id => `'${id}'`).join(', ')}) } { return $false }`;
    }
    if (host.aliases.length) {
      return `        { $_ -in @(${[host.id, ...host.aliases].map(id => `'${id}'`).join(', ')}) } { return (${psDetectExpr(host)}) }`;
    }
    return `        '${host.id}' { return (${psDetectExpr(host)}) }`;
  }).join('\n');
}

function psCanonicalSwitch() {
  const lines = [];
  for (const host of DOCTOR_HOSTS) {
    for (const alias of host.aliases) {
      lines.push(`        '${alias}' { return '${host.id}' }`);
    }
  }
  lines.push("        default { return $Name }");
  return lines.join('\n');
}

function psSkillsDestList(dest) {
  return installableDoctorHosts().filter(host => host.skillsDest === dest).map(host => `'${host.id}'`).join(', ');
}

function psMcpList() {
  return installableDoctorHosts().filter(host => host.mcp).map(host => `'${host.id}'`).join(', ');
}

function psSkipWindowsList() {
  return DOCTOR_HOSTS.filter(host => host.skipWindows).map(host => `'${host.id}'`).join(', ');
}

function psStatusSkillsSwitch() {
  const groups = new Map();
  for (const host of installableDoctorHosts()) {
    if (!host.skillsDest) continue;
    const list = groups.get(host.skillsDest) || [];
    list.push(`'${host.id}'`);
    groups.set(host.skillsDest, list);
  }
  return [...groups.entries()].map(([dest, ids]) => {
    const check = dest === 'claude' ? 'Test-ClaudeSkillsInstalled' : 'Test-SharedSkillsInstalled';
    return `        { $_ -in @(${ids.join(', ')}) } {\n            if (${check}) { $Parts += 'managed Agent Skills' }\n        }`;
  }).join('\n');
}

function psKnownStatusList() {
  return DOCTOR_HOSTS.filter(host => host.statusKnown).map(host => `'${host.id}'`).join(', ');
}

function psInstallSwitch() {
  return installableDoctorHosts().map(host => {
    const ids = [host.id, ...host.aliases];
    const patterns = ids.flatMap(id => [`'install:${id}'`, `'update:${id}'`]);
    const body = [`Add-RecordedHost ${host.id}`];
    if (host.mcp) body.push(`Invoke-McpCli -McpArgs @('install', '--host', '${host.mcpHost || host.id}')`);
    return `            { $_ -in @(${patterns.join(', ')}) } { ${body.join('; ')} }`;
  }).join('\n');
}

function psAssertSwitch() {
  const skip = psSkipWindowsList();
  const skipBlock = skip
    ? `        { $_ -in @(${skip}) } {\n            [Console]::Error.WriteLine(\"Skipping \$_ : Windows support is not available.\")\n            return\n        }\n`
    : '';
  const cases = installableDoctorHosts().filter(host => !host.skipWindows).map(host => {
    const pattern = host.aliases.length
      ? `{ $_ -in @(${[host.id, ...host.aliases].map(id => `'${id}'`).join(', ')}) }`
      : `'${host.id}'`;
    const body = [];
    if (host.skillsDest) {
      body.push("            if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Cannot install shared skills: git is not available.' }");
    }
    if (host.mcp) {
      body.push(`            if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Cannot install ${host.statusName} MCP: node is not available.' }`);
    }
    return `        ${pattern} {\n${body.join('\n')}\n        }`;
  }).join('\n');
  return `${skipBlock}${cases}`;
}

function psStatusRows() {
  return DOCTOR_HOSTS.map(host => {
    const command = host.detectCommand || host.id;
    const home = host.detectHome[0] ? `'${host.detectHome[0].replaceAll('\\', '\\\\')}'` : '$null';
    const cloud = host.cloud ? ' -Cloud' : '';
    return `Show-AgentStatus '${host.statusName}' ${command} ${home} ${host.id}${cloud}`;
  }).join('\n');
}

function psRecipes(repository) {
  return DOCTOR_HOSTS.filter(host => host.psRecipe).map(host => `  ${fillRepo(host.psRecipe, repository)}`).join('\n');
}

function allDoctorHostIds() {
  const seen = new Set();
  const ids = [];
  for (const host of installableDoctorHostsInCliOrder()) {
    ids.push(host.id);
    seen.add(host.id);
  }
  for (const host of DOCTOR_HOSTS) {
    if (!seen.has(host.id)) ids.push(host.id);
  }
  return ids;
}

function mcpTildePath(host) {
  const mcp = MCP_HOSTS[host.mcpHost || host.id];
  return mcp?.configPath ? `~/${mcp.configPath.replaceAll('\\', '/')}` : '';
}

function shellSkillDestHostCases() {
  const groups = new Map();
  for (const host of installableDoctorHosts()) {
    if (!host.skillsDest) continue;
    const list = groups.get(host.skillsDest) || [];
    list.push(hostCasePattern(host));
    groups.set(host.skillsDest, list);
  }
  return [...groups.entries()].map(([dest, patterns]) => `      ${patterns.join('|')}) ${dest}_hosts=\"$${dest}_hosts $selected_target\" ;;`).join('\n');
}

function shellMcpDestCases() {
  return installableDoctorHosts().filter(host => host.mcp).map(host => `      ${hostCasePattern(host)}) printf '${host.id}: MCP -> ${mcpTildePath(host)}\\n' ;;`).join('\n');
}

function psMcpDestSwitch() {
  return installableDoctorHosts().filter(host => host.mcp).map(host => `        { $_ -in @(${[host.id, ...host.aliases].map(id => `'${id}'`).join(', ')}) } { Write-Output '${host.id}: MCP -> ${mcpTildePath(host)}' }`).join('\n');
}

function shellLegacyPluginFns() {
  return `warn_legacy_codex_plugin() {
  config_file="$HOME/.codex/config.toml"
  [ -f "$config_file" ] || return 0
  if contains_text "$(cat "$config_file" 2>/dev/null)" "plugins.\\"shiori@$marketplace\\""; then
    printf 'Warning: Codex plugin shiori@%s duplicates skills now synced to ~/.agents/skills. Remove it with: codex plugin remove shiori@%s\\n' "$marketplace" "$marketplace" >&2
  fi
}
warn_legacy_claude_plugin() {
  config_file="$HOME/.claude/plugins/installed_plugins.json"
  [ -f "$config_file" ] || return 0
  if contains_text "$(cat "$config_file" 2>/dev/null)" "shiori@$marketplace"; then
    printf 'Warning: Claude plugin shiori@%s duplicates skills now synced to ~/.claude/skills. Remove it with: claude plugin uninstall shiori@%s --scope user\\n' "$marketplace" "$marketplace" >&2
  fi
}`;
}

export function mcpHelperSource() {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-config.js'), 'utf8');
}

function mcpPackageFiles() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'shiori-brain-mcp');
  return [
    ['packages/shiori-brain-mcp/src/index.js', readFileSync(join(root, 'src/index.js'), 'utf8')],
    ['packages/shiori-brain-mcp/src/knowledge.js', readFileSync(join(root, 'src/knowledge.js'), 'utf8')],
    ['packages/shiori-brain-mcp/package.json', readFileSync(join(root, 'package.json'), 'utf8')],
    ['packages/shiori-brain-mcp/README.md', readFileSync(join(root, 'README.md'), 'utf8')]
  ];
}

export function installSupportFiles(config) {
  const repository = config.repository || DEFAULT_REPOSITORY;
  const marketplace = config.marketplaceName || 'shiori-knowledge';
  const archiveUrl = githubPagesUrl(repository);
  return new Map([
    ['AGENT-SETUP.md', renderGuide(repository, marketplace, archiveUrl)],
    ['scripts/shiori-doctor.sh', renderShellDoctor(repository, marketplace, archiveUrl)],
    ['scripts/shiori-doctor.ps1', renderPowerShellDoctor(repository, marketplace, archiveUrl)],
    ['scripts/shiori-mcp.mjs', mcpHelperSource()],
    ...mcpPackageFiles()
  ]);
}

function renderGuide(repository, marketplace, archiveUrl) {
  const rawBase = `https://raw.githubusercontent.com/${repository}/main`;
  const exampleHosts = installableDoctorHostsInCliOrder().map(host => host.id).join(' ');
  return `# Install Shiori for coding agents

Run the read-only doctor without cloning the repository:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh
\`\`\`

\`\`\`powershell
irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

If this repository is already checked out, the doctor also recognizes the project adapters:

\`\`\`bash
sh scripts/shiori-doctor.sh
\`\`\`

\`\`\`powershell
.\\scripts\\shiori-doctor.ps1
\`\`\`

The doctor is read-only. It does not edit home-directory configuration or install plugins. When piped from GitHub it runs in remote mode and does not assume that this repository's project skill directories exist locally. Default \`--install\` / \`--update\` output is a checkout line, the detected hosts, one line per destination, and a short summary. \`--verbose\` (or \`SHIORI_VERBOSE=1\`) restores the status table, recipes, git, and MCP lines. \`--help\` prints usage.

## Install from the command line

\`--install\` or \`--update\` with no host names sets up every locally detected installable host. An explicit host list still takes precedence over detection. Hosts that already read \`~/.agents/skills\` with full skill functionality share one managed checkout at \`~/.local/share/shiori/shiori-brain\` and receive individual links in \`~/.agents/skills/<name>\`. Claude Code uses the same checkout linked into \`~/.claude/skills/<name>\`. Two hosts that share a destination never get two copies. The doctor does not install Codex or Claude plugins; those remain published in the repository marketplace as a separate channel (ChatGPT web and manual installs). Cursor, Devin, OpenCode, Claude Code, and Codex also receive MCP config under \`--install\` / \`--update\`. Devin is detected only when the \`devin\` CLI is on \`PATH\` or \`~/.config/devin\` / \`~/.devin\` exists; cloud-capable status alone is not enough:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh -s -- --install ${exampleHosts}
\`\`\`

\`\`\`powershell
$env:SHIORI_INSTALL='${installableDoctorHostsInCliOrder().map(host => host.id).join(',')}'; irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

For a checked-out script, use \`sh scripts/shiori-doctor.sh --install\` to set up every detected host, or \`sh scripts/shiori-doctor.sh --install opencode mcode vibe\` / \`.\\scripts\\shiori-doctor.ps1 -Install opencode,mcode,vibe\` to name hosts. Re-running install fast-forwards the managed checkout and reconciles skill links. Existing non-Shiori skill destinations are skipped with a warning and never overwritten. A host that is not detected is not created.

Valid host names: ${installableDoctorHostsInCliOrder().map(host => `\`${host.id}\``).join(', ').replace(/, ([^,]*)$/, ', and $1')}${installableDoctorHosts().some(host => host.aliases.includes('claude-code')) ? ' (`claude-code` is accepted as `claude`)' : ''}. What each one does:

${renderInstallEffectTable()}

## Update installed hosts

\`--install\` records each host it successfully sets up in \`~/.local/state/shiori/installed-hosts\`. A named \`--update\` still re-runs the current doctor against those recorded hosts. A bare \`--update\` (or \`SHIORI_UPDATE=all\`) sets up every host the doctor currently detects, including tools that were never recorded. Recorded-but-no-longer-detected hosts are not required. If a detected host cannot be installed, the doctor warns, continues with the rest, and exits non-zero:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh -s -- --update
\`\`\`

\`\`\`powershell
$env:SHIORI_UPDATE='all'; irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

Pass names after \`--install\` / \`--update\`, or use PowerShell \`-Install opencode\` / \`-Update -UpdateTargets opencode,mcode\`, to change only selected hosts. A bare run with no \`--install\` / \`--update\` stays read-only. Checkout updates are always \`git pull --ff-only\`; an unexpected origin, dirty checkout, non-repository path, or skills directory symlink leaving \`\$HOME\` stops the operation rather than deleting user data. A second consecutive \`--update\` with no checkout change reports \`already current\` and writes nothing. If nothing installable is detected, the doctor prints an error on stderr and writes nothing.

## Native setup matrix

${renderNativeSetupTable(repository)}

## MCP servers

The doctor can add a local stdio MCP client for the published Pages archive, plus Storytold Craft CLIs that are already on \`PATH\`. Default doctor mode is still read-only and does not launch Claude or Codex. MCP writes happen only under \`--install\` / \`--update\`: Cursor via \`~/.cursor/mcp.json\`, Devin via \`~/.config/devin/mcp_config.json\`, OpenCode via \`~/.config/opencode/opencode.jsonc\` (\`mcp.servers\`; an existing \`opencode.json\` is updated in place instead. Fresh installs choose \`.jsonc\` so other tools' flat-schema OpenCode imports do not misread the file), Claude Code via \`claude mcp add -s user\`, and Codex via \`codex mcp add\`. The shiori-brain server is \`node <checkout>/packages/shiori-brain-mcp/src/index.js\` from the managed checkout; it is not loaded from a package registry. Installed entries set \`SHIORI_BRAIN_BASE_URL\` to this project's Pages origin (\`${archiveUrl || 'https://<owner>.github.io/<repo>/'}\`). Override with \`SHIORI_BRAIN_BASE_URL\` if Pages uses a custom domain. The installer fails instead of using another project's archive when that URL cannot be determined. Existing non-Shiori MCP entries are never overwritten.

${renderMcpMarkdownTable()}
Consult shiori-brain on demand (\`search\` / \`read_doc\`) before architecture or security decisions; do not dump that knowledge into context. Skills are procedures only.

## What gets generated

- \`plugins/shiori/plugin.json\`: portable [Agent Plugins](https://agent-plugins.org/) manifest.
- \`plugins/shiori/.codex-plugin/plugin.json\`: Codex compatibility manifest.
- \`.agents/plugins/marketplace.json\`: native repository marketplace for Codex and ChatGPT desktop.
- \`scripts/shiori-mcp.mjs\`: helper used by the doctor to add and verify MCP entries.
- \`packages/shiori-brain-mcp/\`: local stdio MCP server launched from the managed checkout.
- Host-specific project skill directories, all generated from the same AFFiNE documents.

AFFiNE remains canonical. Do not edit generated skills, manifests, this guide, or the doctor scripts by hand; change Shiori and regenerate them.
`;
}

function renderShellDoctor(repository, marketplace, archiveUrl) {
  const names = installableNamesList();
  return `#!/usr/bin/env sh
set -eu

repository=\"\${SHIORI_REPOSITORY:-${repository}}\"
marketplace=\"\${SHIORI_MARKETPLACE:-${marketplace}}\"
default_archive_url='${archiveUrl}'
guide_url=\"https://github.com/$repository/blob/main/AGENT-SETUP.md\"
checkout=\"\${SHIORI_CHECKOUT:-$HOME/.local/share/shiori/shiori-brain}\"
state_root=\"\${SHIORI_STATE_HOME:-$HOME/.local/state/shiori}\"
skills_root=\"\${SHIORI_SKILLS_HOME:-$HOME/.agents/skills}\"
claude_skills_root=\"\${SHIORI_CLAUDE_SKILLS_HOME:-$HOME/.claude/skills}\"
installed_hosts_file=\"$state_root/installed-hosts\"
managed_skills_file=\"$state_root/managed-skills\"
managed_claude_skills_file=\"$state_root/managed-claude-skills\"
skill_link_temp_prefix='.shiori-link-'
checkout_changed='false'
skills_changed='false'
checkout_line=''
verbose='false'
help='false'
mcp_helper_tmp=''
mcp_helper_dir=''
if [ -d '.agents/skills' ] && [ -d 'plugins/shiori' ]; then
  context='checkout'
  project_hint='project adapters are ready in this checkout'
else
  context='remote'
  project_hint='no Shiori checkout detected; use a marketplace installation below'
fi

has_command() { command -v \"$1\" >/dev/null 2>&1; }
has_home() { [ -e \"$HOME/$1\" ]; }
cleanup_mcp_helper() {
  [ -z \"$mcp_helper_tmp\" ] || rm -f \"$mcp_helper_tmp\"
  [ -z \"$mcp_helper_dir\" ] || rm -rf \"$mcp_helper_dir\"
}
trap cleanup_mcp_helper EXIT
resolve_mcp_helper() {
  if [ -n \"\${SHIORI_MCP_HELPER:-}\" ] && [ -f \"$SHIORI_MCP_HELPER\" ]; then
    printf '%s\\n' \"$SHIORI_MCP_HELPER\"
    return 0
  fi
  if [ -f 'scripts/shiori-mcp.mjs' ]; then
    printf '%s\\n' 'scripts/shiori-mcp.mjs'
    return 0
  fi
  has_command curl || { printf '%s\\n' 'Cannot load the Shiori MCP helper: curl is not available.' >&2; return 1; }
  mcp_helper_dir=$(mktemp -d) || return 1
  mcp_helper_tmp=\"$mcp_helper_dir/shiori-mcp.mjs\"
  curl -fsSL \"https://raw.githubusercontent.com/$repository/main/scripts/shiori-mcp.mjs\" > \"$mcp_helper_tmp\" || return 1
  printf '%s\\n' \"$mcp_helper_tmp\"
}
archive_url() {
  if [ -n \"\${SHIORI_BRAIN_BASE_URL:-}\" ]; then
    printf '%s\\n' \"$SHIORI_BRAIN_BASE_URL\"
    return 0
  fi
  if [ -n \"$default_archive_url\" ]; then
    printf '%s\\n' \"$default_archive_url\"
    return 0
  fi
  owner=\${repository%%/*}
  repo=\${repository#*/}
  [ -n \"$owner\" ] && [ -n \"$repo\" ] && [ \"$repository\" != \"$owner\" ] || return 1
  owner_lc=$(printf '%s' \"$owner\" | tr '[:upper:]' '[:lower:]')
  repo_lc=$(printf '%s' \"$repo\" | tr '[:upper:]' '[:lower:]')
  if [ \"$repo_lc\" = \"$owner_lc.github.io\" ]; then
    printf 'https://%s.github.io/\\n' \"$owner_lc\"
    return 0
  fi
  printf 'https://%s.github.io/%s/\\n' \"$owner_lc\" \"$repo\"
}
is_allowed_archive_url() {
  lowered=$(printf '%s' \"$1\" | tr '[:upper:]' '[:lower:]')
  case $lowered in
    https://*) return 0 ;;
  esac
  rest=\${lowered#http://}
  [ \"$rest\" != \"$lowered\" ] || return 1
  hostport=\${rest%%/*}
  case $hostport in
    localhost|localhost:*|127.0.0.1|127.0.0.1:*) return 0 ;;
    \\[::1\\]|\\[::1\\]:*) return 0 ;;
  esac
  return 1
}
run_mcp_cli() {
  has_command node || { printf '%s\\n' 'Skipping MCP config: node is not available.' >&2; return 0; }
  helper=$(resolve_mcp_helper) || return 1
  pages_origin=$(archive_url) || pages_origin=''
  [ -n \"$pages_origin\" ] || { printf '%s\\n' 'Set SHIORI_BRAIN_BASE_URL to the published Pages origin before installing MCP servers. The installer will not fall back to another project archive.' >&2; return 1; }
  is_allowed_archive_url \"$pages_origin\" || { printf '%s\\n' 'SHIORI_BRAIN_BASE_URL must be an https URL (http is allowed only for localhost).' >&2; return 1; }
  if [ \"$verbose\" = true ]; then
    node \"$helper\" \"$@\" --home \"$HOME\" --checkout \"$checkout\" --base-url \"$pages_origin\"
  else
    node \"$helper\" \"$@\" --home \"$HOME\" --checkout \"$checkout\" --base-url \"$pages_origin\" >/dev/null
  fi
}
contains_text() {
  case $1 in
    *\"$2\"*) return 0 ;;
    *) return 1 ;;
  esac
}
normalize_host() {
  case $1 in
${shellNormalizeCases()}
  esac
}
host_detected() {
  case $1 in
${shellHostDetectedCases()}
    *) return 1 ;;
  esac
}
record_host() {
  mkdir -p \"$state_root\"
  if [ -f \"$installed_hosts_file\" ]; then
    while IFS= read -r recorded_host; do [ \"$recorded_host\" = \"$1\" ] && return 0; done < \"$installed_hosts_file\"
  fi
  printf '%s\\n' \"$1\" >> \"$installed_hosts_file\"
}
host_is_recorded() {
  [ -f \"$installed_hosts_file\" ] || return 1
  while IFS= read -r recorded_host; do [ \"$recorded_host\" = \"$1\" ] && return 0; done < \"$installed_hosts_file\"
  return 1
}
assert_home() {
  [ -n \"\${HOME:-}\" ] || { printf '%s\\n' 'HOME is empty or missing.' >&2; return 1; }
}
phys_home() {
  CDPATH= cd -P \"$HOME\" 2>/dev/null && pwd
}
is_our_skill_link() {
  [ -L \"$1\" ] && [ \"$(readlink \"$1\")\" = \"$2\" ]
}
assert_skills_dest() {
  dest=$1
  assert_home || return 1
  home_phys=$(phys_home) || { printf '%s\\n' 'HOME is empty or missing.' >&2; return 1; }
  case $dest in
    \"$HOME\"|\"$HOME\"/*|\"$home_phys\"|\"$home_phys\"/*) ;;
    *) printf 'Refusing to write skills outside HOME: %s\\n' \"$dest\" >&2; return 1 ;;
  esac
  existing=$dest
  while [ ! -e \"$existing\" ] && [ ! -L \"$existing\" ]; do
    parent=$(dirname \"$existing\")
    [ \"$parent\" = \"$existing\" ] && break
    existing=$parent
  done
  if [ -L \"$existing\" ] || [ -d \"$existing\" ]; then
    dest_phys=$(CDPATH= cd -P \"$existing\" 2>/dev/null && pwd) || {
      printf 'Refusing skills directory symlink that leaves HOME: %s\\n' \"$dest\" >&2
      return 1
    }
    case $dest_phys in
      \"$home_phys\"|\"$home_phys\"/*) ;;
      *) printf 'Refusing skills directory symlink that leaves HOME: %s\\n' \"$dest\" >&2; return 1 ;;
    esac
  fi
}
cleanup_skill_temps() {
  dest=$1
  [ -d \"$dest\" ] || return 0
  for leftover in \"$dest\"/$skill_link_temp_prefix*; do
    if [ -L \"$leftover\" ] || [ -e \"$leftover\" ]; then
      rm -f \"$leftover\"
    fi
  done
}
ensure_checkout() {
  has_command git || { printf '%s\\n' 'Cannot install shared skills: git is not available.' >&2; return 1; }
  if [ -d \"$checkout/.git\" ]; then
    checkout_origin=$(git -C \"$checkout\" remote get-url origin)
    case $checkout_origin in
      \"https://github.com/$repository\"|\"https://github.com/$repository.git\"|\"git@github.com:$repository.git\") ;;
      *) printf 'Refusing to update checkout with unexpected origin: %s\\n' \"$checkout_origin\" >&2; return 1 ;;
    esac
    [ -z \"$(git -C \"$checkout\" status --porcelain)\" ] || { printf 'Refusing to update dirty checkout: %s\\n' \"$checkout\" >&2; return 1; }
    before=$(git -C \"$checkout\" rev-parse HEAD)
    if [ \"$verbose\" = true ]; then
      git -C \"$checkout\" pull --ff-only origin main
    else
      git -C \"$checkout\" pull -q --ff-only origin main
    fi
    after=$(git -C \"$checkout\" rev-parse HEAD)
    if [ \"$before\" = \"$after\" ]; then
      checkout_line=\"checkout: already up to date $after\"
    else
      checkout_changed='true'
      checkout_line=\"checkout: fast-forwarded $after\"
    fi
  elif [ -e \"$checkout\" ] || [ -L \"$checkout\" ]; then
    printf 'Refusing to replace non-checkout path: %s\\n' \"$checkout\" >&2
    return 1
  else
    mkdir -p \"\${checkout%/*}\"
    if [ \"$verbose\" = true ]; then
      git clone --filter=blob:none --branch main \"https://github.com/$repository.git\" \"$checkout\"
    else
      git clone -q --filter=blob:none --branch main \"https://github.com/$repository.git\" \"$checkout\"
    fi
    checkout_changed='true'
    after=$(git -C \"$checkout\" rev-parse HEAD)
    checkout_line=\"checkout: cloned $after\"
  fi
}
sync_skills_dest() {
  dest_root=$1
  managed_file=$2
  [ -d \"$checkout/skills\" ] || { printf 'Checkout has no skills directory: %s\\n' \"$checkout\" >&2; return 1; }
  has_command ln && has_command readlink && has_command rm && has_command mkdir && has_command mv || { printf '%s\\n' 'Cannot link skills: ln, readlink, rm, mkdir, and mv are required. On Windows use the PowerShell installer.' >&2; return 1; }
  assert_skills_dest \"$dest_root\" || return 1
  mkdir -p \"$state_root\"
  if [ ! -e \"$dest_root\" ] && [ ! -L \"$dest_root\" ]; then
    mkdir -p \"$dest_root\"
  fi
  assert_skills_dest \"$dest_root\" || return 1
  cleanup_skill_temps \"$dest_root\"
  if [ -f \"$managed_file\" ]; then
    while IFS= read -r old_skill; do
      [ -n \"$old_skill\" ] || continue
      old_target=\"$dest_root/$old_skill\"
      old_source=\"$checkout/skills/$old_skill\"
      if [ ! -d \"$old_source\" ] && is_our_skill_link \"$old_target\" \"$old_source\"; then
        rm \"$old_target\"
        skills_changed='true'
      fi
    done < \"$managed_file\"
  fi
  next_managed=\"$managed_file.next\"
  : > \"$next_managed\"
  for source_skill in \"$checkout/skills\"/*; do
    [ -d \"$source_skill\" ] || continue
    skill_name=\${source_skill##*/}
    target_skill=\"$dest_root/$skill_name\"
    if [ -L \"$target_skill\" ] || [ -e \"$target_skill\" ]; then
      if is_our_skill_link \"$target_skill\" \"$source_skill\"; then
        printf '%s\\n' \"$skill_name\" >> \"$next_managed\"
        continue
      fi
      printf 'Warning: skipping skill %s; %s already belongs to something else.\\n' \"$skill_name\" \"$target_skill\" >&2
      continue
    fi
    tmp_skill=\"$dest_root/$skill_link_temp_prefix$skill_name.$$\"
    ln -s \"$source_skill\" \"$tmp_skill\"
    mv \"$tmp_skill\" \"$target_skill\"
    printf '%s\\n' \"$skill_name\" >> \"$next_managed\"
    skills_changed='true'
  done
  if [ -f \"$managed_file\" ] && [ \"$(cat \"$next_managed\")\" = \"$(cat \"$managed_file\")\" ]; then
    rm -f \"$next_managed\"
  else
    mv \"$next_managed\" \"$managed_file\"
    skills_changed='true'
  fi
  if [ \"$verbose\" = true ]; then
    printf 'Shared Shiori skills linked from %s into %s.\\n' \"$checkout\" \"$dest_root\"
  fi
}
sync_shared_skills() {
  sync_skills_dest \"$skills_root\" \"$managed_skills_file\"
}
sync_claude_skills() {
  sync_skills_dest \"$claude_skills_root\" \"$managed_claude_skills_file\"
}
${shellLegacyPluginFns()}
comma_hosts() {
  first=true
  for item; do
    if [ \"$first\" = true ]; then
      printf '%s' \"$item\"
      first=false
    else
      printf ', %s' \"$item\"
    fi
  done
}
list_detected_hosts() {
  detected_list=''
  not_detected=''
${allDoctorHostIds().map(id => `  if host_detected ${id}; then detected_list=\"$detected_list ${id}\"; else not_detected=\"$not_detected ${id}\"; fi`).join('\n')}
  detected_list=\${detected_list# }
  not_detected=\${not_detected# }
}
print_quiet_destinations() {
  agents_hosts=''
  claude_hosts=''
  for selected_target in $selected_targets; do
    case $selected_target in
${shellSkillDestHostCases()}
    esac
  done
  agents_hosts=\${agents_hosts# }
  claude_hosts=\${claude_hosts# }
  [ -z \"$agents_hosts\" ] || printf '%s: skills -> ${SKILL_DESTINATIONS.agents.display}\\n' \"$(comma_hosts $agents_hosts)\"
  [ -z \"$claude_hosts\" ] || printf '%s: skills -> ${SKILL_DESTINATIONS.claude.display}\\n' \"$(comma_hosts $claude_hosts)\"
  for selected_target in $selected_targets; do
    case $selected_target in
${shellMcpDestCases()}
    esac
  done
}
print_quiet_report() {
  if [ -z \"$checkout_line\" ] && [ -d \"$checkout/.git\" ]; then
    checkout_line=\"checkout: already up to date $(git -C \"$checkout\" rev-parse HEAD)\"
  fi
  [ -z \"$checkout_line\" ] || printf '%s\\n' \"$checkout_line\"
  list_detected_hosts
  printf 'detected: %s\\n' \"\${detected_list:-none}\"
  print_quiet_destinations
  if [ \"$install_failed\" = true ] && [ \"$checkout_changed\" = false ] && [ \"$skills_changed\" = false ]; then
    printf 'skipped\\n'
  elif [ \"$checkout_changed\" = false ] && [ \"$skills_changed\" = false ]; then
    printf 'already current\\n'
  else
    printf 'updated\\n'
  fi
}
print_usage() {
  printf '%s\\n' \\
    '' \\
    'How --install and --update work' \\
    '  --install [hosts]  set up the named hosts, or every locally detected host if none are named. Valid names: ${installableDoctorHostsInCliOrder().map(host => host.id).join(', ')}.' \\
    '  --update [hosts]   re-run the installer for the named hosts, or every currently detected host if none are named.' \\
    '                     Recorded-but-missing hosts are not required. Capabilities added by a newer doctor are applied on update.' \\
    '  --verbose          print the status table, recipes, git, and MCP lines.' \\
    '  --help             print this usage text.' \\
    '  Host names may be space- or comma-separated; SHIORI_INSTALL / SHIORI_UPDATE / SHIORI_VERBOSE are the pipe equivalents.' \\
    '' \\
    'Recommended native setup' \\
${shellRecipes(repository).split('\n').map(line => `    '${line}'`).join(' \\\n')} \\
    '' \\
    \"Full instructions: $guide_url\"
}
print_banner() {
  printf 'Shiori agent doctor\\nRepository: %s\\nMode: %s (%s)\\n\\n' \"$repository\" \"$context\" \"$project_hint\"
${shellStatusRows()}
  printf '%s\\n' '' 'MCP servers' '  Installed under --install / --update for cursor, devin, opencode, claude, and codex. A read-only run does not launch host CLIs.'
  print_usage
}
operation=''
selected_targets=\"\${SHIORI_INSTALL:-}\"
case \${SHIORI_VERBOSE:-} in 1|true|all|yes) verbose='true' ;; esac
while [ \"$#\" -gt 0 ]; do
  case $1 in
    --verbose) verbose='true'; shift ;;
    --help) help='true'; shift ;;
    *) break ;;
  esac
done
[ -z \"\${SHIORI_UPDATE:-}\" ] || { [ -z \"$selected_targets\" ] || { printf '%s\\n' 'Choose either SHIORI_INSTALL or SHIORI_UPDATE.' >&2; exit 2; }; operation='update'; selected_targets=\"$SHIORI_UPDATE\"; }
[ -z \"$selected_targets\" ] || operation=\"\${operation:-install}\"
if [ \"$#\" -gt 0 ]; then
  [ -z \"$operation\" ] || { printf '%s\\n' 'Do not combine environment and command-line operations.' >&2; exit 2; }
  case $1 in
    --install) operation='install' ;;
    --update) operation='update' ;;
    *) printf 'Unknown option: %s\\n' \"$1\" >&2; exit 2 ;;
  esac
  shift
  selected_targets=\"$*\"
fi
normalized_targets=''
for selected_target in $selected_targets; do
  [ -n \"$selected_target\" ] || continue
  selected_target=$(normalize_host \"$selected_target\")
  normalized_targets=\"$normalized_targets $selected_target\"
done
selected_targets=\${normalized_targets# }
case $selected_targets in
  all|1|true) selected_targets='' ;;
esac
select_detected_hosts() {
  selected_targets=''
${installableDoctorHostsInCliOrder().map(host => `    host_detected ${host.id} && selected_targets=\"$selected_targets ${host.id}\"`).join('\n')}
  selected_targets=\${selected_targets# }
}
if [ -n \"$operation\" ] && [ -z \"$selected_targets\" ]; then
  select_detected_hosts
  if [ -z \"$selected_targets\" ]; then
    printf '%s\\n' 'No installable hosts detected. Pass a host name to --install / --update: ${names}.' >&2
    exit 2
  fi
fi
assert_installer() {
  case $1 in
${shellAssertCases()}
    *) printf 'No command-line installer is available for: %s\\n' \"$1\" >&2; return 1 ;;
  esac
}
row() {
  tool=$1
  command_name=$2
  home_path=$3
  mode=$4
  provider=$5
  if has_command \"$command_name\"; then
    printf '%-18s detected (CLI: %s) | Shiori: %s\\n' \"$tool\" \"$(command -v \"$command_name\")\" \"$(shiori_status \"$provider\")\"
  elif [ -n \"$home_path\" ] && has_home \"$home_path\"; then
    printf '%-18s detected (configuration: ~/%s) | Shiori: %s\\n' \"$tool\" \"$home_path\" \"$(shiori_status \"$provider\")\"
  elif [ \"$mode\" = cloud ]; then
    printf '%-18s cloud-capable (local CLI not required) | Shiori: %s\\n' \"$tool\" \"$(shiori_status \"$provider\")\"
  else
    printf '%-18s not detected locally\\n' \"$tool\"
  fi
}

skills_dest_installed() {
  dest_root=$1
  managed_file=$2
  [ -d \"$checkout/.git\" ] && [ -s \"$managed_file\" ] || return 1
  found_skill=false
  while IFS= read -r skill_name; do
    [ -n \"$skill_name\" ] || continue
    found_skill=true
    target_skill=\"$dest_root/$skill_name\"
    source_skill=\"$checkout/skills/$skill_name\"
    is_our_skill_link \"$target_skill\" \"$source_skill\" || return 1
  done < \"$managed_file\"
  [ \"$found_skill\" = true ]
}

shared_skills_installed() {
  skills_dest_installed \"$skills_root\" \"$managed_skills_file\"
}

claude_skills_installed() {
  skills_dest_installed \"$claude_skills_root\" \"$managed_claude_skills_file\"
}

mcp_configured() {
  case $1 in
    cursor) mcp_files='.cursor/mcp.json' ;;
    devin) mcp_files='.config/devin/mcp_config.json' ;;
    opencode) mcp_files='.config/opencode/opencode.json .config/opencode/opencode.jsonc' ;;
    claude|claude-code) mcp_files='.claude.json' ;;
    codex) mcp_files='.codex/config.toml' ;;
    *) return 1 ;;
  esac
  for mcp_file in $mcp_files; do
    [ -f \"$HOME/$mcp_file\" ] || continue
    contains_text \"$(cat \"$HOME/$mcp_file\" 2>/dev/null)\" 'shiori-brain' && return 0
  done
  return 1
}

shiori_status() {
  parts=''
  case $1 in
${shellStatusSkillsCases()}
  esac
  case $1 in
    ${shellMcpStatusPatterns()})
      mcp_configured \"$1\" && parts=\"\${parts:+$parts + }MCP configured\"
      ;;
  esac
  if [ -n \"$parts\" ]; then
    printf 'installed (%s)' \"$parts\"
    return
  fi
  case $1 in
    ${shellKnownStatusPatterns()}) printf '%s' 'not installed' ;;
    *) printf '%s' 'unknown (no local status API)' ;;
  esac
}

if [ \"$help\" = true ]; then
  print_usage
  exit 0
fi
if [ \"$verbose\" = true ]; then
  print_banner
fi
if [ -z \"$operation\" ] && [ \"$verbose\" != true ]; then
  list_detected_hosts
  printf 'detected: %s\\n' \"\${detected_list:-none}\"
  printf 'not detected: %s\\n' \"\${not_detected:-none}\"
fi

if [ -n \"$operation\" ]; then
  assert_home || exit 2
  if [ \"$verbose\" = true ]; then
    printf '%s\\n' '' \"Selected operation: $operation\"
  fi
  previous_ifs=$IFS
  IFS=', '
  agents_skills_selected='false'
  claude_skills_selected='false'
  mcp_selected='false'
  warn_codex_plugin='false'
  warn_claude_plugin='false'
  install_failed='false'
  usable_targets=''
  for selected_target in $selected_targets; do
    if assert_installer \"$selected_target\"; then
      usable_targets=\"$usable_targets $selected_target\"
    else
      printf 'Warning: cannot install %s; continuing with remaining hosts.\\n' \"$selected_target\" >&2
      install_failed='true'
    fi
  done
  selected_targets=\${usable_targets# }
  if [ -z \"$selected_targets\" ]; then
    printf '%s\\n' 'No remaining hosts could be installed.' >&2
    exit 1
  fi
  for selected_target in $selected_targets; do
    case $selected_target in
${shellSkillsDestCases()}
    esac
    case $selected_target in
${shellMcpCases()}
    esac
    case $selected_target in
      codex) warn_codex_plugin='true' ;;
      claude|claude-code) warn_claude_plugin='true' ;;
    esac
  done
  if [ \"$agents_skills_selected\" = true ] || [ \"$claude_skills_selected\" = true ] || [ \"$mcp_selected\" = true ]; then
    [ \"$operation\" != update ] || [ -d \"$checkout/.git\" ] || [ \"$mcp_selected\" = true ] || { printf 'No managed checkout exists to update: %s\\n' \"$checkout\" >&2; exit 2; }
    if [ \"$agents_skills_selected\" = true ] || [ \"$claude_skills_selected\" = true ]; then
      [ \"$operation\" != update ] || [ -d \"$checkout/.git\" ] || { printf 'No managed checkout exists to update: %s\\n' \"$checkout\" >&2; exit 2; }
      ensure_checkout
    fi
  fi
  if [ \"$agents_skills_selected\" = true ]; then
    sync_shared_skills
    [ \"$warn_codex_plugin\" = true ] && warn_legacy_codex_plugin
  fi
  if [ \"$claude_skills_selected\" = true ]; then
    sync_claude_skills
    [ \"$warn_claude_plugin\" = true ] && warn_legacy_claude_plugin
  fi
  if [ \"$mcp_selected\" = true ]; then
    mcp_script=\"$checkout/packages/shiori-brain-mcp/src/index.js\"
    if [ ! -f \"$mcp_script\" ]; then ensure_checkout; fi
    if [ \"$operation\" = update ] && [ -d \"$checkout/.git\" ]; then ensure_checkout; fi
    [ -f \"$mcp_script\" ] || { printf 'Shiori checkout is missing the MCP server: %s\\n' \"$mcp_script\" >&2; exit 1; }
  fi
  for selected_target in $selected_targets; do
    case \"$operation:$selected_target\" in
${shellInstallCases()}
    esac
  done
  IFS=$previous_ifs
  if [ \"$verbose\" = true ]; then
    if [ \"$checkout_changed\" = false ] && [ \"$skills_changed\" = false ]; then
      printf 'already current\\n'
    fi
  else
    print_quiet_report
  fi
  if [ \"$install_failed\" = true ]; then
    exit 1
  fi
fi
`;
}

function renderPowerShellDoctor(repository, marketplace, archiveUrl) {
  const names = installableNamesList();
  const agentsList = psSkillsDestList('agents');
  const claudeList = psSkillsDestList('claude');
  const mcpList = psMcpList();
  return `# Generated by Shiori. Safe to run from a checkout or through irm | iex.
param(
    [string[]]$Install = @(),
    [switch]$Update,
    [string[]]$UpdateTargets = @(),
    [switch]$Verbose,
    [switch]$Help
)

$Repository = if ($env:SHIORI_REPOSITORY) { $env:SHIORI_REPOSITORY } else { '${repository}' }
$Marketplace = if ($env:SHIORI_MARKETPLACE) { $env:SHIORI_MARKETPLACE } else { '${marketplace}' }
$DefaultArchiveUrl = '${archiveUrl}'
$GuideUrl = "https://github.com/$Repository/blob/main/AGENT-SETUP.md"
$ManagedCheckout = if ($env:SHIORI_CHECKOUT) { $env:SHIORI_CHECKOUT } else { Join-Path $HOME '.local/share/shiori/shiori-brain' }
$StateRoot = if ($env:SHIORI_STATE_HOME) { $env:SHIORI_STATE_HOME } else { Join-Path $HOME '.local/state/shiori' }
$SkillsRoot = if ($env:SHIORI_SKILLS_HOME) { $env:SHIORI_SKILLS_HOME } else { Join-Path $HOME '.agents/skills' }
$ClaudeSkillsRoot = if ($env:SHIORI_CLAUDE_SKILLS_HOME) { $env:SHIORI_CLAUDE_SKILLS_HOME } else { Join-Path $HOME '.claude/skills' }
$InstalledHostsFile = Join-Path $StateRoot 'installed-hosts'
$ManagedSkillsFile = Join-Path $StateRoot 'managed-skills'
$ManagedClaudeSkillsFile = Join-Path $StateRoot 'managed-claude-skills'
$SkillLinkTempPrefix = '.shiori-link-'
$script:CheckoutChanged = $false
$script:SkillsChanged = $false
$script:CheckoutLine = ''
if ($env:SHIORI_VERBOSE -and $env:SHIORI_VERBOSE -notin @('0', 'false')) { $Verbose = $true }
$script:Verbose = [bool]$Verbose
$McpHelperTemp = $null
$LocalCheckout = (Test-Path -LiteralPath '.agents\\skills') -and (Test-Path -LiteralPath 'plugins\\shiori')
$Mode = if ($LocalCheckout) { 'checkout' } else { 'remote' }
$ProjectHint = if ($LocalCheckout) { 'project adapters are ready in this checkout' } else { 'no Shiori checkout detected; use a marketplace installation below' }

function Get-McpHelper {
    if ($env:SHIORI_MCP_HELPER -and (Test-Path -LiteralPath $env:SHIORI_MCP_HELPER)) { return $env:SHIORI_MCP_HELPER }
    if (Test-Path -LiteralPath 'scripts\\shiori-mcp.mjs') { return (Resolve-Path -LiteralPath 'scripts\\shiori-mcp.mjs').Path }
    $script:McpHelperTemp = Join-Path ([IO.Path]::GetTempPath()) ('shiori-mcp-' + [guid]::NewGuid().ToString() + '.mjs')
    Invoke-WebRequest -UseBasicParsing -Uri \"https://raw.githubusercontent.com/$Repository/main/scripts/shiori-mcp.mjs\" -OutFile $script:McpHelperTemp
    return $script:McpHelperTemp
}

function Get-ShioriArchiveUrl {
    if ($env:SHIORI_BRAIN_BASE_URL) { return $env:SHIORI_BRAIN_BASE_URL }
    if ($DefaultArchiveUrl) { return $DefaultArchiveUrl }
    $Parts = @($Repository -split '/', 2)
    if ($Parts.Count -ne 2 -or -not $Parts[0] -or -not $Parts[1]) { return '' }
    $Owner = $Parts[0].ToLowerInvariant()
    $Repo = $Parts[1]
    if ($Repo.ToLowerInvariant() -eq ($Owner + '.github.io')) { return \"https://$Owner.github.io/\" }
    return \"https://$Owner.github.io/$Repo/\"
}

function Test-ShioriArchiveUrl {
    param([string]$Url)
    try { $Parsed = [Uri]$Url } catch { return $false }
    if (-not $Parsed.IsAbsoluteUri) { return $false }
    if ($Parsed.Scheme -eq 'https') { return $true }
    if ($Parsed.Scheme -ne 'http') { return $false }
    $HostName = $Parsed.Host.Trim('[]').ToLowerInvariant()
    return @('localhost', '127.0.0.1', '::1') -contains $HostName
}

function Invoke-McpCli {
    param([string[]]$McpArgs)
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        [Console]::Error.WriteLine('Skipping MCP config: node is not available.')
        return
    }
    $ArchiveUrl = Get-ShioriArchiveUrl
    if (-not $ArchiveUrl) { throw 'Set SHIORI_BRAIN_BASE_URL to the published Pages origin before installing MCP servers. The installer will not fall back to another project''s archive.' }
    if (-not (Test-ShioriArchiveUrl $ArchiveUrl)) { throw 'SHIORI_BRAIN_BASE_URL must be an https URL (http is allowed only for localhost).' }
    $Helper = Get-McpHelper
    if ($script:Verbose) {
        & node $Helper @McpArgs --home $HOME --checkout $ManagedCheckout --base-url $ArchiveUrl
    } else {
        & node $Helper @McpArgs --home $HOME --checkout $ManagedCheckout --base-url $ArchiveUrl | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { throw \"Shiori MCP helper failed with exit code $LASTEXITCODE\" }
}

function Assert-Home {
    if (-not $HOME) { throw 'HOME is empty or missing.' }
}

function Test-IsUnderHome {
    param([string]$Path, [string]$HomeFull)
    $Full = [IO.Path]::GetFullPath($Path)
    $Prefix = if ($HomeFull.EndsWith([IO.Path]::DirectorySeparatorChar) -or $HomeFull.EndsWith('/')) { $HomeFull } else { $HomeFull + [IO.Path]::DirectorySeparatorChar }
    return $Full.Equals($HomeFull, [StringComparison]::OrdinalIgnoreCase) -or $Full.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-SkillsDest {
    param([string]$DestRoot)
    Assert-Home
    $HomeFull = [IO.Path]::GetFullPath($HOME)
    $FullDest = [IO.Path]::GetFullPath($DestRoot)
    if (-not (Test-IsUnderHome $FullDest $HomeFull)) { throw \"Refusing to write skills outside HOME: $DestRoot\" }
    $Existing = $DestRoot
    while ($Existing -and -not (Test-Path -LiteralPath $Existing) -and -not (Get-Item -LiteralPath $Existing -Force -ErrorAction SilentlyContinue)) {
        $Parent = Split-Path -Parent $Existing
        if (-not $Parent -or $Parent -eq $Existing) { break }
        $Existing = $Parent
    }
    $Item = Get-Item -LiteralPath $Existing -Force -ErrorAction SilentlyContinue
    if ($Item -and $Item.LinkType -in @('Junction', 'SymbolicLink')) {
        $Target = [IO.Path]::GetFullPath([string]@($Item.Target)[0])
        if (-not (Test-IsUnderHome $Target $HomeFull)) { throw \"Refusing skills directory symlink that leaves HOME: $DestRoot\" }
    } elseif ($Item -and $Item.PSIsContainer) {
        $Resolved = [IO.Path]::GetFullPath($Item.FullName)
        if (-not (Test-IsUnderHome $Resolved $HomeFull)) { throw \"Refusing skills directory symlink that leaves HOME: $DestRoot\" }
    }
}

function Show-AgentStatus {
    param([string]$Name, [string]$Command, [string]$HomePath, [string]$Provider, [switch]$Cloud)
    $Executable = Get-Command $Command -ErrorAction SilentlyContinue
    $ConfigPath = if ($HomePath) { Join-Path $HOME $HomePath } else { $null }
    if ($Executable) {
        Write-Host ($Name.PadRight(18) + ' detected (CLI: ' + $Executable.Source + ') | Shiori: ' + (Get-ShioriInstallStatus $Provider))
    } elseif ($ConfigPath -and (Test-Path -LiteralPath $ConfigPath)) {
        Write-Host ($Name.PadRight(18) + ' detected (configuration: ' + $ConfigPath + ') | Shiori: ' + (Get-ShioriInstallStatus $Provider))
    } elseif ($Cloud) {
        Write-Host ($Name.PadRight(18) + ' cloud-capable (local CLI not required) | Shiori: ' + (Get-ShioriInstallStatus $Provider))
    } else {
        Write-Host ($Name.PadRight(18) + ' not detected locally')
    }
}

function Get-RecordedHostNames {
    if (-not (Test-Path -LiteralPath $InstalledHostsFile)) { return @() }
    return @(Get-Content -LiteralPath $InstalledHostsFile | ForEach-Object { $_.Trim().TrimStart([char]0xFEFF) } | Where-Object { $_ })
}

function Add-RecordedHost {
    param([string]$Target)
    New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
    $Recorded = @(Get-RecordedHostNames)
    if ($Recorded -contains $Target) { return }
    $Utf8 = New-Object System.Text.UTF8Encoding $false
    $Lines = $Recorded + $Target
    [IO.File]::WriteAllText($InstalledHostsFile, (($Lines -join [char]10) + [char]10), $Utf8)
}

function Test-RecordedHost {
    param([string]$Target)
    return (Get-RecordedHostNames) -contains $Target
}

function Update-ManagedCheckout {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Cannot install shared skills: git is not available.' }
    $GitDirectory = Join-Path $ManagedCheckout '.git'
    if (Test-Path -LiteralPath $GitDirectory) {
        $Origin = (& git -C $ManagedCheckout remote get-url origin | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Unable to read the managed checkout origin.' }
        $AllowedOrigins = @(\"https://github.com/$Repository\", \"https://github.com/$Repository.git\", \"git@github.com:$Repository.git\")
        if ($AllowedOrigins -notcontains $Origin) { throw \"Refusing to update checkout with unexpected origin: $Origin\" }
        $Dirty = (& git -C $ManagedCheckout status --porcelain | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the managed checkout.' }
        if ($Dirty) { throw \"Refusing to update dirty checkout: $ManagedCheckout\" }
        $Before = (& git -C $ManagedCheckout rev-parse HEAD | Out-String).Trim()
        if ($script:Verbose) {
            & git -C $ManagedCheckout pull --ff-only origin main
        } else {
            & git -C $ManagedCheckout pull -q --ff-only origin main
        }
        if ($LASTEXITCODE -ne 0) { throw 'Unable to fast-forward the managed Shiori checkout.' }
        $After = (& git -C $ManagedCheckout rev-parse HEAD | Out-String).Trim()
        if ($Before -ne $After) {
            $script:CheckoutChanged = $true
            $script:CheckoutLine = \"checkout: fast-forwarded $After\"
        } else {
            $script:CheckoutLine = \"checkout: already up to date $After\"
        }
    } elseif (Get-Item -LiteralPath $ManagedCheckout -Force -ErrorAction SilentlyContinue) {
        throw \"Refusing to replace non-checkout path: $ManagedCheckout\"
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ManagedCheckout) | Out-Null
        if ($script:Verbose) {
            & git clone --filter=blob:none --branch main \"https://github.com/$Repository.git\" $ManagedCheckout
        } else {
            & git clone -q --filter=blob:none --branch main \"https://github.com/$Repository.git\" $ManagedCheckout
        }
        if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the managed Shiori checkout.' }
        $script:CheckoutChanged = $true
        $After = (& git -C $ManagedCheckout rev-parse HEAD | Out-String).Trim()
        $script:CheckoutLine = \"checkout: cloned $After\"
    }
}

function Get-CanonicalPath {
    param([string]$Path)
    if (-not $Path) { return '' }
    try {
        $Full = [IO.Path]::GetFullPath($Path)
        $Item = Get-Item -LiteralPath $Full -Force -ErrorAction SilentlyContinue
        if ($Item) { return [IO.Path]::GetFullPath($Item.FullName) }
        return $Full
    } catch {
        return $Path
    }
}

function Test-ShioriSkillLink {
    param($Item, [string]$ExpectedTarget)
    if (-not $Item -or $Item.LinkType -notin @('Junction', 'SymbolicLink')) { return $false }
    $ActualTarget = Get-CanonicalPath ([string]@($Item.Target)[0])
    return $ActualTarget.ToLowerInvariant() -eq (Get-CanonicalPath $ExpectedTarget).ToLowerInvariant()
}

function Test-SkillsDestInstalled {
    param([string]$DestRoot, [string]$ManagedFile)
    if (-not (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git')) -or -not (Test-Path -LiteralPath $ManagedFile)) { return $false }
    $SkillNames = @(Get-Content -LiteralPath $ManagedFile | Where-Object { $_ })
    if ($SkillNames.Count -eq 0) { return $false }
    foreach ($SkillName in $SkillNames) {
        $ExpectedTarget = Join-Path (Join-Path $ManagedCheckout 'skills') $SkillName
        $Item = Get-Item -LiteralPath (Join-Path $DestRoot $SkillName) -Force -ErrorAction SilentlyContinue
        if (-not (Test-ShioriSkillLink $Item $ExpectedTarget)) { return $false }
    }
    return $true
}

function Test-SharedSkillsInstalled {
    return Test-SkillsDestInstalled $SkillsRoot $ManagedSkillsFile
}

function Test-ClaudeSkillsInstalled {
    return Test-SkillsDestInstalled $ClaudeSkillsRoot $ManagedClaudeSkillsFile
}

function Get-CanonicalHost {
    param([string]$Name)
    switch ($Name) {
${psCanonicalSwitch()}
    }
}

function Test-HostDetected {
    param([string]$Target)
    switch ($Target) {
${psHostDetectedSwitch()}
        default { return $false }
    }
}

function Test-McpConfigured {
    param([string]$Provider)
    $Files = switch ($Provider) {
        'cursor' { @('.cursor\\mcp.json') }
        'devin' { @('.config\\devin\\mcp_config.json') }
        'opencode' { @('.config\\opencode\\opencode.json', '.config\\opencode\\opencode.jsonc') }
        { $_ -in @('claude', 'claude-code') } { @('.claude.json') }
        'codex' { @('.codex\\config.toml') }
        default { @() }
    }
    foreach ($File in $Files) {
        $Path = Join-Path $HOME $File
        if ((Test-Path -LiteralPath $Path) -and (Select-String -LiteralPath $Path -Pattern 'shiori-brain' -SimpleMatch -Quiet)) { return $true }
    }
    return $false
}

function Get-ShioriInstallStatus {
    param([string]$Provider)
    $Parts = @()
    switch ($Provider) {
${psStatusSkillsSwitch()}
    }
    if ($Provider -in @(${psMcpList()}) -and (Test-McpConfigured $Provider)) { $Parts += 'MCP configured' }
    if ($Parts.Count -gt 0) { return 'installed (' + ($Parts -join ' + ') + ')' }
    if ($Provider -in @(${psKnownStatusList()})) { return 'not installed' }
    return 'unknown (no local status API)'
}

function Remove-LeftoverSkillTemps {
    param([string]$DestRoot)
    if (-not (Test-Path -LiteralPath $DestRoot)) { return }
    Get-ChildItem -LiteralPath $DestRoot -Force | Where-Object { $_.Name -like ($SkillLinkTempPrefix + '*') } | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
    }
}

function Sync-SkillsDest {
    param([string]$DestRoot, [string]$ManagedFile)
    $SourceRoot = Join-Path $ManagedCheckout 'skills'
    if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw \"Checkout has no skills directory: $ManagedCheckout\" }
    Assert-SkillsDest $DestRoot
    New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
    if (-not (Test-Path -LiteralPath $DestRoot) -and -not (Get-Item -LiteralPath $DestRoot -Force -ErrorAction SilentlyContinue)) {
        New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
    }
    Assert-SkillsDest $DestRoot
    Remove-LeftoverSkillTemps $DestRoot
    $SourceSkills = @(Get-ChildItem -LiteralPath $SourceRoot -Directory)
    $OldSkills = if (Test-Path -LiteralPath $ManagedFile) { @(Get-Content -LiteralPath $ManagedFile) } else { @() }
    foreach ($OldSkill in $OldSkills) {
        if (-not $OldSkill) { continue }
        $OldSource = Join-Path $SourceRoot $OldSkill
        $OldTarget = Join-Path $DestRoot $OldSkill
        $OldItem = Get-Item -LiteralPath $OldTarget -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $OldSource) -and (Test-ShioriSkillLink $OldItem $OldSource)) {
            Remove-Item -LiteralPath $OldTarget -Force
            $script:SkillsChanged = $true
        }
    }
    $LinkType = if ($env:OS -eq 'Windows_NT') { 'Junction' } else { 'SymbolicLink' }
    $ManagedNames = @()
    foreach ($SourceSkill in $SourceSkills) {
        $TargetPath = Join-Path $DestRoot $SourceSkill.Name
        $TargetItem = Get-Item -LiteralPath $TargetPath -Force -ErrorAction SilentlyContinue
        if ($TargetItem) {
            if (Test-ShioriSkillLink $TargetItem $SourceSkill.FullName) {
                $ManagedNames += $SourceSkill.Name
                continue
            }
            [Console]::Error.WriteLine(\"Warning: skipping skill $($SourceSkill.Name); $TargetPath already belongs to something else.\")
            continue
        }
        $TempPath = Join-Path $DestRoot ($SkillLinkTempPrefix + $SourceSkill.Name + '-' + $PID)
        New-Item -ItemType $LinkType -Path $TempPath -Target $SourceSkill.FullName | Out-Null
        Rename-Item -LiteralPath $TempPath -NewName $SourceSkill.Name
        $ManagedNames += $SourceSkill.Name
        $script:SkillsChanged = $true
    }
    $Utf8 = New-Object System.Text.UTF8Encoding $false
    $NextText = if ($ManagedNames.Count -gt 0) { ($ManagedNames -join [char]10) + [char]10 } else { '' }
    $PreviousText = if (Test-Path -LiteralPath $ManagedFile) { [IO.File]::ReadAllText($ManagedFile) } else { '' }
    $NormalizedPrevious = ($PreviousText -replace ([char]13 + [char]10), [char]10).Trim()
    $NormalizedNext = ($NextText -replace ([char]13 + [char]10), [char]10).Trim()
    if ($NormalizedPrevious -ne $NormalizedNext) {
        [IO.File]::WriteAllText($ManagedFile, $NextText, $Utf8)
        $script:SkillsChanged = $true
    }
    if ($script:Verbose) { Write-Host \"Shared Shiori skills linked from $ManagedCheckout into $DestRoot.\" }
}

function Sync-SharedSkills {
    Sync-SkillsDest -DestRoot $SkillsRoot -ManagedFile $ManagedSkillsFile
}

function Sync-ClaudeSkills {
    Sync-SkillsDest -DestRoot $ClaudeSkillsRoot -ManagedFile $ManagedClaudeSkillsFile
}

function Write-LegacyCodexPluginWarning {
    $ConfigFile = Join-Path $HOME '.codex/config.toml'
    if (-not (Test-Path -LiteralPath $ConfigFile)) { return }
    $Text = Get-Content -LiteralPath $ConfigFile -Raw
    $Needle = 'plugins.\"shiori@' + $Marketplace + '\"'
    if ($Text.Contains($Needle)) {
        [Console]::Error.WriteLine(\"Warning: Codex plugin shiori@$Marketplace duplicates skills now synced to ~/.agents/skills. Remove it with: codex plugin remove shiori@$Marketplace\")
    }
}

function Write-LegacyClaudePluginWarning {
    $ConfigFile = Join-Path $HOME '.claude/plugins/installed_plugins.json'
    if (-not (Test-Path -LiteralPath $ConfigFile)) { return }
    $Text = Get-Content -LiteralPath $ConfigFile -Raw
    if ($Text.Contains(\"shiori@$Marketplace\")) {
        [Console]::Error.WriteLine(\"Warning: Claude plugin shiori@$Marketplace duplicates skills now synced to ~/.claude/skills. Remove it with: claude plugin uninstall shiori@$Marketplace --scope user\")
    }
}

function Assert-PluginInstaller {
    param([string]$Target)
    switch ($Target) {
${psAssertSwitch()}
        default { throw \"No command-line installer is available for: $Target\" }
    }
}

function Write-DoctorUsage {
    Write-Host @"

How -Install and -Update work
  -Install [hosts]  set up the named hosts, or every locally detected host if none are named (use -Install all). Valid names: ${installableDoctorHostsInCliOrder().map(host => host.id).join(', ')}.
  -Update [hosts]   re-run the installer for the named hosts, or every currently detected host if none are named.
                    Recorded-but-missing hosts are not required. Capabilities added by a newer doctor are applied on update.
  -Verbose          print the status table, recipes, git, and MCP lines.
  -Help             print this usage text.
  Host names may be comma- or space-separated; SHIORI_INSTALL / SHIORI_UPDATE / SHIORI_VERBOSE are the pipe equivalents.

Recommended native setup
${psRecipes(repository)}

Full instructions: $GuideUrl
"@
}

function Get-DetectedHostLists {
    $Detected = @()
    $Missing = @()
    foreach ($Name in @(${allDoctorHostIds().map(id => `'${id}'`).join(', ')})) {
        if (Test-HostDetected $Name) { $Detected += $Name } else { $Missing += $Name }
    }
    return @{ Detected = $Detected; Missing = $Missing }
}

function Write-QuietReport {
    param([string[]]$Selected, [bool]$Failed)
    if (-not $script:CheckoutLine -and (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git'))) {
        $Sha = (& git -C $ManagedCheckout rev-parse HEAD | Out-String).Trim()
        $script:CheckoutLine = \"checkout: already up to date $Sha\"
    }
    if ($script:CheckoutLine) { Write-Output $script:CheckoutLine }
    $Lists = Get-DetectedHostLists
    $DetectedText = if ($Lists.Detected.Count -gt 0) { $Lists.Detected -join ', ' } else { 'none' }
    Write-Output \"detected: $DetectedText\"
    $AgentsHosts = @($Selected | Where-Object { $_ -in @(${agentsList}) })
    $ClaudeHosts = @($Selected | Where-Object { $_ -in @(${claudeList}) })
    if ($AgentsHosts.Count -gt 0) { Write-Output (\"$($AgentsHosts -join ', '): skills -> ${SKILL_DESTINATIONS.agents.display}\") }
    if ($ClaudeHosts.Count -gt 0) { Write-Output (\"$($ClaudeHosts -join ', '): skills -> ${SKILL_DESTINATIONS.claude.display}\") }
    foreach ($Target in $Selected) {
        switch ($Target) {
${psMcpDestSwitch()}
        }
    }
    if ($Failed -and -not $script:CheckoutChanged -and -not $script:SkillsChanged) { Write-Output 'skipped' }
    elseif (-not $script:CheckoutChanged -and -not $script:SkillsChanged) { Write-Output 'already current' }
    else { Write-Output 'updated' }
}

if ($Help) {
    Write-DoctorUsage
    return
}
if ($script:Verbose) {
    Write-Host 'Shiori agent doctor'
    Write-Host "Repository: $Repository"
    Write-Host "Mode: $Mode ($ProjectHint)"
    Write-Host ''
${psStatusRows()}
    Write-Host ''
    Write-Host 'MCP servers'
    Write-Host '  Installed under -Install / -Update for cursor, devin, opencode, claude, and codex. A read-only run does not launch host CLIs.'
    Write-DoctorUsage
}

function Split-HostNames {
    param([string[]]$Names)
    return @($Names | ForEach-Object { $_ -split '[, ]+' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
$Install = @(Split-HostNames $Install)
$UpdateTargets = @(Split-HostNames $UpdateTargets)
if ($env:SHIORI_INSTALL) { $Install += $env:SHIORI_INSTALL -split '[, ]+' }
$EnvironmentUpdate = @()
if ($env:SHIORI_UPDATE -and $env:SHIORI_UPDATE -notin @('1', 'true', 'all')) { $EnvironmentUpdate = @($env:SHIORI_UPDATE -split '[, ]+') }
if ($env:SHIORI_UPDATE) { $Update = $true }
if ($Install.Count -gt 0 -and $Update) { throw 'Choose either install or update.' }
$Operation = if ($Update) { 'update' } elseif ($Install.Count -gt 0) { 'install' } else { '' }
$Targets = if ($Operation -eq 'update') { @($UpdateTargets + $EnvironmentUpdate) } else { @($Install) }
$Targets = @(Split-HostNames $Targets | ForEach-Object { $_.ToLowerInvariant() } | Where-Object { $_ -ne 'all' } | ForEach-Object { Get-CanonicalHost $_ } | Select-Object -Unique)
if ($Operation -and $Targets.Count -eq 0) {
    $Targets = @(${installableDoctorHostsInCliOrder().map(host => `'${host.id}'`).join(', ')}) | Where-Object { Test-HostDetected $_ }
    if ($Targets.Count -eq 0) { throw 'No installable hosts detected. Pass a host name to -Install / -Update: ${names}.' }
}
if (-not $Operation -and -not $script:Verbose) {
    $Lists = Get-DetectedHostLists
    $DetectedText = if ($Lists.Detected.Count -gt 0) { $Lists.Detected -join ', ' } else { 'none' }
    $MissingText = if ($Lists.Missing.Count -gt 0) { $Lists.Missing -join ', ' } else { 'none' }
    Write-Output \"detected: $DetectedText\"
    Write-Output \"not detected: $MissingText\"
}
if ($Operation) {
    Assert-Home
    $SkipWindowsHosts = @(${psSkipWindowsList()})
    $KeptTargets = @()
    foreach ($Target in @($Targets)) {
        if ($SkipWindowsHosts.Count -gt 0 -and $Target -in $SkipWindowsHosts) {
            [Console]::Error.WriteLine(('Skipping ' + $Target + ': Windows support is not available.'))
            continue
        }
        $KeptTargets += $Target
    }
    $Targets = $KeptTargets
    if ($Targets.Count -eq 0) { return }
    $InstallFailed = $false
    $UsableTargets = @()
    foreach ($Target in $Targets) {
        try {
            Assert-PluginInstaller $Target
            $UsableTargets += $Target
        } catch {
            [Console]::Error.WriteLine(\"Warning: cannot install $Target; continuing with remaining hosts.\")
            [Console]::Error.WriteLine($_.Exception.Message)
            $InstallFailed = $true
        }
    }
    $Targets = $UsableTargets
    if ($Targets.Count -eq 0) { throw 'No remaining hosts could be installed.' }
    if ($script:Verbose) {
        Write-Host ''
        Write-Host \"Selected operation: $Operation\"
    }
    $AgentsSkillsSelected = @($Targets | Where-Object { $_ -in @(${agentsList}) }).Count -gt 0
    $ClaudeSkillsSelected = @($Targets | Where-Object { $_ -in @(${claudeList}) }).Count -gt 0
    $McpTargets = @($Targets | Where-Object { $_ -in @(${mcpList}) })
    if ($AgentsSkillsSelected -or $ClaudeSkillsSelected) {
        if ($Operation -eq 'update' -and -not (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git'))) { throw \"No managed checkout exists to update: $ManagedCheckout\" }
        Update-ManagedCheckout
    }
    if ($AgentsSkillsSelected) {
        Sync-SharedSkills
        if ($Targets -contains 'codex') { Write-LegacyCodexPluginWarning }
    }
    if ($ClaudeSkillsSelected) {
        Sync-ClaudeSkills
        if ($Targets -contains 'claude') { Write-LegacyClaudePluginWarning }
    }
    if ($McpTargets.Count -gt 0) {
        $McpScript = Join-Path $ManagedCheckout 'packages/shiori-brain-mcp/src/index.js'
        if (-not (Test-Path -LiteralPath $McpScript)) { Update-ManagedCheckout }
        if ($Operation -eq 'update' -and (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git'))) { Update-ManagedCheckout }
        if (-not (Test-Path -LiteralPath $McpScript)) { throw \"Shiori checkout is missing the MCP server: $McpScript\" }
    }
    foreach ($Target in $Targets) {
        switch (($Operation + ':' + $Target)) {
${psInstallSwitch()}
        }
    }
    if ($script:Verbose) {
        if (-not $script:CheckoutChanged -and -not $script:SkillsChanged) {
            Write-Host 'already current'
        }
    } else {
        Write-QuietReport -Selected $Targets -Failed $InstallFailed
    }
    if ($InstallFailed) { throw 'One or more hosts could not be installed.' }
}
`;
}
