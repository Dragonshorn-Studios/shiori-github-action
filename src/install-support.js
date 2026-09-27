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

Only explicitly selected hosts are changed. OpenCode, MCode, and Vibe share one managed checkout at \`~/.local/share/shiori/shiori-brain\`; its skills are linked individually into the standard global \`~/.agents/skills\` directory. Codex and Claude Code use their plugin CLIs when the installed client version and account rollout expose them:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh -s -- --install opencode mcode vibe codex claude
\`\`\`

\`\`\`powershell
$env:SHIORI_INSTALL='opencode,mcode,vibe,codex,claude'; irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

For a checked-out script, use \`sh scripts/shiori-doctor.sh --install opencode mcode vibe\` or \`.\\scripts\\shiori-doctor.ps1 -Install opencode,mcode,vibe\`. Re-running install fast-forwards the managed checkout and reconciles skill links. Existing non-Shiori skill destinations are never overwritten.

## Update installed hosts

The installer records successful host selections. Update all recorded hosts without remembering the list:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh -s -- --update
\`\`\`

\`\`\`powershell
$env:SHIORI_UPDATE='all'; irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

Pass names after \`--update\`, or use PowerShell \`-Update -UpdateTargets opencode,mcode\`, to update only selected hosts. Checkout updates are always \`git pull --ff-only\`; an unexpected origin, dirty checkout, non-repository path, or conflicting skill destination stops the operation rather than deleting user data.

## Native setup matrix

| Host | Project use | Native reusable installation |
| --- | --- | --- |
| OpenCode | Automatic through \`.agents/skills\` | \`--install opencode\` uses the managed checkout and global Agent Skills links. |
| Codex / ChatGPT desktop | Repository skills work through \`.agents/skills\` | Run \`codex plugin marketplace add ${repository}\`, then open \`/plugins\` and install **Shiori**. |
| Claude Code | Automatic through \`.claude/skills\` and \`.claude/agents\` | Run \`/plugin marketplace add ${repository}\`, then \`/plugin install shiori@${marketplace}\`. |
| ZCode | Install the generated plugin | Open **Settings -> Plugins -> Create -> Add marketplace**, enter \`${repository}\`, then install **Shiori**. |
| Cursor | Automatic through \`.cursor/skills\` | Open **Settings -> Plugins**, add \`https://github.com/${repository}\`, then install **Shiori**. |
| MCode / MiniMax Code | Automatic through \`.agents/skills\` in this checkout | \`--install mcode\` uses the same managed checkout and global Agent Skills links. |
| Windsurf | Automatic through \`.windsurf/skills\` | Keep the generated project adapter; no marketplace step is required. |
| Vibe | Automatic through \`.vibe/skills\` | \`--install vibe\` uses the same managed checkout and global Agent Skills links. |
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
checkout=\"\${SHIORI_CHECKOUT:-$HOME/.local/share/shiori/shiori-brain}\"
state_root=\"\${SHIORI_STATE_HOME:-$HOME/.local/state/shiori}\"
skills_root=\"\${SHIORI_SKILLS_HOME:-$HOME/.agents/skills}\"
installed_hosts_file=\"$state_root/installed-hosts\"
managed_skills_file=\"$state_root/managed-skills\"
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
record_host() {
  mkdir -p \"$state_root\"
  if [ -f \"$installed_hosts_file\" ]; then
    while IFS= read -r recorded_host; do [ \"$recorded_host\" = \"$1\" ] && return 0; done < \"$installed_hosts_file\"
  fi
  printf '%s\\n' \"$1\" >> \"$installed_hosts_file\"
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
    git -C \"$checkout\" pull --ff-only origin main
  elif [ -e \"$checkout\" ] || [ -L \"$checkout\" ]; then
    printf 'Refusing to replace non-checkout path: %s\\n' \"$checkout\" >&2
    return 1
  else
    mkdir -p \"\${checkout%/*}\"
    git clone --filter=blob:none --branch main \"https://github.com/$repository.git\" \"$checkout\"
  fi
}
sync_shared_skills() {
  [ -d \"$checkout/skills\" ] || { printf 'Checkout has no skills directory: %s\\n' \"$checkout\" >&2; return 1; }
  has_command ln && has_command readlink && has_command rm && has_command mkdir && has_command mv || { printf '%s\\n' 'Cannot link skills: ln, readlink, rm, mkdir, and mv are required. On Windows use the PowerShell installer.' >&2; return 1; }
  mkdir -p \"$skills_root\" \"$state_root\"
  for source_skill in \"$checkout/skills\"/*; do
    [ -d \"$source_skill\" ] || continue
    skill_name=\${source_skill##*/}
    target_skill=\"$skills_root/$skill_name\"
    if [ -e \"$target_skill\" ] || [ -L \"$target_skill\" ]; then
      [ -L \"$target_skill\" ] && [ \"$(readlink \"$target_skill\")\" = \"$source_skill\" ] || { printf 'Skill destination already belongs to something else: %s\\n' \"$target_skill\" >&2; return 1; }
    fi
  done
  if [ -f \"$managed_skills_file\" ]; then
    while IFS= read -r old_skill; do
      [ -n \"$old_skill\" ] || continue
      old_target=\"$skills_root/$old_skill\"
      if [ ! -d \"$checkout/skills/$old_skill\" ] && [ -L \"$old_target\" ] && [ \"$(readlink \"$old_target\")\" = \"$checkout/skills/$old_skill\" ]; then
        rm \"$old_target\"
      fi
    done < \"$managed_skills_file\"
  fi
  next_managed=\"$managed_skills_file.next\"
  : > \"$next_managed\"
  for source_skill in \"$checkout/skills\"/*; do
    [ -d \"$source_skill\" ] || continue
    skill_name=\${source_skill##*/}
    target_skill=\"$skills_root/$skill_name\"
    if [ ! -L \"$target_skill\" ]; then ln -s \"$source_skill\" \"$target_skill\"; fi
    printf '%s\\n' \"$skill_name\" >> \"$next_managed\"
  done
  mv \"$next_managed\" \"$managed_skills_file\"
  printf 'Shared Shiori skills linked from %s into %s.\\n' \"$checkout\" \"$skills_root\"
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
  record_host codex
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
  record_host claude
}
update_codex() {
  codex plugin marketplace upgrade \"$marketplace\"
  record_host codex
}
update_claude() {
  claude plugin marketplace update \"$marketplace\"
  claude plugin update \"shiori@$marketplace\"
  record_host claude
}
operation=''
selected_targets=\"\${SHIORI_INSTALL:-}\"
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
if [ \"$operation\" = 'install' ] && [ -z \"$selected_targets\" ]; then
  printf '%s\\n' 'Pass at least one installer: opencode, mcode, vibe, codex, or claude.' >&2
  exit 2
fi
if [ \"$operation\" = 'update' ] && [ -z \"$selected_targets\" ]; then
  [ -f \"$installed_hosts_file\" ] || { printf '%s\\n' 'No recorded Shiori installations to update.' >&2; exit 2; }
  while IFS= read -r recorded_host; do selected_targets=\"$selected_targets $recorded_host\"; done < \"$installed_hosts_file\"
fi
assert_installer() {
  case $1 in
    opencode|mcode|vibe)
      has_command git && has_command ln && has_command readlink && has_command rm && has_command mkdir && has_command mv || { printf '%s\\n' 'Cannot install shared skills: git, ln, readlink, rm, mkdir, and mv are required. On Windows use the PowerShell installer.' >&2; return 1; }
      ;;
    codex)
      if [ \"$operation\" = update ]; then
        has_command codex && codex plugin marketplace upgrade --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot update Codex plugin: this CLI build does not expose marketplace upgrades.' >&2; return 1; }
      else
        has_command codex && codex plugin marketplace add --help >/dev/null 2>&1 && codex plugin add --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot install Codex plugin: this CLI build or account does not expose plugin installation.' >&2; return 1; }
      fi
      ;;
    claude|claude-code)
      if [ \"$operation\" = update ]; then
        has_command claude && claude plugin marketplace update --help >/dev/null 2>&1 && claude plugin update --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot update Claude plugin: this CLI build does not expose plugin updates.' >&2; return 1; }
      else
        has_command claude && claude plugin marketplace add --help >/dev/null 2>&1 && claude plugin install --help >/dev/null 2>&1 || { printf '%s\\n' 'Cannot install Claude plugin: this CLI build or account does not expose plugin installation.' >&2; return 1; }
      fi
      ;;
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

shared_skills_installed() {
  [ -d \"$checkout/.git\" ] && [ -s \"$managed_skills_file\" ] || return 1
  found_skill=false
  while IFS= read -r skill_name; do
    [ -n \"$skill_name\" ] || continue
    found_skill=true
    target_skill=\"$skills_root/$skill_name\"
    source_skill=\"$checkout/skills/$skill_name\"
    [ -L \"$target_skill\" ] && [ \"$(readlink \"$target_skill\")\" = \"$source_skill\" ] || return 1
  done < \"$managed_skills_file\"
  [ \"$found_skill\" = true ]
}

shiori_status() {
  case $1 in
    opencode|mcode|vibe)
      if shared_skills_installed; then printf '%s' 'installed (managed Agent Skills)'; else printf '%s' 'not installed'; fi
      ;;
    codex)
      if has_command codex && codex_plugins=$(codex plugin list --json 2>/dev/null); then
        if contains_text \"$codex_plugins\" \"shiori@$marketplace\"; then printf '%s' 'installed (native plugin)'; else printf '%s' 'not installed'; fi
      else
        printf '%s' 'unknown (plugin status unavailable)'
      fi
      ;;
    claude)
      if has_command claude && claude_plugins=$(claude plugin list --json 2>/dev/null); then
        if contains_text \"$claude_plugins\" \"shiori@$marketplace\"; then printf '%s' 'installed (native plugin)'; else printf '%s' 'not installed'; fi
      else
        printf '%s' 'unknown (plugin status unavailable)'
      fi
      ;;
    *) printf '%s' 'unknown (no local status API)' ;;
  esac
}

printf 'Shiori agent doctor\\nRepository: %s\\nMode: %s (%s)\\n\\n' \"$repository\" \"$context\" \"$project_hint\"
row 'OpenCode' opencode '.config/opencode' local opencode
row 'Codex' codex '.codex' local codex
row 'Claude Code' claude '.claude' local claude
row 'ZCode' zcode '.zcode' local zcode
row 'Cursor' cursor '.cursor' local cursor
row 'MCode / MiniMax' mcode '.minimax' local mcode
row 'Windsurf' windsurf '.windsurf' local windsurf
row 'Vibe' vibe '.vibe' local vibe
row 'Devin' devin '.devin' cloud devin

printf '%s\\n' \\
  '' \\
  'Recommended native setup' \\
  '  OpenCode: select --install opencode to clone/update Shiori and link its skills through ~/.agents/skills.' \\
  \"  Codex:    codex plugin marketplace add $repository ; then open /plugins and install Shiori.\" \\
  \"  Claude:   /plugin marketplace add $repository ; then /plugin install shiori@$marketplace.\" \\
  \"  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $repository; install Shiori.\" \\
  \"  Cursor:   Settings -> Plugins; add https://github.com/$repository; install Shiori.\" \\
  '  MCode:    select --install mcode to use the same managed checkout and global Agent Skills links.' \\
  '  Vibe:     select --install vibe to use the same managed checkout and global Agent Skills links.' \\
  '  Devin:    connect this repository to the cloud workspace; no local executable is required.' \\
  '' \\
  \"Full instructions: $guide_url\"

if [ -n \"$operation\" ]; then
  printf '%s\\n' '' \"Selected operation: $operation\"
  previous_ifs=$IFS
  IFS=', '
  shared_skills_selected='false'
  for selected_target in $selected_targets; do
    assert_installer \"$selected_target\"
    case $selected_target in opencode|mcode|vibe) shared_skills_selected='true' ;; esac
  done
  if [ \"$shared_skills_selected\" = true ]; then
    [ \"$operation\" != update ] || [ -d \"$checkout/.git\" ] || { printf 'No managed checkout exists to update: %s\\n' \"$checkout\" >&2; exit 2; }
    ensure_checkout
    sync_shared_skills
  fi
  for selected_target in $selected_targets; do
    case \"$operation:$selected_target\" in
      install:opencode|install:mcode|install:vibe|update:opencode|update:mcode|update:vibe) record_host \"$selected_target\" ;;
      install:codex) install_codex ;;
      install:claude|install:claude-code) install_claude ;;
      update:codex) update_codex ;;
      update:claude|update:claude-code) update_claude ;;
    esac
  done
  IFS=$previous_ifs
fi
`;
}

