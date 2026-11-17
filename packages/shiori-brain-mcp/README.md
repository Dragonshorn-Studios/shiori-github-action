# shiori-brain-mcp

Read-only local stdio MCP server for the published Shiori knowledge archive.

It fetches `index.json` and raw Markdown from GitHub Pages and exposes:

- `search` — match ids, titles, summaries, and tags
- `read_doc` — return one document's Markdown by id

Run it from the managed Shiori checkout (the doctor registers this path):

```bash
node ~/.local/share/shiori/shiori-brain/packages/shiori-brain-mcp/src/index.js --base-url https://OWNER.github.io/REPO/
```

The archive origin is required: pass `--base-url` or set `SHIORI_BRAIN_BASE_URL` to the published Pages origin of this knowledge repository. The server will not fall back to another project's archive. The doctor writes that environment variable into Cursor, Claude Code, and Codex MCP entries. The server caches fetches in memory, aborts hung fetches after 10s, does not take secrets, and does not write.

This package is a consumer of the published snapshot. `AffineMcpSource` in the parent Action remains the generate-time AFFiNE client.
