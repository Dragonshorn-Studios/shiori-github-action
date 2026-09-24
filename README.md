# Shiori 🌸

Shiori compiles one deliberately selected part of an [AFFiNE](https://affine.pro/) workspace into deterministic Markdown in a Git repository. The snapshot is useful to coding agents, reviewable through normal pull requests, and publishable as a small GitHub Pages archive.

AFFiNE remains the source of truth. Shiori is an exporter, not another knowledge database.

```text
AFFiNE root document
  └─ same-workspace links
       ↓
docs/brain/
  ├─ README.md
  ├─ overview.md
  ├─ hierarchy-derived Markdown paths
  └─ manifest.json
       ├─ AGENTS.md bootstrap
       ├─ tagged Agent Skills + plugin marketplaces
       └─ GitHub Pages
```

## Why the source adapter is small

AFFiNE does not currently document a stable bulk Markdown export API. Metadata is available through GraphQL, while document content is stored as Yjs data and normally read through AFFiNE's realtime protocol. Shiori isolates that detail behind `AffineCliSource` and pins the tested revision of the community [`affine-cli`](https://github.com/tomohiro-owada/affine-cli), which already implements that protocol and Markdown conversion.

The older official-community [`affine-reader`](https://github.com/toeverything/affine-reader) informed the model, but it targets a narrower cloud-oriented flow and exposes a refresh-token interface rather than the configured self-hosted base URL required here.

This boundary means a future official AFFiNE export API can replace one source adapter without changing paths, manifests, agent adapters, or Pages output.

## Export boundary and safety

The `root-document-id` is the explicit disclosure boundary. Shiori exports that document and recursively follows Markdown document links only when they:

- point to the configured AFFiNE origin (or use the `affine:` scheme), and
- contain the configured workspace ID.

External links and links to another workspace are preserved but never fetched. `max-documents` provides a second explicit cap. Secrets are passed to the source command through environment variables and are never written to the manifest.

This MVP treats the linked document tree beneath the root document as the selected subtree. AFFiNE's newer sidebar folder/organize tree is an internal Yjs structure and is not yet a stable public API; see [Current AFFiNE limitations](#current-affine-limitations).

### Why Shiori asks for a root document ID, not a folder ID

An AFFiNE document has a stable source identity that the current read/export adapter can fetch directly. A sidebar folder is different: it is an organization node stored in AFFiNE's workspace-root Yjs metadata, not a normal document with a stable documented export endpoint. Its representation has changed across AFFiNE versions and the pinned adapter does not expose it as a safe read-only subtree API.

The root document also acts as an explicit publication boundary. Shiori starts from exactly that document and can prove that every exported child was reached through a same-origin, same-workspace link. Accepting a folder ID through undocumented internals would make it easier for an AFFiNE upgrade or sidebar reorganization to export more material than intended.

In practice, create a lightweight “project brain” document inside the desired folder and link the documents that belong in the repository snapshot. Use that document's ID as `root-document-id`. The folder can still organize the human-facing workspace; the root document is the stable, auditable export contract.

## Quick start

Create repository variables:

- `AFFINE_BASE_URL`, for example `https://affine.example.com`
- `AFFINE_WORKSPACE_ID`
- `AFFINE_ROOT_DOCUMENT_ID`

Create the Actions secret `AFFINE_API_TOKEN`, then add this workflow:

```yaml
name: Sync AFFiNE knowledge
on:
  workflow_dispatch:
  schedule:
    - cron: "17 4 * * 1"

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: stable
      - uses: Dragonshorn-Studios/shiori-github-action@v1
        with:
          affine-base-url: ${{ vars.AFFINE_BASE_URL }}
          affine-token: ${{ secrets.AFFINE_API_TOKEN }}
          workspace-id: ${{ vars.AFFINE_WORKSPACE_ID }}
          root-document-id: ${{ vars.AFFINE_ROOT_DOCUMENT_ID }}
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: docs/shiori-sync
          delete-branch: true
          commit-message: "docs(brain): sync AFFiNE knowledge"
          title: "docs(brain): sync AFFiNE knowledge"
```

A complete copy is available at [`examples/sync-affine.yml`](examples/sync-affine.yml).

### Required AFFiNE setup

1. Use a server-backed AFFiNE workspace. Browser-local-only workspaces are not available to a CI runner.
2. Create a read-capable API token for the account/workspace and store it only as `AFFINE_API_TOKEN` in GitHub Actions secrets.
3. Make a root document for the repository knowledge you intend to disclose.
4. Link its child documents, and link deeper descendants from those documents. Only this reachable, same-workspace graph is exported.
5. Add the AFFiNE tag `skill` to any exported document that should also become an installable Agent Skill.
6. Copy the workspace and root document IDs from their AFFiNE URLs.

### Action inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `affine-base-url` | yes | — | AFFiNE deployment origin |
| `affine-token` | yes | — | Secret API token |
| `workspace-id` | yes | — | Source workspace |
| `root-document-id` | yes | — | Root of the allowed linked subtree |
| `output-directory` | no | `docs/brain` | Generated Markdown destination |
| `agent-file` | no | `AGENTS.md` | Thin managed agent bootstrap; empty disables it |
| `pages` | no | `true` | Generate the Pages shell beside the output |
| `max-documents` | no | `250` | Traversal safety cap |
| `affine-cli` | no | `affine` | Existing CLI path/name |
| `install-affine-cli` | no | `true` | Install the pinned tested revision with Go if absent |
| `skill-tag` | no | `skill` | Exact AFFiNE tag used to generate Agent Skills; empty disables generation |
| `skills-directory` | no | `.agents/skills` | Canonical project-local Agent Skills directory |
| `plugin-directory` | no | `plugins` | Installable generated plugin packages |
| `marketplace-name` | no | `shiori-knowledge` | Claude/ZCode and Cursor marketplace name |
| `repository` | no | `GITHUB_REPOSITORY` | GitHub `owner/repository` used by Devin plugin metadata |

The action exposes `document-count` and `skill-count` as outputs.

## Tagged documents become Agent Skills

When an exported AFFiNE document has the configured `skill` tag, Shiori generates a standards-compatible skill with:

```text
<skill-name>/
├── SKILL.md
└── references/
    └── source.md
```

`SKILL.md` stays small and tells the agent when to load the skill. The tagged AFFiNE document becomes the progressive `references/source.md` payload. Untagged brain documents are not duplicated into skill packages.

Following the cross-agent layout used by [`Rughalt/coding-agent-plugins`](https://github.com/Rughalt/coding-agent-plugins), Shiori emits project-local copies for:

| Agent | Generated path |
| --- | --- |
| Codex, Zed, OpenCode and Agent Skills-compatible tools | `.agents/skills/<name>/` |
| Claude Code | `.claude/skills/<name>/` |
| Cursor | `.cursor/skills/<name>/` |
| ZCode/Windsurf | `.windsurf/skills/<name>/` |
| Vibe | `.vibe/skills/<name>/` |
| Devin project sessions | `.devin/skills/<name>/` |

It also creates an installable plugin for every tagged document under `plugins/shiori-<name>/` and maintains:

- `.claude-plugin/marketplace.json` for Claude Code and ZCode marketplace installation;
- `.cursor-plugin/marketplace.json` for Cursor;
- `.devin-plugin/plugin.json` as a Devin meta-plugin that requires all generated skill plugins.

For a repository `OWNER/REPO` using the default marketplace name:

```bash
# Claude Code or ZCode
/plugin marketplace add OWNER/REPO
/plugin install shiori-architecture@shiori-knowledge

# Devin: one generated skill
devin plugins install OWNER/REPO#plugins/shiori-architecture

# Devin: every generated skill through the root meta-plugin
devin plugins install OWNER/REPO
```

Cursor, Codex, Vibe, and compatible cloud agents can use the committed project-local directories immediately. The marketplace JSON files preserve non-Shiori entries and replace only plugin sources under the configured `plugins/shiori-*` namespace.

## Deterministic output

Titles are Unicode-normalized and sanitized into lowercase paths. The first hierarchy path discovered from the root is canonical; collisions receive a stable source-ID suffix. Line endings, index order, manifest keys, links, and trailing newlines are normalized. The manifest records source identity, revision/update metadata, output path, and a SHA-256 content digest. It intentionally contains no generated timestamp, so an unchanged AFFiNE tree produces no Git diff.

Every sync replaces the configured output directory. Do not put hand-written files there.

When Pages output is enabled, Shiori also maintains `docs/_config.yml`, `docs/index.md`, `docs/_data/shiori-nav.yml`, `docs/_layouts/default.html`, `docs/_includes/nav.html`, and `docs/assets/css/shiori.css`. Disable `pages` if those paths belong to an existing documentation site.

Skill generation maintains only the files listed in `.shiori/generated-skills.json`, plus the Shiori entries in the three root marketplace manifests. Existing non-Shiori marketplace entries are preserved.

Shiori updates only the section between `<!-- shiori:start -->` and `<!-- shiori:end -->` in `AGENTS.md`, preserving repository-specific instructions outside it.

## GitHub Pages

With `pages: true`, Shiori writes a no-plugin Jekyll shell under `docs/` and uses the generated brain Markdown directly. The original theme uses near-black, paper white, desaturated purple, and pale gold with restrained catalogue/bookmark details. It contains no character art, logos, screenshots, or copied decorative assets.

Copy [`examples/pages.yml`](examples/pages.yml) to `.github/workflows/pages.yml`, set the repository's Pages source to **GitHub Actions**, and run the workflow. Navigation is generated from the same AFFiNE hierarchy as `docs/brain/README.md`.

## Local development

Requirements: Node.js 20+. Runtime code has no npm dependencies.

```bash
npm test
npm run check
```

Tests use an in-memory fixture rather than a live AFFiNE workspace. They cover deterministic output, path/title sanitization, hierarchy conversion, manifest generation, same-origin/workspace subtree protection, output path containment, link rewriting, preservation of existing agent instructions, tag filtering, cross-agent skill packaging, and marketplace generation.

For a manual live run, set the `INPUT_*` environment variables documented in `action.yml`, set `GITHUB_WORKSPACE` to a disposable checkout, and run `node src/main.js`. Never point a development run at a directory containing irreplaceable generated output.

## Architecture

- `AffineCliSource` fetches one normalized document at a time. It is the only AFFiNE-specific module.
- `collectDocuments` enforces the bounded traversal and produces normalized documents.
- The compiler assigns deterministic paths, rewrites internal links, and emits the index and manifest.
- Thin output adapters maintain the managed `AGENTS.md` section, optional Jekyll shell, standards-compatible Agent Skills, and marketplace manifests.

There is no database, backend, account system, webhook service, RAG layer, or MCP server.

## Current AFFiNE limitations

- AFFiNE's external API and realtime/Yjs internals are not yet a documented stable export contract. The pinned CLI revision may need updating for a future AFFiNE release.
- The token flow is intended primarily for compatible self-hosted deployments. AFFiNE Cloud and AFFiNE 0.27+ authentication behavior is evolving; current third-party research reports that Cloud may require browser-session authentication instead of programmatic API tokens.
- The MVP traverses explicit same-workspace document links. It does not decode the newer sidebar organize/folder subdocument. This is conservative and predictable, but a visually nested sidebar folder that is not represented by document links will not be exported.
- Advanced AFFiNE block types may be lossy in Markdown because conversion fidelity is bounded by the source adapter.

These uncertainties are deliberately contained in the source adapter. The repository snapshot format is independent of them.

## License

MIT
