# shiori-brain-mcp

Read-only local stdio MCP server for the published Shiori knowledge archive.

It fetches `index.json` and raw Markdown from GitHub Pages and exposes:

- `search` — match ids, titles, summaries, and tags
- `read_doc` — return one document's Markdown by id

Run it from the managed Shiori checkout (the doctor registers this path):

```bash
node ~/.local/share/shiori/shiori-brain/packages/shiori-brain-mcp/src/index.js
```

The archive origin defaults to `https://dragonshorn-studios.github.io/shiori-brain/` and can be set with `SHIORI_BRAIN_BASE_URL` or `--base-url`. The server caches fetches in memory, aborts hung fetches after 10s, does not take secrets, and does not write.

This package is a consumer of the published snapshot. `AffineMcpSource` in the parent Action remains the generate-time AFFiNE client.
