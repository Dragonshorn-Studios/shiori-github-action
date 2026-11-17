# shiori-brain-mcp

Read-only local stdio MCP server for the published Shiori knowledge archive.

It fetches `index.json` and raw Markdown from GitHub Pages and exposes:

- `search` — match ids, titles, summaries, and tags
- `read_doc` — return one document's Markdown by id

```bash
npx -y shiori-brain-mcp
npx -y shiori-brain-mcp --base-url https://dragonshorn-studios.github.io/shiori-brain/
```

The archive origin defaults to `https://dragonshorn-studios.github.io/shiori-brain/` and can be set with `SHIORI_BRAIN_BASE_URL` or `--base-url`. The server caches fetches in memory, does not take secrets, and does not write.

This package is a consumer of the published snapshot. `AffineMcpSource` in the parent Action remains the generate-time AFFiNE client.
