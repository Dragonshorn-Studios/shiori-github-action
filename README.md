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

AFFiNE does not currently document a stable bulk Markdown export API. Metadata is available through GraphQL, while document content is stored as Yjs data and normally read through AFFiNE's realtime protocol. Shiori isolates that detail behind `AffineCliSource` and pins a tested commit SHA of the community [`affine-cli`](https://github.com/tomohiro-owada/affine-cli), which already implements that protocol and Markdown conversion. The current pin is recorded in [`src/affine-cli-source.js`](src/affine-cli-source.js) so it cannot drift independently from the Action.

The older official-community [`affine-reader`](https://github.com/toeverything/affine-reader) informed the model, but it targets a narrower cloud-oriented flow and exposes a refresh-token interface rather than the configured self-hosted base URL required here.

This boundary means a future official AFFiNE export API can replace one source adapter without changing paths, manifests, agent adapters, or Pages output.

## Export boundary and safety

The `root-document-id` is the explicit disclosure boundary. Shiori exports that document and recursively follows Markdown document links only when they:

- point to the configured AFFiNE origin (or use an `affine:` URI whose path or query contains the workspace identity), and
- contain the configured workspace ID.

The `affine:` handling belongs to Shiori's link traversal, not `affine-cli`: Shiori extracts the same-workspace document ID from links such as `affine:///workspace/<workspace-id>/<doc-id>`, then asks the source adapter to export that ID.

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

For current self-hosted AFFiNE, create a dedicated least-privilege service account and store its credentials as the Actions secrets `AFFINE_EMAIL` and `AFFINE_PASSWORD`. Shiori signs in once per run and keeps only the resulting session cookie in memory. Older deployments may instead use `AFFINE_API_TOKEN`, and an existing session may be supplied as `AFFINE_COOKIE`.

Then add this workflow:

Shiori enables the GitHub Pages shell by default. If the parent of `output-directory` already contains a Jekyll site or files you need to preserve—for the default `docs/brain`, that parent is `docs/`—set `pages: false`; Pages mode maintains files including `_config.yml`, `index.md`, and `_layouts/default.html` there.

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
          affine-email: ${{ secrets.AFFINE_EMAIL }}
          affine-password: ${{ secrets.AFFINE_PASSWORD }}
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
2. Create a dedicated least-privilege account that can read the selected workspace. Store its credentials only as the `AFFINE_EMAIL` and `AFFINE_PASSWORD` GitHub Actions secrets.
3. Make a root document for the repository knowledge you intend to disclose.
4. Link its child documents, and link deeper descendants from those documents. Only this reachable, same-workspace graph is exported.
5. Add the AFFiNE tag `skill` to any exported document that should also become an installable Agent Skill.
6. Copy the workspace and root document IDs from their AFFiNE URLs.

### Action inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `affine-base-url` | yes | — | AFFiNE deployment origin |
| `affine-token` | conditional | — | Legacy API token for compatible AFFiNE deployments |
| `affine-cookie` | conditional | — | Complete session Cookie header; expires and must be rotated by the caller |
| `affine-email` | conditional | — | Dedicated self-hosted AFFiNE service-account email |
| `affine-password` | conditional | — | Dedicated self-hosted AFFiNE service-account password |
| `workspace-id` | yes | — | Source workspace |
| `root-document-id` | yes | — | Root of the allowed linked subtree |
| `output-directory` | no | `docs/brain` | Generated Markdown destination |
| `agent-file` | no | `AGENTS.md` | Thin managed agent bootstrap; empty disables it |
| `pages` | no | `true` | Generate the Pages shell beside the output |
| `max-documents` | no | `250` | Traversal safety cap |
| `affine-cli` | no | `affine` | Existing CLI command: an absolute executable path or a command name available on the runner's `PATH`; when absent, `install-affine-cli` installs and locates the pinned CLI |
| `install-affine-cli` | no | `true` | Install the pinned tested revision with Go if absent |
| `skill-tag` | no | `skill` | Exact AFFiNE tag used to generate Agent Skills; empty disables generation |
| `skill-icon-property` | no | `shiori-icon` | AFFiNE text custom property containing an absolute icon URL; empty disables icons |
| `skill-icon-allowed-origins` | no | — | Comma-separated additional URL origins allowed for icons; the AFFiNE origin is always allowed |
| `skill-icon-max-bytes` | no | `524288` | Maximum downloaded icon size in bytes |
| `skills-directory` | no | `.agents/skills` | Canonical project-local Agent Skills directory |
| `plugin-directory` | no | `plugins` | Installable generated plugin packages |
| `marketplace-name` | no | `shiori-knowledge` | Marketplace name used by Claude Code, ZCode, and Cursor |
| `repository` | no | `GITHUB_REPOSITORY` | GitHub `owner/repository` used by Devin plugin metadata |

Configure exactly one authentication method: `affine-token`, `affine-cookie`, or the `affine-email` + `affine-password` pair. Email/password is the recommended unattended option for current self-hosted AFFiNE because the legacy personal-access-token API was removed in AFFiNE 0.27+.

The action exposes `document-count` and `skill-count` as outputs.

```yaml
- id: shiori
  uses: Dragonshorn-Studios/shiori-github-action@v1
  with:
    # ...same inputs as in Quick start
- run: |
    echo "Exported ${{ steps.shiori.outputs.document-count }} docs, ${{ steps.shiori.outputs.skill-count }} skills"
```

## Tagged documents become Agent Skills

When an exported AFFiNE document has the configured `skill` tag, Shiori generates a standards-compatible skill with:

```text
<skill-name>/
├── SKILL.md
└── references/
    └── source.md
```

`SKILL.md` stays small and tells the agent when to load the skill. The tagged AFFiNE document becomes the progressive `references/source.md` payload. Untagged brain documents are not duplicated into skill packages.

The installable copy is packaged as:

```text
plugins/shiori-<name>/
├── .claude-plugin/plugin.json
├── .cursor-plugin/plugin.json
├── .devin-plugin/plugin.json
└── skills/<name>/
    ├── SKILL.md
    └── references/source.md
```

The three plugin manifests describe the same packaged skill for their respective hosts. At repository root, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`, and `.devin-plugin/plugin.json` catalog or require those packages; regeneration replaces Shiori entries idempotently while preserving entries not owned by Shiori.

Following the cross-agent layout used by [`Rughalt/coding-agent-plugins`](https://github.com/Rughalt/coding-agent-plugins), Shiori emits project-local copies for:

| Agent | Generated path |
| --- | --- |
| Codex, Zed, OpenCode and Agent Skills-compatible tools | `.agents/skills/<name>/` |
| Claude Code | `.claude/skills/<name>/` |
| Cursor | `.cursor/skills/<name>/` |
| Windsurf | `.windsurf/skills/<name>/` |
| Vibe | `.vibe/skills/<name>/` |
| Devin project sessions | `.devin/skills/<name>/` |

[ZCode](https://zcode.z.ai/en/docs/plugin) is a separate coding-agent product, not another name for Windsurf. Shiori serves ZCode through the generated plugin marketplace: ZCode prefers `.zcode-plugin/plugin.json` but explicitly accepts the generated Claude-compatible `.claude-plugin/plugin.json` fallback.

It also creates an installable plugin for every tagged document under `plugins/shiori-<name>/` and maintains:

- `.claude-plugin/marketplace.json` for Claude Code;
- `.cursor-plugin/marketplace.json` for Cursor;
- `marketplace.json` plus `.zcode-plugin/plugin.json` manifests for ZCode;
- `.devin-plugin/plugin.json` as a Devin meta-plugin that requires all generated skill plugins.

For a repository `OWNER/REPO` using the default marketplace name:

```bash
# Claude Code
/plugin marketplace add OWNER/REPO
/plugin install shiori-architecture@shiori-knowledge

# Devin: one generated skill
devin plugins install OWNER/REPO#plugins/shiori-architecture

# Devin: every generated skill through the root meta-plugin
devin plugins install OWNER/REPO
```

For ZCode, open **Settings → Plugins → Create → Add marketplace** and enter `OWNER/REPO`. ZCode reads the repository-root `marketplace.json` and prefers each generated plugin's `.zcode-plugin/plugin.json` manifest.

### Skill icons from AFFiNE

Create a workspace-wide AFFiNE custom property named `shiori-icon` with type **Text**, then set it on any document carrying the `skill` tag. Its value must be an absolute URL to a PNG, JPEG, or WebP image. A square PNG is the most portable choice.

Shiori does not leave the AFFiNE URL in generated plugin manifests. It downloads the image during synchronization, validates its origin, MIME type, file signature, and size, then vendors it under:

```text
plugins/shiori-<name>/assets/icon.<extension>
```

The AFFiNE origin is allowed automatically and receives the configured bearer token, which permits authenticated AFFiNE blob URLs. Redirects are rejected. External CDNs must be explicitly listed in `skill-icon-allowed-origins`; Shiori never sends the AFFiNE token to them.

Cursor receives the repository-local `logo` path. ZCode receives a public `raw.githubusercontent.com` URL in the root marketplace, so its icon is visible only when that URL is accessible to the ZCode client. Devin's current public plugin manifest does not document an icon field; Shiori includes the asset in the plugin without emitting an unsupported field, ready for future Devin support.

Cursor, Codex, Vibe, and compatible cloud agents can use the committed project-local directories immediately. The marketplace JSON files preserve non-Shiori entries and replace only plugin sources under the configured `plugins/shiori-*` namespace.

## Deterministic output

Titles are Unicode-normalized and sanitized into lowercase paths. The first hierarchy path discovered from the root is canonical; collisions receive a stable source-ID suffix. Line endings, index order, manifest keys, links, and trailing newlines are normalized. The manifest records source identity, revision/update metadata, output path, and a SHA-256 content digest. It intentionally contains no generated timestamp, so an unchanged AFFiNE tree produces no Git diff.

Every sync replaces the configured output directory. Do not put hand-written files there.

When Pages output is enabled, Shiori also maintains `docs/_config.yml`, `docs/index.md`, `docs/_data/shiori-nav.yml`, `docs/_layouts/default.html`, `docs/_includes/nav.html`, and `docs/assets/css/shiori.css`. Disable `pages` if those paths belong to an existing documentation site.

Skill generation maintains only the files listed in `.shiori/generated-skills.json`, plus the Shiori entries in the four root marketplace manifests. Existing non-Shiori marketplace entries are preserved.

Shiori updates only the section between `<!-- shiori:start -->` and `<!-- shiori:end -->` in `AGENTS.md`, preserving repository-specific instructions outside it.

### Jekyll template sources

The files `site/index.md` and `site/_config.yml` are source templates that Shiori copies into the parent of `output-directory` when `pages: true`; with the default `docs/brain`, that destination is `docs/`. Make template changes under `site/`, not in the generated destination. The layout, navigation include, and stylesheet are likewise repository templates at `site/_layouts/default.html`, `site/_includes/nav.html`, and `site/assets/css/shiori.css`; Shiori copies them at runtime rather than compiling them into an Action binary.

## GitHub Pages

With `pages: true`, Shiori writes a no-plugin Jekyll shell beside the generated brain—under `docs/` with the default `docs/brain` output—and uses that Markdown directly. The original theme uses near-black, paper white, desaturated purple, and pale gold with restrained catalogue/bookmark details. It contains no character art, logos, screenshots, or copied decorative assets.

Before deploying, enable Pages in the target repository under **Settings → Pages → Build and deployment → Source: GitHub Actions**. Without that setting, `actions/deploy-pages` fails because Pages is not enabled.

Copy [`examples/pages.yml`](examples/pages.yml) to `.github/workflows/pages.yml` and run the workflow. Navigation is generated from the same AFFiNE hierarchy as `docs/brain/README.md`.

## Local development

Requirements: Node.js 20+. Runtime dependencies are bundled into `dist/index.js` for the GitHub Action.

```bash
npm test
npm run check
npm run build
```

Tests use an in-memory fixture rather than a live AFFiNE workspace. They cover deterministic output, path/title sanitization, hierarchy conversion, manifest generation, same-origin/workspace subtree protection, output path containment, link rewriting, preservation of existing agent instructions, tag filtering, icon download validation, cross-agent skill packaging, and marketplace generation.

For a manual live run, GitHub Actions maps input names from `action.yml` to environment variables named `INPUT_<NAME>`. Set the required source inputs, exactly one authentication method, and `GITHUB_WORKSPACE` pointing to a disposable checkout, then run `node src/main.js`. Never point a development run at a directory containing irreplaceable generated output.

## Architecture

- `AffineCliSource` fetches one normalized document at a time; `AffinePropertyReader` reads custom-property definitions and values from AFFiNE's dedicated WorkspaceDB subdocuments.
- `collectDocuments` enforces the bounded traversal and produces normalized documents.
- The compiler assigns deterministic paths, rewrites internal links, and emits the index and manifest.
- Thin output adapters maintain the managed `AGENTS.md` section, optional Jekyll shell, standards-compatible Agent Skills, and marketplace manifests.

There is no database, backend, account system, webhook service, RAG layer, or MCP server.

## Current AFFiNE limitations

- AFFiNE's external API and realtime/Yjs internals are not yet a documented stable export contract. The pinned CLI revision may need updating for a future AFFiNE release.
- AFFiNE 0.27+ removed the legacy personal-access-token API. Current self-hosted deployments should use a dedicated email/password account. AFFiNE Cloud may require a browser session cookie because its edge protection can block programmatic sign-in.
- The MVP traverses explicit same-workspace document links. It does not decode the newer sidebar organize/folder subdocument. This is conservative and predictable, but a visually nested sidebar folder that is not represented by document links will not be exported.
- Advanced AFFiNE block types may be lossy in Markdown because conversion fidelity is bounded by the source adapter.
- Skill icons use AFFiNE's realtime/Yjs custom-property storage because the current GraphQL document metadata and Markdown export do not expose custom properties.

These uncertainties are deliberately contained in the source adapter. The repository snapshot format is independent of them.

## License

MIT
