import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const AFFINE_CLI_REVISION = 'a65839c020dfabf6132ef3f5754fbdb0b53813aa';

export class AffineCliSource {
  constructor(config) {
    this.config = config;
    this.command = resolveCli(config);
  }

  async getDocument(id) {
    const metadata = unwrapDocument(this.run(['doc', 'get', '--doc-id', id]));
    const exported = this.run(['doc', 'export-markdown', '--doc-id', id]);
    return {
      id,
      title: metadata.title || `Untitled ${id.slice(0, 8)}`,
      updatedAt: metadata.updatedAt ?? null,
      revision: metadata.updatedAt ?? null,
      markdown: exported.markdown ?? unwrapDocument(exported).markdown ?? ''
    };
  }

  run(args) {
    const env = {
      ...process.env,
      AFFINE_BASE_URL: this.config.baseUrl,
      AFFINE_API_TOKEN: this.config.token,
      AFFINE_WORKSPACE_ID: this.config.workspaceId
    };
    const stdout = execFileSync(this.command, args, { encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
    try {
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`affine-cli returned invalid JSON for ${args.slice(0, 2).join(' ')}: ${error.message}`);
    }
  }
}

function resolveCli(config) {
  try {
    execFileSync(config.affineCli, ['version'], { stdio: 'ignore' });
    return config.affineCli;
  } catch {
    if (!config.installAffineCli) {
      throw new Error(`affine-cli was not found at '${config.affineCli}' and automatic installation is disabled.`);
    }
  }

  execFileSync('go', ['install', `github.com/tomohiro-owada/affine-cli@${AFFINE_CLI_REVISION}`], { stdio: 'inherit' });
  const goPath = execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8' }).trim();
  const candidates = process.platform === 'win32' ? ['affine-cli.exe', 'affine.exe'] : ['affine-cli', 'affine'];
  const binary = candidates.map(name => join(goPath, 'bin', name)).find(existsSync);
  if (!binary) throw new Error('affine-cli installation completed but its binary was not found.');
  process.env.PATH = `${join(goPath, 'bin')}${delimiter}${process.env.PATH ?? ''}`;
  return binary;
}

function unwrapDocument(value) {
  if (!value || typeof value !== 'object') return {};
  if ('id' in value || 'title' in value || 'markdown' in value) return value;
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = unwrapDocument(child);
      if ('id' in found || 'title' in found || 'markdown' in found) return found;
    }
  }
  return {};
}
