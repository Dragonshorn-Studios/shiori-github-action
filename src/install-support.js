import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubPagesUrl, renderMcpMarkdownTable } from './mcp-config.js';

const DEFAULT_REPOSITORY = 'Dragonshorn-Studios/shiori-brain';

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

Only explicitly selected hosts are changed. OpenCode, MCode, and Vibe share one managed checkout at \`~/.local/share/shiori/shiori-brain\`; its skills are linked individually into the standard global \`~/.agents/skills\` directory. Codex and Claude Code use their plugin CLIs when the installed client version and account rollout expose them. Cursor, Devin, OpenCode, Claude Code, and Codex also receive MCP config under \`--install\` / \`--update\`:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh -s -- --install opencode mcode vibe codex claude cursor devin
\`\`\`

\`\`\`powershell
$env:SHIORI_INSTALL='opencode,mcode,vibe,codex,claude,cursor,devin'; irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

For a checked-out script, use \`sh scripts/shiori-doctor.sh --install opencode mcode vibe\` or \`.\\scripts\\shiori-doctor.ps1 -Install opencode,mcode,vibe\`. Re-running install fast-forwards the managed checkout and reconciles skill links. Existing non-Shiori skill destinations are never overwritten.

Valid host names: \`opencode\`, \`mcode\`, \`vibe\`, \`codex\`, \`claude\` (or \`claude-code\`), \`cursor\`, and \`devin\`. What each one does:

| Host | \`--install\` effect |
| --- | --- |
| opencode | Managed checkout + Agent Skills links + MCP config in \`~/.config/opencode/opencode.json\` |
| mcode, vibe | Managed checkout + Agent Skills links |
| codex | Plugin marketplace + plugin + MCP via \`codex mcp add\` |
| claude | Plugin marketplace + plugin + MCP via \`claude mcp add -s user\` |
| cursor | MCP config in \`~/.cursor/mcp.json\` |
| devin | MCP config in \`~/.config/devin/mcp_config.json\` |

## Update installed hosts

\`--install\` records each host it successfully sets up in \`~/.local/state/shiori/installed-hosts\`. \`--update\` re-runs the current doctor against those recorded hosts, including capabilities added after the original install. For example, a host installed before MCP support existed receives its MCP config on the next update. Update all recorded hosts without remembering the list:

\`\`\`bash
curl -fsSL ${rawBase}/scripts/shiori-doctor.sh | sh -s -- --update
\`\`\`

\`\`\`powershell
$env:SHIORI_UPDATE='all'; irm ${rawBase}/scripts/shiori-doctor.ps1 | iex
\`\`\`

Pass names after \`--update\`, or use PowerShell \`-Update -UpdateTargets opencode,mcode\`, to update only selected hosts. A bare \`--update\` also prints locally detected hosts that were never recorded, so newly installed tools are easy to pick up. Checkout updates are always \`git pull --ff-only\`; an unexpected origin, dirty checkout, non-repository path, or conflicting skill destination stops the operation rather than deleting user data.

## Native setup matrix

| Host | Project use | Native reusable installation |
| --- | --- | --- |
| OpenCode | Automatic through \`.agents/skills\` | \`--install opencode\` uses the managed checkout and global Agent Skills links, and writes MCP config to \`~/.config/opencode/opencode.json\`. |
| Codex / ChatGPT desktop | Repository skills work through \`.agents/skills\` | Run \`codex plugin marketplace add ${repository}\`, then open \`/plugins\` and install **Shiori**. |
| Claude Code | Automatic through \`.claude/skills\` and \`.claude/agents\` | Run \`/plugin marketplace add ${repository}\`, then \`/plugin install shiori@${marketplace}\`. |
| ZCode | Install the generated plugin | Open **Settings -> Plugins -> Create -> Add marketplace**, enter \`${repository}\`, then install **Shiori**. |
| Cursor | Automatic through \`.cursor/skills\` | Open **Settings -> Plugins**, add \`https://github.com/${repository}\`, then install **Shiori**. \`--install cursor\` writes MCP config only. |
| MCode / MiniMax Code | Automatic through \`.agents/skills\` in this checkout | \`--install mcode\` uses the same managed checkout and global Agent Skills links. |
| Windsurf | Automatic through \`.windsurf/skills\` | Keep the generated project adapter; no marketplace step is required. |
| Vibe | Automatic through \`.vibe/skills\` | \`--install vibe\` uses the same managed checkout and global Agent Skills links. |
| Devin | Automatic through committed \`.devin/skills\` in repository sessions | Devin may be cloud-only, so absence of a local executable is not an error. Connect this repository to the Devin workspace. \`--install devin\` writes user-scope MCP config to \`~/.config/devin/mcp_config.json\`. |

## MCP servers

The doctor can add a local stdio MCP client for the published Pages archive, plus Storytold Craft CLIs that are already on \`PATH\`. Default doctor mode is still read-only and does not launch Claude or Codex. MCP writes happen only under \`--install\` / \`--update\`: Cursor via \`~/.cursor/mcp.json\`, Devin via \`~/.config/devin/mcp_config.json\`, OpenCode via \`~/.config/opencode/opencode.json\` (\`mcp.servers\`; an existing \`opencode.jsonc\` is used instead when present), Claude Code via \`claude mcp add -s user\`, and Codex via \`codex mcp add\`. The shiori-brain server is \`node <checkout>/packages/shiori-brain-mcp/src/index.js\` from the managed checkout; it is not loaded from a package registry. Installed entries set \`SHIORI_BRAIN_BASE_URL\` to this project's Pages origin (\`${archiveUrl || 'https://<owner>.github.io/<repo>/'}\`). Override with \`SHIORI_BRAIN_BASE_URL\` if Pages uses a custom domain. The installer fails instead of using another project's archive when that URL cannot be determined. Existing non-Shiori MCP entries are never overwritten.

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
  return `#!/usr/bin/env sh
