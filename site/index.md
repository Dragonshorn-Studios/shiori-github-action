---
title: Shiori Archive
---

# Shiori Archive <span class="bookmark" aria-hidden="true">◆</span>

Project knowledge, preserved as readable Markdown.

[Open the archive]({{ '/brain/README.html' | relative_url }}){: .archive-button }

Consult shiori-brain on demand (`search` / `read_doc`) before architecture or security decisions; do not dump that knowledge into context. Skills are procedures only.

## MCP servers

The generated doctor can add these MCP servers to Cursor (`~/.cursor/mcp.json`), Claude Code (`claude mcp add -s user`), and Codex (`codex mcp add`). Craft CLIs are added only when the executable is on `PATH`. The shiori-brain server is launched from the managed checkout, not from a package registry.

| Server | Command | Purpose | When added |
| --- | --- | --- | --- |
{% for server in site.data.shiori-mcp %}
| `{{ server.name }}` | `{{ server.command }}` | {{ server.summary }} | {% if server.when_installed %}Only when the CLI is installed{% else %}On doctor `--install` / `--update`{% endif %} |
{% endfor %}

The published snapshot also includes [`index.json`]({{ '/index.json' | relative_url }}) and raw Markdown under [`/raw/`]({{ '/raw/overview.md' | relative_url }}).

<p class="provenance">AFFiNE remains the canonical source. This site is a generated, reviewable snapshot.</p>
