const DEFAULT_REPOSITORY = 'Dragonshorn-Studios/shiori-brain';

export function installSupportFiles(config) {
  const repository = config.repository || DEFAULT_REPOSITORY;
  const marketplace = config.marketplaceName || 'shiori-knowledge';
  return new Map([
    ['AGENT-SETUP.md', renderGuide(repository, marketplace)],
    ['scripts/shiori-doctor.sh', renderShellDoctor(repository, marketplace)],
    ['scripts/shiori-doctor.ps1', renderPowerShellDoctor(repository, marketplace)]
  ]);
}

function renderGuide(repository, marketplace) {
  const rawBase = `https://raw.githubusercontent.com/${repository}/main`;
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

The doctor is read-only. It does not edit home-directory configuration or install plugins. When piped from GitHub it runs in remote mode and does not assume that this repository's project skill directories exist locally.

## Install from the command line

Only explicitly selected hosts are changed. Codex and Claude Code can expose complete non-interactive plugin installation commands, depending on the installed client version and account rollout. The doctor checks those exact subcommands before changing anything:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh -s -- --install codex claude
\`\`\`

\`\`\`powershell
$env:SHIORI_INSTALL='codex,claude'; irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

For a checked-out script, use \`sh scripts/shiori-doctor.sh --install codex claude\` or \`.\\scripts\\shiori-doctor.ps1 -Install codex,claude\`. Re-running an installer is safe: an existing marketplace or plugin is reported and skipped. If a CLI build or account does not expose plugin management, the selected installer stops with an explanation and makes no Shiori changes.

## Native setup matrix

| Host | Project use | Native reusable installation |
| --- | --- | --- |
| OpenCode | Automatic through \`.agents/skills\` | Add this checkout's \`skills\` directory to \`skills\` in \`opencode.json\`, or copy/link each skill to \`~/.config/opencode/skills\`. |
| Codex / ChatGPT desktop | Repository skills work through \`.agents/skills\` | Run \`codex plugin marketplace add ${repository}\`, then open \`/plugins\` and install **Shiori**. |
| Claude Code | Automatic through \`.claude/skills\` and \`.claude/agents\` | Run \`/plugin marketplace add ${repository}\`, then \`/plugin install shiori@${marketplace}\`. |
| ZCode | Install the generated plugin | Open **Settings -> Plugins -> Create -> Add marketplace**, enter \`${repository}\`, then install **Shiori**. |
| Cursor | Automatic through \`.cursor/skills\` | Open **Settings -> Plugins**, add \`https://github.com/${repository}\`, then install **Shiori**. |
| MCode / MiniMax Code | Automatic through \`.agents/skills\` in this checkout | For a reusable local plugin, find the local marketplace with \`mcode plugin marketplace list --json\`, copy \`plugins/shiori\` there, then run \`mcode plugin enable shiori@local\`. |
| Windsurf | Automatic through \`.windsurf/skills\` | Keep the generated project adapter; no marketplace step is required. |
| Vibe | Automatic through \`.vibe/skills\` | Keep the generated project adapter; no marketplace step is required. |
| Devin | Automatic through committed \`.devin/skills\` in repository sessions | Devin may be cloud-only, so absence of a local executable is not an error. Connect this repository to the Devin workspace. |

## What gets generated

- \`plugins/shiori/plugin.json\`: portable [Agent Plugins](https://agent-plugins.org/) manifest.
- \`plugins/shiori/.codex-plugin/plugin.json\`: Codex compatibility manifest.
- \`.agents/plugins/marketplace.json\`: native repository marketplace for Codex and ChatGPT desktop.
- Host-specific project skill directories, all generated from the same AFFiNE documents.

AFFiNE remains canonical. Do not edit generated skills, manifests, this guide, or the doctor scripts by hand; change Shiori and regenerate them.
`;
}