set -eu

repository=\"\${SHIORI_REPOSITORY:-${repository}}\"
marketplace=\"\${SHIORI_MARKETPLACE:-${marketplace}}\"
default_archive_url='${archiveUrl}'
guide_url=\"https://github.com/$repository/blob/main/AGENT-SETUP.md\"
checkout=\"\${SHIORI_CHECKOUT:-$HOME/.local/share/shiori/shiori-brain}\"
state_root=\"\${SHIORI_STATE_HOME:-$HOME/.local/state/shiori}\"
skills_root=\"\${SHIORI_SKILLS_HOME:-$HOME/.agents/skills}\"
installed_hosts_file=\"$state_root/installed-hosts\"
managed_skills_file=\"$state_root/managed-skills\"
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
  has_command node || { printf '%s\\n' 'Skipping MCP config: node is not available.'; return 0; }
  helper=$(resolve_mcp_helper) || return 1
  pages_origin=$(archive_url) || pages_origin=''
  [ -n \"$pages_origin\" ] || { printf '%s\\n' 'Set SHIORI_BRAIN_BASE_URL to the published Pages origin before installing MCP servers. The installer will not fall back to another project archive.' >&2; return 1; }
  is_allowed_archive_url \"$pages_origin\" || { printf '%s\\n' 'SHIORI_BRAIN_BASE_URL must be an https URL (http is allowed only for localhost).' >&2; return 1; }
  node \"$helper\" \"$@\" --home \"$HOME\" --checkout \"$checkout\" --base-url \"$pages_origin\"
}
contains_text() {
  case $1 in
    *\"$2\"*) return 0 ;;
    *) return 1 ;;
  esac
}
host_detected() {
  case $1 in
    opencode) has_command opencode || has_home '.config/opencode' ;;
    mcode) has_command mcode || has_home '.minimax' ;;
    vibe) has_command vibe || has_home '.vibe' ;;
    codex) has_command codex || has_home '.codex' ;;
    claude|claude-code) has_command claude || has_home '.claude' ;;
    cursor) has_command cursor || has_home '.cursor' ;;
    devin) has_command devin || has_home '.config/devin' || has_home '.devin' ;;
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
  printf '%s\\n' 'Pass at least one installer: opencode, mcode, vibe, codex, claude, cursor, or devin.' >&2
  exit 2
