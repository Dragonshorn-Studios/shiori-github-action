const DEFAULT_REPOSITORY = 'Dragonshorn-Studios/shiori-brain';

export function installSupportFiles(config) {
  const repository = config.repository || DEFAULT_REPOSITORY;
  return new Map([
    ['AGENT-SETUP.md', renderGuide(repository)],
    ['scripts/shiori-doctor.sh', renderShellDoctor(repository)],
    ['scripts/shiori-doctor.ps1', renderPowerShellDoctor(repository)]
  ]);
}

function renderGuide(repository) {
  return `# Install Shiori for coding agents

This repository is already project-ready: supported agents can read the committed adapters without a global installation. Run the doctor from the repository root to see which local tools are present and the native setup action for each one.

\`\`\`bash
sh scripts/shiori-doctor.sh
\`\`\`

\`\`\`powershell
.\\scripts\\shiori-doctor.ps1
\`\`\`

The doctor is read-only. It does not edit home-directory configuration or install plugins.

## Native setup matrix

| Host | Project use | Native reusable installation |
| --- | --- | --- |
| OpenCode | Automatic through \`.agents/skills\` | Add this checkout's \`skills\` directory to \`skills\` in \`opencode.json\`, or copy/link each skill to \`~/.config/opencode/skills\`. |
| Codex / ChatGPT desktop | Repository skills work through \`.agents/skills\` | Run \`codex plugin marketplace add ${repository}\`, then open \`/plugins\` and install **Shiori**. |
| Claude Code | Automatic through \`.claude/skills\` and \`.claude/agents\` | Run \`/plugin marketplace add ${repository}\`, then \`/plugin install shiori@dragonshorn-brain\`. |
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

function renderShellDoctor(repository) {
  return `#!/usr/bin/env sh
set -eu

repository=\"\${SHIORI_REPOSITORY:-${repository}}\"

has_command() { command -v \"$1\" >/dev/null 2>&1; }
has_home() { [ -e \"$HOME/$1\" ]; }
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

printf 'Shiori agent doctor\\nRepository: %s\\n\\n' \"$repository\"
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
  \"  OpenCode: project skills are ready in .agents/skills. For global use, add this checkout's skills directory to opencode.json or link it under ~/.config/opencode/skills.\" \\
  \"  Codex:    codex plugin marketplace add $repository ; then open /plugins and install Shiori.\" \\
  \"  Claude:   /plugin marketplace add $repository ; then /plugin install shiori@dragonshorn-brain.\" \\
  \"  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $repository; install Shiori.\" \\
  \"  Cursor:   Settings -> Plugins; add https://github.com/$repository; install Shiori.\" \\
  '  MCode:    project skills are ready in .agents/skills. For plugin install, inspect mcode plugin marketplace list --json and copy plugins/shiori into its local marketplace.' \\
  '  Devin:    connect this repository to the cloud workspace; no local executable is required.' \\
  '' \\
  'Full instructions: AGENT-SETUP.md'
`;
}

function renderPowerShellDoctor(repository) {
  return `# Generated by Shiori. Run from the shiori-brain repository root.
[CmdletBinding()]
param()

$Repository = if ($env:SHIORI_REPOSITORY) { $env:SHIORI_REPOSITORY } else { '${repository}' }

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

Write-Host 'Shiori agent doctor'
Write-Host "Repository: $Repository"
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
  OpenCode: project skills are ready in .agents/skills. For global use, add this checkout's skills directory to opencode.json or link it under ~/.config/opencode/skills.
  Codex:    codex plugin marketplace add $Repository ; then open /plugins and install Shiori.
  Claude:   /plugin marketplace add $Repository ; then /plugin install shiori@dragonshorn-brain.
  ZCode:    Settings -> Plugins -> Create -> Add marketplace -> $Repository; install Shiori.
  Cursor:   Settings -> Plugins; add https://github.com/$Repository; install Shiori.
  MCode:    project skills are ready in .agents/skills. For plugin install, inspect mcode plugin marketplace list --json and copy plugins/shiori into its local marketplace.
  Devin:    connect this repository to the cloud workspace; no local executable is required.

Full instructions: AGENT-SETUP.md
"@
`;
}