function renderShellDoctor(repository, marketplace) {
  return `#!/usr/bin/env sh
set -eu

repository=\"\${SHIORI_REPOSITORY:-${repository}}\"
marketplace=\"\${SHIORI_MARKETPLACE:-${marketplace}}\"
guide_url=\"https://github.com/$repository/blob/main/AGENT-SETUP.md\"
if [ -d '.agents/skills' ] && [ -d 'plugins/shiori' ]; then
  context='checkout'
  project_hint='project adapters are ready in this checkout'
else
  context='remote'
  project_hint='no Shiori checkout detected; use a marketplace installation below'
fi

has_command() { command -v \"$1\" >/dev/null 2>&1; }
has_home() { [ -e \"$HOME/$1\" ]; }
contains_text() {
  case $1 in
    *\"$2\"*) return 0 ;;
    *) return 1 ;;
  esac
}
install_codex() {
  has_command codex || { printf '%s\\n' 'Cannot install Codex plugin: codex CLI is not available.' >&2; return 1; }
  codex plugin marketplace add --help >/dev/null 2>&1 && codex plugin add --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot install Codex plugin: this CLI build or account does not expose plugin installation.' >&2; return 1; }
  codex_marketplaces=$(codex plugin marketplace list --json)
  if contains_text \"$codex_marketplaces\" \"$marketplace\"; then
    printf 'Codex marketplace %s is already configured.\\n' \"$marketplace\"
  else
    codex plugin marketplace add \"$repository\" --ref main --json
  fi
  codex_plugins=$(codex plugin list --json)
  if contains_text \"$codex_plugins\" \"shiori@$marketplace\"; then
    printf 'Codex plugin shiori@%s is already installed.\\n' \"$marketplace\"
  else
    codex plugin add \"shiori@$marketplace\" --json
  fi
}
install_claude() {
  has_command claude || { printf '%s\\n' 'Cannot install Claude plugin: claude CLI is not available.' >&2; return 1; }
  claude plugin marketplace add --help >/dev/null 2>&1 && claude plugin install --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot install Claude plugin: this CLI build or account does not expose plugin installation.' >&2; return 1; }
  claude_marketplaces=$(claude plugin marketplace list --json)
  if contains_text \"$claude_marketplaces\" \"$marketplace\"; then
    printf 'Claude marketplace %s is already configured.\\n' \"$marketplace\"
  else
    claude plugin marketplace add \"$repository\"
  fi
  claude_plugins=$(claude plugin list --json)
  if contains_text \"$claude_plugins\" \"shiori@$marketplace\"; then
    printf 'Claude plugin shiori@%s is already installed.\\n' \"$marketplace\"
  else
    claude plugin install --scope user --yes \"shiori@$marketplace\"
  fi
}
install_targets=\"\${SHIORI_INSTALL:-}\"
if [ \"$#\" -gt 0 ]; then
  [ \"$1\" = '--install' ] || { printf 'Unknown option: %s\\n' \"$1\" >&2; exit 2; }
  shift
  [ \"$#\" -gt 0 ] || { printf '%s\\n' 'Pass at least one installer: codex or claude.' >&2; exit 2; }
  install_targets=\"$*\"
fi
assert_installer() {
  case $1 in
    codex)
      has_command codex && codex plugin marketplace add --help >/dev/null 2>&1 && codex plugin add --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot install Codex plugin: this CLI build or account does not expose plugin installation.' >&2; return 1; }
      ;;
    claude|claude-code)
      has_command claude && claude plugin marketplace add --help >/dev/null 2>&1 && claude plugin install --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot install Claude plugin: this CLI build or account does not expose plugin installation.' >&2; return 1; }
      ;;
    *) printf 'No command-line installer is available for: %s\\n' \"$1\" >&2; return 1 ;;
  esac
}
row() {
  tool=$1
  command_name=$2
  home_path=$3
  mode=$4
  if has_command \"$command_name\"; then
    printf '%-18s detected (CLI: %s)\\n' \"$tool\" \"$(command -v \"$command_name\")\"
  elif [ -n \"$home_path\" ] && has_home \"$home_path\"; then
    printf '%-18s detected (configuration: ~/%s)\\n' \"$tool\" \"$home_path\"
  elif [ \"$mode\" = cloud ]; then
    printf '%-18s cloud-capable (local CLI not required)\\n' \"$tool\"
  else
    printf '%-18s not detected locally\\n' \"$tool\"
  fi
}

printf 'Shiori agent doctor\\nRepository: %s\\nMode: %s (%s)\\n\\n' \"$repository\" \"$context\" \"$project_hint\"
row 'OpenCode' opencode '.config/opencode' local
row 'Codex' codex '.codex' local
row 'Claude Code' claude '.claude' local
row 'ZCode' zcode '.zcode' local
row 'Cursor' cursor '.cursor' local
row 'MCode / MiniMax' mcode '.minimax' local
row 'Windsurf' windsurf '.windsurf' local
row 'Vibe' vibe '.vibe' local
row 'Devin' devin '.devin' cloud

printf '%s\\n' \\
  '' \\
  'Recommended native setup' \\
  \"  OpenCode: in a checkout it reads .agents/skills automatically. For global use, point opencode.json at a Shiori skills checkout or link it under ~/.config/opencode/skills.\" \\
  \"  Codex:    codex plugin marketplace add $repository ; then open /plugins and install Shiori.\" \\
  \"  Claude:   /plugin marketplace add $repository ; then /plugin install shiori@$marketplace.\" \\
  \"  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $repository; install Shiori.\" \\
  \"  Cursor:   Settings -> Plugins; add https://github.com/$repository; install Shiori.\" \\
  '  MCode:    in a checkout it reads .agents/skills automatically. For plugin install, inspect mcode plugin marketplace list --json and place plugins/shiori in its local marketplace.' \\
  '  Devin:    connect this repository to the cloud workspace; no local executable is required.' \\
  '' \\
  \"Full instructions: $guide_url\"

if [ -n \"$install_targets\" ]; then
  printf '%s\\n' '' 'Selected installations'
  previous_ifs=$IFS
  IFS=', '
  for install_target in $install_targets; do assert_installer \"$install_target\"; done
  for install_target in $install_targets; do
    case $install_target in
      codex) install_codex ;;
      claude|claude-code) install_claude ;;
      *) printf 'No command-line installer is available for: %s\\n' \"$install_target\" >&2; exit 2 ;;
    esac
  done
  IFS=$previous_ifs
fi
`;
}