fi
if [ \"$operation\" = 'update' ] && [ -z \"$selected_targets\" ]; then
  [ -f \"$installed_hosts_file\" ] || { printf '%s\\n' 'No recorded Shiori installations to update.' >&2; exit 2; }
  while IFS= read -r recorded_host; do selected_targets=\"$selected_targets $recorded_host\"; done < \"$installed_hosts_file\"
  detected_hints=''
  for candidate in opencode mcode vibe codex claude cursor devin; do
    case \" $selected_targets \" in *\" $candidate \"*) continue ;; esac
    host_is_recorded \"$candidate\" && continue
    host_detected \"$candidate\" && detected_hints=\"$detected_hints $candidate\"
  done
  [ -z \"$detected_hints\" ] || printf 'Detected locally but not recorded:%s - pass them to --install or --update to enable their features.\\n' \"$detected_hints\"
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
    cursor)
      has_command node || { printf '%s\\n' 'Cannot install Cursor MCP: node is not available.' >&2; return 1; }
      ;;
    devin)
      has_command node || { printf '%s\\n' 'Cannot install Devin MCP: node is not available.' >&2; return 1; }
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
    opencode|mcode|vibe)
      shared_skills_installed && parts='managed Agent Skills'
      ;;
    codex)
      host_is_recorded codex && parts='recorded native plugin'
      ;;
    claude)
      host_is_recorded claude && parts='recorded native plugin'
      ;;
  esac
  case $1 in
    opencode|cursor|devin|claude|codex)
      mcp_configured \"$1\" && parts=\"\${parts:+$parts + }MCP configured\"
      ;;
  esac
  if [ -n \"$parts\" ]; then
    printf 'installed (%s)' \"$parts\"
    return
  fi
  case $1 in
    opencode|mcode|vibe|cursor|devin) printf '%s' 'not installed' ;;
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
row 'Devin' devin '.config/devin' cloud devin

printf '%s\\n' '' 'MCP servers' '  Installed under --install / --update for cursor, devin, opencode, claude, and codex. A read-only run does not launch host CLIs.'

printf '%s\\n' \\
  '' \\
  'How --install and --update work' \\
  '  --install <hosts>  set up the named hosts now. Valid names: opencode, mcode, vibe, codex, claude, cursor, devin.' \\
  '  --update [hosts]   re-run the installer for every host recorded by an earlier --install, or only the named' \\
  '                     hosts. Capabilities added by a newer doctor (for example MCP config) are applied on update.' \\
  '  Host names may be space- or comma-separated; SHIORI_INSTALL / SHIORI_UPDATE are the pipe equivalents.' \\
  '' \\
  'Recommended native setup' \\
  '  OpenCode: --install opencode links skills through ~/.agents/skills and writes MCP config.' \\
  \"  Codex:    codex plugin marketplace add $repository ; then open /plugins and install Shiori. --install codex also writes MCP config.\" \\
  \"  Claude:   /plugin marketplace add $repository ; then /plugin install shiori@$marketplace. --install claude also writes MCP config.\" \\
  \"  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $repository; install Shiori.\" \\
  \"  Cursor:   Settings -> Plugins; add https://github.com/$repository; install Shiori. --install cursor writes MCP config.\" \\
  '  MCode:    select --install mcode to use the same managed checkout and global Agent Skills links.' \\
  '  Vibe:     select --install vibe to use the same managed checkout and global Agent Skills links.' \\
  '  Devin:    --install devin writes user-scope MCP config; the cloud workspace needs no local CLI.' \\
  '' \\
  \"Full instructions: $guide_url\"