function renderPowerShellDoctor(repository, marketplace) {
  return `# Generated by Shiori. Safe to run from a checkout or through irm | iex.
[CmdletBinding()]
param(
    [string[]]$Install = @(),
    [switch]$Update,
    [string[]]$UpdateTargets = @()
)

$Repository = if ($env:SHIORI_REPOSITORY) { $env:SHIORI_REPOSITORY } else { '${repository}' }
$Marketplace = if ($env:SHIORI_MARKETPLACE) { $env:SHIORI_MARKETPLACE } else { '${marketplace}' }
$GuideUrl = "https://github.com/$Repository/blob/main/AGENT-SETUP.md"
$ManagedCheckout = if ($env:SHIORI_CHECKOUT) { $env:SHIORI_CHECKOUT } else { Join-Path $HOME '.local/share/shiori/shiori-brain' }
$StateRoot = if ($env:SHIORI_STATE_HOME) { $env:SHIORI_STATE_HOME } else { Join-Path $HOME '.local/state/shiori' }
$SkillsRoot = if ($env:SHIORI_SKILLS_HOME) { $env:SHIORI_SKILLS_HOME } else { Join-Path $HOME '.agents/skills' }
$InstalledHostsFile = Join-Path $StateRoot 'installed-hosts'
$ManagedSkillsFile = Join-Path $StateRoot 'managed-skills'
$LocalCheckout = (Test-Path -LiteralPath '.agents\\skills') -and (Test-Path -LiteralPath 'plugins\\shiori')
$Mode = if ($LocalCheckout) { 'checkout' } else { 'remote' }
$ProjectHint = if ($LocalCheckout) { 'project adapters are ready in this checkout' } else { 'no Shiori checkout detected; use a marketplace installation below' }

function Show-AgentStatus {
    param([string]$Name, [string]$Command, [string]$HomePath, [string]$Provider, [switch]$Cloud)
    $Executable = Get-Command $Command -ErrorAction SilentlyContinue
    $ConfigPath = if ($HomePath) { Join-Path $env:USERPROFILE $HomePath } else { $null }
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

function Add-RecordedHost {
    param([string]$Target)
    New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
    $Recorded = if (Test-Path -LiteralPath $InstalledHostsFile) { @(Get-Content -LiteralPath $InstalledHostsFile) } else { @() }
    if ($Recorded -notcontains $Target) { Add-Content -LiteralPath $InstalledHostsFile -Value $Target -Encoding utf8 }
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
        & git -C $ManagedCheckout pull --ff-only origin main
        if ($LASTEXITCODE -ne 0) { throw 'Unable to fast-forward the managed Shiori checkout.' }
    } elseif (Get-Item -LiteralPath $ManagedCheckout -Force -ErrorAction SilentlyContinue) {
        throw \"Refusing to replace non-checkout path: $ManagedCheckout\"
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ManagedCheckout) | Out-Null
        & git clone --filter=blob:none --branch main \"https://github.com/$Repository.git\" $ManagedCheckout
        if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the managed Shiori checkout.' }
    }
}

function Test-ShioriSkillLink {
    param($Item, [string]$ExpectedTarget)
    if (-not $Item -or $Item.LinkType -notin @('Junction', 'SymbolicLink')) { return $false }
    $ActualTarget = [IO.Path]::GetFullPath([string]@($Item.Target)[0])
    return $ActualTarget -eq [IO.Path]::GetFullPath($ExpectedTarget)
}

function Test-SharedSkillsInstalled {
    if (-not (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git')) -or -not (Test-Path -LiteralPath $ManagedSkillsFile)) { return $false }
    $SkillNames = @(Get-Content -LiteralPath $ManagedSkillsFile | Where-Object { $_ })
    if ($SkillNames.Count -eq 0) { return $false }
    foreach ($SkillName in $SkillNames) {
        $ExpectedTarget = Join-Path (Join-Path $ManagedCheckout 'skills') $SkillName
        $Item = Get-Item -LiteralPath (Join-Path $SkillsRoot $SkillName) -Force -ErrorAction SilentlyContinue
        if (-not (Test-ShioriSkillLink $Item $ExpectedTarget)) { return $false }
    }
    return $true
}

function Get-ShioriInstallStatus {
    param([string]$Provider)
    switch ($Provider) {
        { $_ -in @('opencode', 'mcode', 'vibe') } {
            if (Test-SharedSkillsInstalled) { return 'installed (managed Agent Skills)' }
            return 'not installed'
        }
        'codex' {
            if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { return 'unknown (plugin status unavailable)' }
            try {
                $RawPlugins = & codex plugin list --json 2>$null | Out-String
                if ($LASTEXITCODE -ne 0) { return 'unknown (plugin status unavailable)' }
                $Plugins = $RawPlugins | ConvertFrom-Json
                if ($Plugins.installed.id -contains \"shiori@$Marketplace\") { return 'installed (native plugin)' }
                return 'not installed'
            } catch { return 'unknown (plugin status unavailable)' }
        }
        'claude' {
            if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { return 'unknown (plugin status unavailable)' }
            try {
                $RawPlugins = & claude plugin list --json 2>$null | Out-String
                if ($LASTEXITCODE -ne 0) { return 'unknown (plugin status unavailable)' }
                $Plugins = $RawPlugins | ConvertFrom-Json
                if ($Plugins.id -contains \"shiori@$Marketplace\") { return 'installed (native plugin)' }
                return 'not installed'
            } catch { return 'unknown (plugin status unavailable)' }
        }
        default { return 'unknown (no local status API)' }
    }
}

function Sync-SharedSkills {
    $SourceRoot = Join-Path $ManagedCheckout 'skills'
    if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw \"Checkout has no skills directory: $ManagedCheckout\" }
    New-Item -ItemType Directory -Force -Path $SkillsRoot, $StateRoot | Out-Null
    $SourceSkills = @(Get-ChildItem -LiteralPath $SourceRoot -Directory)
    foreach ($SourceSkill in $SourceSkills) {
        $TargetPath = Join-Path $SkillsRoot $SourceSkill.Name
        $TargetItem = Get-Item -LiteralPath $TargetPath -Force -ErrorAction SilentlyContinue
        if ($TargetItem -and -not (Test-ShioriSkillLink $TargetItem $SourceSkill.FullName)) {
            throw \"Skill destination already belongs to something else: $TargetPath\"
        }
    }
    $OldSkills = if (Test-Path -LiteralPath $ManagedSkillsFile) { @(Get-Content -LiteralPath $ManagedSkillsFile) } else { @() }
    foreach ($OldSkill in $OldSkills) {
        if (-not $OldSkill) { continue }
        $OldSource = Join-Path $SourceRoot $OldSkill
        $OldTarget = Join-Path $SkillsRoot $OldSkill
        $OldItem = Get-Item -LiteralPath $OldTarget -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $OldSource) -and (Test-ShioriSkillLink $OldItem $OldSource)) {
            Remove-Item -LiteralPath $OldTarget -Force
        }
    }
    $LinkType = if ($env:OS -eq 'Windows_NT') { 'Junction' } else { 'SymbolicLink' }
    foreach ($SourceSkill in $SourceSkills) {
        $TargetPath = Join-Path $SkillsRoot $SourceSkill.Name
        if (-not (Get-Item -LiteralPath $TargetPath -Force -ErrorAction SilentlyContinue)) {
            New-Item -ItemType $LinkType -Path $TargetPath -Target $SourceSkill.FullName | Out-Null
        }
    }
    $SourceSkills.Name | Set-Content -LiteralPath $ManagedSkillsFile -Encoding utf8
    Write-Host \"Shared Shiori skills linked from $ManagedCheckout into $SkillsRoot.\"
}

function Assert-PluginInstaller {
    param([string]$Target)
    switch ($Target) {
        { $_ -in @('opencode', 'mcode', 'vibe') } {
            if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Cannot install shared skills: git is not available.' }
        }
        'codex' {
            if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw 'Cannot install Codex plugin: codex CLI is not available.' }
            if ($Operation -eq 'update') {
                & codex plugin marketplace upgrade --help *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot update Codex plugin: this CLI build does not expose marketplace upgrades.' }
            } else {
                & codex plugin marketplace add --help *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot install Codex plugin: this CLI build or account does not expose marketplace installation.' }
                & codex plugin add --help *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot install Codex plugin: this CLI build or account does not expose plugin installation.' }
            }
        }
        'claude' {
            if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'Cannot install Claude plugin: claude CLI is not available.' }
            if ($Operation -eq 'update') {
                & claude plugin marketplace update --help *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot update Claude plugin: this CLI build does not expose marketplace updates.' }
                & claude plugin update --help *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot update Claude plugin: this CLI build does not expose plugin updates.' }
            } else {
                & claude plugin marketplace add --help *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot install Claude plugin: this CLI build or account does not expose marketplace installation.' }
                & claude plugin install --help *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot install Claude plugin: this CLI build or account does not expose plugin installation.' }
            }
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
    Add-RecordedHost codex
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
    Add-RecordedHost claude
}

function Update-CodexPlugin {
    & codex plugin marketplace upgrade $Marketplace
    if ($LASTEXITCODE -ne 0) { throw 'Unable to update the Shiori Codex marketplace.' }
    Add-RecordedHost codex
}

function Update-ClaudePlugin {
    & claude plugin marketplace update $Marketplace
    if ($LASTEXITCODE -ne 0) { throw 'Unable to update the Shiori Claude marketplace.' }
    & claude plugin update \"shiori@$Marketplace\"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to update the Shiori Claude plugin.' }
    Add-RecordedHost claude
}

Write-Host 'Shiori agent doctor'
Write-Host "Repository: $Repository"
Write-Host "Mode: $Mode ($ProjectHint)"
Write-Host ''
Show-AgentStatus 'OpenCode' opencode '.config\\opencode' opencode
Show-AgentStatus 'Codex' codex '.codex' codex
Show-AgentStatus 'Claude Code' claude '.claude' claude
Show-AgentStatus 'ZCode' zcode '.zcode' zcode
Show-AgentStatus 'Cursor' cursor '.cursor' cursor
Show-AgentStatus 'MCode / MiniMax' mcode '.minimax' mcode
Show-AgentStatus 'Windsurf' windsurf '.windsurf' windsurf
Show-AgentStatus 'Vibe' vibe '.vibe' vibe
Show-AgentStatus 'Devin' devin '.devin' devin -Cloud

Write-Host @"

Recommended native setup
  OpenCode: select -Install opencode to clone/update Shiori and link its skills through ~/.agents/skills.
  Codex:    codex plugin marketplace add $Repository ; then open /plugins and install Shiori.
  Claude:   /plugin marketplace add $Repository ; then /plugin install shiori@$Marketplace.
  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $Repository; install Shiori.
  Cursor:   Settings -> Plugins; add https://github.com/$Repository; install Shiori.
  MCode:    select -Install mcode to use the same managed checkout and global Agent Skills links.
  Vibe:     select -Install vibe to use the same managed checkout and global Agent Skills links.
  Devin:    connect this repository to the cloud workspace; no local executable is required.

Full instructions: $GuideUrl
"@

if ($env:SHIORI_INSTALL) { $Install += $env:SHIORI_INSTALL -split '[, ]+' }
$EnvironmentUpdate = @()
if ($env:SHIORI_UPDATE -and $env:SHIORI_UPDATE -notin @('1', 'true', 'all')) { $EnvironmentUpdate = @($env:SHIORI_UPDATE -split '[, ]+') }
if ($env:SHIORI_UPDATE) { $Update = $true }
if ($Install.Count -gt 0 -and $Update) { throw 'Choose either install or update.' }
$Operation = if ($Update) { 'update' } elseif ($Install.Count -gt 0) { 'install' } else { '' }
$Targets = if ($Operation -eq 'update') { @($UpdateTargets + $EnvironmentUpdate) } else { @($Install) }
if ($Operation -eq 'update' -and $Targets.Count -eq 0) {
    if (-not (Test-Path -LiteralPath $InstalledHostsFile)) { throw 'No recorded Shiori installations to update.' }
    $Targets = @(Get-Content -LiteralPath $InstalledHostsFile)
}
$Targets = @($Targets | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | ForEach-Object { if ($_ -eq 'claude-code') { 'claude' } else { $_ } } | Select-Object -Unique)
if ($Operation -eq 'install' -and $Targets.Count -eq 0) { throw 'Pass at least one installer: opencode, mcode, vibe, codex, or claude.' }
if ($Operation) {
    foreach ($Target in $Targets) { Assert-PluginInstaller $Target }
    Write-Host ''
    Write-Host \"Selected operation: $Operation\"
    $SharedTargets = @($Targets | Where-Object { $_ -in @('opencode', 'mcode', 'vibe') })
    if ($SharedTargets.Count -gt 0) {
        if ($Operation -eq 'update' -and -not (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git'))) { throw \"No managed checkout exists to update: $ManagedCheckout\" }
        Update-ManagedCheckout
        Sync-SharedSkills
    }
    foreach ($Target in $Targets) {
        switch (($Operation + ':' + $Target)) {
            { $_ -in @('install:opencode', 'install:mcode', 'install:vibe', 'update:opencode', 'update:mcode', 'update:vibe') } { Add-RecordedHost $Target }
            'install:codex' { Install-CodexPlugin }
            'install:claude' { Install-ClaudePlugin }
            'update:codex' { Update-CodexPlugin }
            'update:claude' { Update-ClaudePlugin }
        }
    }
}
`;
}