function renderPowerShellDoctor(repository, marketplace) {
  return `# Generated by Shiori. Safe to run from a checkout or through irm | iex.
[CmdletBinding()]
param([string[]]$Install = @())

$Repository = if ($env:SHIORI_REPOSITORY) { $env:SHIORI_REPOSITORY } else { '${repository}' }
$Marketplace = if ($env:SHIORI_MARKETPLACE) { $env:SHIORI_MARKETPLACE } else { '${marketplace}' }
$GuideUrl = "https://github.com/$Repository/blob/main/AGENT-SETUP.md"
$LocalCheckout = (Test-Path -LiteralPath '.agents\\skills') -and (Test-Path -LiteralPath 'plugins\\shiori')
$Mode = if ($LocalCheckout) { 'checkout' } else { 'remote' }
$ProjectHint = if ($LocalCheckout) { 'project adapters are ready in this checkout' } else { 'no Shiori checkout detected; use a marketplace installation below' }

function Show-AgentStatus {
    param([string]$Name, [string]$Command, [string]$HomePath, [switch]$Cloud)
    $Executable = Get-Command $Command -ErrorAction SilentlyContinue
    $ConfigPath = if ($HomePath) { Join-Path $env:USERPROFILE $HomePath } else { $null }
    if ($Executable) {
        Write-Host ($Name.PadRight(18) + ' detected (CLI: ' + $Executable.Source + ')')
    } elseif ($ConfigPath -and (Test-Path -LiteralPath $ConfigPath)) {
        Write-Host ($Name.PadRight(18) + ' detected (configuration: ' + $ConfigPath + ')')
    } elseif ($Cloud) {
        Write-Host ($Name.PadRight(18) + ' cloud-capable (local CLI not required)')
    } else {
        Write-Host ($Name.PadRight(18) + ' not detected locally')
    }
}

function Assert-PluginInstaller {
    param([string]$Target)
    switch ($Target) {
        'codex' {
            if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw 'Cannot install Codex plugin: codex CLI is not available.' }
            & codex plugin marketplace add --help *> $null
            if ($LASTEXITCODE -ne 0) { throw 'Cannot install Codex plugin: this CLI build or account does not expose marketplace installation.' }
            & codex plugin add --help *> $null
            if ($LASTEXITCODE -ne 0) { throw 'Cannot install Codex plugin: this CLI build or account does not expose plugin installation.' }
        }
        'claude' {
            if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'Cannot install Claude plugin: claude CLI is not available.' }
            & claude plugin marketplace add --help *> $null
            if ($LASTEXITCODE -ne 0) { throw 'Cannot install Claude plugin: this CLI build or account does not expose marketplace installation.' }
            & claude plugin install --help *> $null
            if ($LASTEXITCODE -ne 0) { throw 'Cannot install Claude plugin: this CLI build or account does not expose plugin installation.' }
        }
        default { throw \"No command-line installer is available for: $Target\" }
    }
}

function Install-CodexPlugin {
    $RawMarketplaces = & codex plugin marketplace list --json | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read Codex marketplaces.' }
    $Marketplaces = $RawMarketplaces | ConvertFrom-Json
    if ($Marketplaces.marketplaces.name -contains $Marketplace) {
        Write-Host \"Codex marketplace $Marketplace is already configured.\"
    } else {
        & codex plugin marketplace add $Repository --ref main --json
        if ($LASTEXITCODE -ne 0) { throw 'Unable to add the Shiori Codex marketplace.' }
    }
    $RawPlugins = & codex plugin list --json | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read installed Codex plugins.' }
    $Plugins = $RawPlugins | ConvertFrom-Json
    if ($Plugins.installed.id -contains \"shiori@$Marketplace\") {
        Write-Host \"Codex plugin shiori@$Marketplace is already installed.\"
    } else {
        & codex plugin add \"shiori@$Marketplace\" --json
        if ($LASTEXITCODE -ne 0) { throw 'Unable to install the Shiori Codex plugin.' }
    }
}

function Install-ClaudePlugin {
    $RawMarketplaces = & claude plugin marketplace list --json | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read Claude marketplaces.' }
    $Marketplaces = $RawMarketplaces | ConvertFrom-Json
    if ($Marketplaces.name -contains $Marketplace) {
        Write-Host \"Claude marketplace $Marketplace is already configured.\"
    } else {
        & claude plugin marketplace add $Repository
        if ($LASTEXITCODE -ne 0) { throw 'Unable to add the Shiori Claude marketplace.' }
    }
    $RawPlugins = & claude plugin list --json | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read installed Claude plugins.' }
    $Plugins = $RawPlugins | ConvertFrom-Json
    if ($Plugins.id -contains \"shiori@$Marketplace\") {
        Write-Host \"Claude plugin shiori@$Marketplace is already installed.\"
    } else {
        & claude plugin install --scope user --yes \"shiori@$Marketplace\"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to install the Shiori Claude plugin.' }
    }
}

Write-Host 'Shiori agent doctor'
Write-Host "Repository: $Repository"
Write-Host "Mode: $Mode ($ProjectHint)"
Write-Host ''
Show-AgentStatus 'OpenCode' opencode '.config\\opencode'
Show-AgentStatus 'Codex' codex '.codex'
Show-AgentStatus 'Claude Code' claude '.claude'
Show-AgentStatus 'ZCode' zcode '.zcode'
Show-AgentStatus 'Cursor' cursor '.cursor'
Show-AgentStatus 'MCode / MiniMax' mcode '.minimax'
Show-AgentStatus 'Windsurf' windsurf '.windsurf'
Show-AgentStatus 'Vibe' vibe '.vibe'
Show-AgentStatus 'Devin' devin '.devin' -Cloud

Write-Host @"

Recommended native setup
  OpenCode: in a checkout it reads .agents/skills automatically. For global use, point opencode.json at a Shiori skills checkout or link it under ~/.config/opencode/skills.
  Codex:    codex plugin marketplace add $Repository ; then open /plugins and install Shiori.
  Claude:   /plugin marketplace add $Repository ; then /plugin install shiori@$Marketplace.
  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $Repository; install Shiori.
  Cursor:   Settings -> Plugins; add https://github.com/$Repository; install Shiori.
  MCode:    in a checkout it reads .agents/skills automatically. For plugin install, inspect mcode plugin marketplace list --json and place plugins/shiori in its local marketplace.
  Devin:    connect this repository to the cloud workspace; no local executable is required.

Full instructions: $GuideUrl
"@

if ($env:SHIORI_INSTALL) { $Install += $env:SHIORI_INSTALL -split '[, ]+' }
$Install = @($Install | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | ForEach-Object { if ($_ -eq 'claude-code') { 'claude' } else { $_ } } | Select-Object -Unique)
if ($Install.Count -gt 0) {
    foreach ($Target in $Install) { Assert-PluginInstaller $Target }
    Write-Host ''
    Write-Host 'Selected installations'
    foreach ($Target in $Install) {
        switch ($Target) {
            'codex' { Install-CodexPlugin }
            'claude' { Install-ClaudePlugin }
        }
    }
}
`;
}