if [ -n \"$operation\" ]; then
  printf '%s\\n' '' \"Selected operation: $operation\"
  previous_ifs=$IFS
  IFS=', '
  shared_skills_selected='false'
  mcp_selected='false'
  for selected_target in $selected_targets; do
    assert_installer \"$selected_target\"
    case $selected_target in opencode|mcode|vibe) shared_skills_selected='true' ;; esac
    case $selected_target in cursor|claude|claude-code|codex|opencode|devin) mcp_selected='true' ;; esac
  done
  if [ \"$shared_skills_selected\" = true ]; then
    [ \"$operation\" != update ] || [ -d \"$checkout/.git\" ] || { printf 'No managed checkout exists to update: %s\\n' \"$checkout\" >&2; exit 2; }
    ensure_checkout
    sync_shared_skills
  fi
  if [ \"$mcp_selected\" = true ]; then
    mcp_script=\"$checkout/packages/shiori-brain-mcp/src/index.js\"
    if [ ! -f \"$mcp_script\" ]; then ensure_checkout; fi
    if [ \"$operation\" = update ] && [ -d \"$checkout/.git\" ]; then ensure_checkout; fi
    [ -f \"$mcp_script\" ] || { printf 'Shiori checkout is missing the MCP server: %s\\n' \"$mcp_script\" >&2; exit 1; }
  fi
  for selected_target in $selected_targets; do
    case \"$operation:$selected_target\" in
      install:opencode|update:opencode) record_host opencode; run_mcp_cli install --host opencode ;;
      install:mcode|install:vibe|update:mcode|update:vibe) record_host \"$selected_target\" ;;
      install:codex) install_codex; run_mcp_cli install --host codex ;;
      install:claude|install:claude-code) install_claude; run_mcp_cli install --host claude ;;
      install:cursor|update:cursor) run_mcp_cli install --host cursor; record_host cursor ;;
      install:devin|update:devin) run_mcp_cli install --host devin; record_host devin ;;
      update:codex) update_codex; run_mcp_cli install --host codex ;;
      update:claude|update:claude-code) update_claude; run_mcp_cli install --host claude ;;
    esac
  done
  IFS=$previous_ifs
fi
`;
}

function renderPowerShellDoctor(repository, marketplace, archiveUrl) {
  return `# Generated by Shiori. Safe to run from a checkout or through irm | iex.
[CmdletBinding()]
param(
    [string[]]$Install = @(),
    [switch]$Update,
    [string[]]$UpdateTargets = @()
)

$Repository = if ($env:SHIORI_REPOSITORY) { $env:SHIORI_REPOSITORY } else { '${repository}' }
$Marketplace = if ($env:SHIORI_MARKETPLACE) { $env:SHIORI_MARKETPLACE } else { '${marketplace}' }
$DefaultArchiveUrl = '${archiveUrl}'
$GuideUrl = "https://github.com/$Repository/blob/main/AGENT-SETUP.md"
$ManagedCheckout = if ($env:SHIORI_CHECKOUT) { $env:SHIORI_CHECKOUT } else { Join-Path $HOME '.local/share/shiori/shiori-brain' }
$StateRoot = if ($env:SHIORI_STATE_HOME) { $env:SHIORI_STATE_HOME } else { Join-Path $HOME '.local/state/shiori' }
$SkillsRoot = if ($env:SHIORI_SKILLS_HOME) { $env:SHIORI_SKILLS_HOME } else { Join-Path $HOME '.agents/skills' }
$InstalledHostsFile = Join-Path $StateRoot 'installed-hosts'
$ManagedSkillsFile = Join-Path $StateRoot 'managed-skills'
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
        Write-Host 'Skipping MCP config: node is not available.'
        return
    }
    $ArchiveUrl = Get-ShioriArchiveUrl
    if (-not $ArchiveUrl) { throw 'Set SHIORI_BRAIN_BASE_URL to the published Pages origin before installing MCP servers. The installer will not fall back to another project''s archive.' }
    if (-not (Test-ShioriArchiveUrl $ArchiveUrl)) { throw 'SHIORI_BRAIN_BASE_URL must be an https URL (http is allowed only for localhost).' }
    $Helper = Get-McpHelper
    & node $Helper @McpArgs --home $HOME --checkout $ManagedCheckout --base-url $ArchiveUrl
    if ($LASTEXITCODE -ne 0) { throw \"Shiori MCP helper failed with exit code $LASTEXITCODE\" }
}

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

