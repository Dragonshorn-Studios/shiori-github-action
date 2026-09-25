import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const AFFINE_MCP_PACKAGE = 'affine-mcp-server@3.8.2';

export class AffineMcpSource {
  constructor(config, client = null) {
    this.config = config;
    this.client = client;
    this.transport = null;
  }

  async connect() {
    if (this.client) return;
    this.client = new Client({ name: 'shiori-github-action', version: '1.1.0' });
    const command = this.config.affineMcpCommand || 'npx';
    const args = this.config.affineMcpCommand
      ? []
      : ['--yes', '--package', this.config.affineMcpPackage || AFFINE_MCP_PACKAGE, 'affine-mcp'];
    this.transport = new StdioClientTransport({
      command,
      args,
      env: mcpEnvironment(this.config),
      stderr: 'inherit'
    });
    await this.client.connect(this.transport);
  }

  async close() {
    if (this.client?.close) await this.client.close();
    this.client = null;
    this.transport = null;
  }

  async getDocument(id) {
    await this.connect();
    const document = await this.call('read_doc', {
      workspaceId: this.config.workspaceId,
      docId: id,
      includeMarkdown: true
    });
    if (document.exists === false) throw new Error(`AFFiNE document '${id}' does not exist.`);
    const iconUrl = this.config.skillIconProperty
      ? await this.getTextProperty(id, this.config.skillIconProperty)
      : null;
    return {
      id,
      title: document.title || `Untitled ${id.slice(0, 8)}`,
      updatedAt: document.updatedAt ?? null,
      revision: document.revision ?? null,
      markdown: document.markdown ?? '',
      properties: iconUrl ? { [this.config.skillIconProperty]: iconUrl } : {}
    };
  }

  async listTaggedDocumentIds(tag) {
    await this.connect();
    const result = await this.call('list_docs_by_tag', {
      workspaceId: this.config.workspaceId,
      tag,
      ignoreCase: false
    });
    if (!Array.isArray(result.docs)) throw new Error(`AFFiNE MCP returned invalid documents for tag '${tag}'.`);
    return result.docs.filter(doc => !doc.inTrash).map(doc => doc.id);
  }

  async getTextProperty(docId, propertyName) {
    const result = await this.call('list_doc_properties', {
      workspaceId: this.config.workspaceId,
      docId
    });
    const normalized = propertyName.trim().toLowerCase();
    const matches = (result.properties ?? []).filter(property =>
      property.propertyId === propertyName || property.name?.trim().toLowerCase() === normalized
    );
    if (matches.length > 1) throw new Error(`AFFiNE custom property '${propertyName}' is ambiguous.`);
    if (!matches.length || !matches[0].set) return null;
    if (matches[0].type !== 'text') throw new Error(`AFFiNE custom property '${propertyName}' must be a text property, not '${matches[0].type}'.`);
    return typeof matches[0].value === 'string' && matches[0].value.trim() ? matches[0].value.trim() : null;
  }

  async call(name, args) {
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`AFFiNE MCP tool '${name}' failed: ${resultText(result)}`);
    if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
    const text = result.content?.find(item => item.type === 'text')?.text;
    if (!text) throw new Error(`AFFiNE MCP tool '${name}' returned no structured result.`);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`AFFiNE MCP tool '${name}' returned invalid JSON: ${error.message}`);
    }
  }
}

function mcpEnvironment(config) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
  delete env.AFFINE_API_TOKEN;
  delete env.AFFINE_COOKIE;
  delete env.AFFINE_EMAIL;
  delete env.AFFINE_PASSWORD;
  return {
    ...env,
    AFFINE_BASE_URL: config.baseUrl,
    AFFINE_WORKSPACE_ID: config.workspaceId,
    AFFINE_COOKIE: config.cookie || '',
    AFFINE_API_TOKEN: config.token || '',
    AFFINE_TOOL_PROFILE: 'read_only',
    AFFINE_LOGIN_AT_START: 'sync'
  };
}

function resultText(result) {
  return result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || 'unknown error';
}