function Test-RecordedHost {
    param([string]$Target)
    if (-not (Test-Path -LiteralPath $InstalledHostsFile)) { return $false }
    return @(Get-Content -LiteralPath $InstalledHostsFile) -contains $Target
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

function Test-HostDetected {
    param([string]$Target)
    switch ($Target) {
        'opencode' { return ((Get-Command opencode -ErrorAction SilentlyContinue) -ne $null) -or (Test-Path -LiteralPath (Join-Path $HOME '.config\\opencode')) }
        'mcode' { return ((Get-Command mcode -ErrorAction SilentlyContinue) -ne $null) -or (Test-Path -LiteralPath (Join-Path $HOME '.minimax')) }
        'vibe' { return ((Get-Command vibe -ErrorAction SilentlyContinue) -ne $null) -or (Test-Path -LiteralPath (Join-Path $HOME '.vibe')) }
        'codex' { return ((Get-Command codex -ErrorAction SilentlyContinue) -ne $null) -or (Test-Path -LiteralPath (Join-Path $HOME '.codex')) }
        { $_ -in @('claude', 'claude-code') } { return ((Get-Command claude -ErrorAction SilentlyContinue) -ne $null) -or (Test-Path -LiteralPath (Join-Path $HOME '.claude')) }
        'cursor' { return ((Get-Command cursor -ErrorAction SilentlyContinue) -ne $null) -or (Test-Path -LiteralPath (Join-Path $HOME '.cursor')) }
        'devin' { return ((Get-Command devin -ErrorAction SilentlyContinue) -ne $null) -or (Test-Path -LiteralPath (Join-Path $HOME '.config\\devin')) -or (Test-Path -LiteralPath (Join-Path $HOME '.devin')) }
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
        { $_ -in @('opencode', 'mcode', 'vibe') } {
            if (Test-SharedSkillsInstalled) { $Parts += 'managed Agent Skills' }
        }
        'codex' {
            if (Test-RecordedHost codex) { $Parts += 'recorded native plugin' }
        }
        'claude' {
            if (Test-RecordedHost claude) { $Parts += 'recorded native plugin' }
        }
    }
    if ($Provider -in @('opencode', 'cursor', 'devin', 'claude', 'codex') -and (Test-McpConfigured $Provider)) { $Parts += 'MCP configured' }
    if ($Parts.Count -gt 0) { return 'installed (' + ($Parts -join ' + ') + ')' }
    if ($Provider -in @('opencode', 'mcode', 'vibe', 'cursor', 'devin')) { return 'not installed' }
    return 'unknown (no local status API)'
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
        'cursor' {
            if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Cannot install Cursor MCP: node is not available.' }
        }
        'devin' {
            if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Cannot install Devin MCP: node is not available.' }
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
Show-AgentStatus 'Devin' devin '.config\\devin' devin -Cloud

Write-Host ''
Write-Host 'MCP servers'
Write-Host '  Installed under -Install / -Update for cursor, devin, opencode, claude, and codex. A read-only run does not launch host CLIs.'

Write-Host @"

How -Install and -Update work
  -Install <hosts>  set up the named hosts now. Valid names: opencode, mcode, vibe, codex, claude, cursor, devin.
  -Update [hosts]   re-run the installer for every host recorded by an earlier -Install, or only the hosts
                    passed through -UpdateTargets or SHIORI_UPDATE. Capabilities added by a newer doctor
                    (for example MCP config) are applied on update.
  Host names may be comma- or space-separated; SHIORI_INSTALL / SHIORI_UPDATE are the pipe equivalents.

Recommended native setup
  OpenCode: select -Install opencode to link skills through ~/.agents/skills and write MCP config.
  Codex:    codex plugin marketplace add $Repository ; then open /plugins and install Shiori. -Install codex also writes MCP config.
  Claude:   /plugin marketplace add $Repository ; then /plugin install shiori@$Marketplace. -Install claude also writes MCP config.
  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $Repository; install Shiori.
  Cursor:   Settings -> Plugins; add https://github.com/$Repository; install Shiori. -Install cursor writes MCP config.
  MCode:    select -Install mcode to use the same managed checkout and global Agent Skills links.
  Vibe:     select -Install vibe to use the same managed checkout and global Agent Skills links.
  Devin:    -Install devin writes user-scope MCP config; the cloud workspace needs no local CLI.

Full instructions: $GuideUrl
"@

if ($env:SHIORI_INSTALL) { $Install += $env:SHIORI_INSTALL -split '[, ]+' }
$EnvironmentUpdate = @()
if ($env:SHIORI_UPDATE -and $env:SHIORI_UPDATE -notin @('1', 'true', 'all')) { $EnvironmentUpdate = @($env:SHIORI_UPDATE -split '[, ]+') }
if ($env:SHIORI_UPDATE) { $Update = $true }
if ($Install.Count -gt 0 -and $Update) { throw 'Choose either install or update.' }
$Operation = if ($Update) { 'update' } elseif ($Install.Count -gt 0) { 'install' } else { '' }
$Targets = if ($Operation -eq 'update') { @($UpdateTargets + $EnvironmentUpdate) } else { @($Install) }
$UpdateFromRecorded = $false
if ($Operation -eq 'update' -and $Targets.Count -eq 0) {
    if (-not (Test-Path -LiteralPath $InstalledHostsFile)) { throw 'No recorded Shiori installations to update.' }
    $Targets = @(Get-Content -LiteralPath $InstalledHostsFile)
    $UpdateFromRecorded = $true
}
$Targets = @($Targets | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | ForEach-Object { if ($_ -eq 'claude-code') { 'claude' } else { $_ } } | Select-Object -Unique)
if ($Operation -eq 'install' -and $Targets.Count -eq 0) { throw 'Pass at least one installer: opencode, mcode, vibe, codex, claude, cursor, or devin.' }
if ($UpdateFromRecorded) {
    $DetectedHints = @('opencode', 'mcode', 'vibe', 'codex', 'claude', 'cursor', 'devin') | Where-Object {
        ($_ -notin $Targets) -and -not (Test-RecordedHost $_) -and (Test-HostDetected $_)
    }
    if ($DetectedHints.Count -gt 0) { Write-Host \"Detected locally but not recorded: $($DetectedHints -join ', ') - pass them to -Install or -Update to enable their features.\" }
}
if ($Operation) {
    foreach ($Target in $Targets) { Assert-PluginInstaller $Target }
    Write-Host ''
    Write-Host \"Selected operation: $Operation\"
    $SharedTargets = @($Targets | Where-Object { $_ -in @('opencode', 'mcode', 'vibe') })
    $McpTargets = @($Targets | Where-Object { $_ -in @('cursor', 'claude', 'codex', 'opencode', 'devin') })
    if ($SharedTargets.Count -gt 0) {
        if ($Operation -eq 'update' -and -not (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git'))) { throw \"No managed checkout exists to update: $ManagedCheckout\" }
        Update-ManagedCheckout
        Sync-SharedSkills
    }
    if ($McpTargets.Count -gt 0) {
        $McpScript = Join-Path $ManagedCheckout 'packages/shiori-brain-mcp/src/index.js'
        if (-not (Test-Path -LiteralPath $McpScript)) { Update-ManagedCheckout }
        if ($Operation -eq 'update' -and (Test-Path -LiteralPath (Join-Path $ManagedCheckout '.git'))) { Update-ManagedCheckout }
        if (-not (Test-Path -LiteralPath $McpScript)) { throw \"Shiori checkout is missing the MCP server: $McpScript\" }
    }
    foreach ($Target in $Targets) {
        switch (($Operation + ':' + $Target)) {
            { $_ -in @('install:opencode', 'update:opencode') } { Add-RecordedHost opencode; Invoke-McpCli -McpArgs @('install', '--host', 'opencode') }
            { $_ -in @('install:mcode', 'install:vibe', 'update:mcode', 'update:vibe') } { Add-RecordedHost $Target }
            'install:codex' { Install-CodexPlugin; Invoke-McpCli -McpArgs @('install', '--host', 'codex') }
            'install:claude' { Install-ClaudePlugin; Invoke-McpCli -McpArgs @('install', '--host', 'claude') }
            { $_ -in @('install:cursor', 'update:cursor') } { Invoke-McpCli -McpArgs @('install', '--host', 'cursor'); Add-RecordedHost cursor }
            { $_ -in @('install:devin', 'update:devin') } { Invoke-McpCli -McpArgs @('install', '--host', 'devin'); Add-RecordedHost devin }
            'update:codex' { Update-CodexPlugin; Invoke-McpCli -McpArgs @('install', '--host', 'codex') }
            'update:claude' { Update-ClaudePlugin; Invoke-McpCli -McpArgs @('install', '--host', 'claude') }
        }
    }
}
`;
}
