import { compile } from './compiler.js';
import { AffineMcpSource } from './affine-mcp-source.js';
import { validateAuthConfig } from './affine-auth.js';

function input(name, fallback = '') {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  return process.env[key] ?? fallback;
}

function required(name) {
  const value = input(name).trim();
  if (!value) throw new Error(`Input '${name}' is required.`);
  return value;
}

function booleanInput(name, fallback) {
  const value = input(name, String(fallback)).toLowerCase();
  if (!['true', 'false'].includes(value)) throw new Error(`Input '${name}' must be true or false.`);
  return value === 'true';
}

async function main() {
  const config = {
    repositoryRoot: process.env.GITHUB_WORKSPACE || process.cwd(),
    baseUrl: required('affine-base-url'),
    token: input('affine-token').trim(),
    cookie: input('affine-cookie').trim(),
    email: input('affine-email').trim(),
    password: input('affine-password'),
    workspaceId: required('workspace-id'),
    rootDocumentId: required('root-document-id'),
    outputDirectory: input('output-directory', 'docs/brain'),
    agentFile: input('agent-file', 'AGENTS.md'),
    pages: booleanInput('pages', true),
    maxDocuments: Number.parseInt(input('max-documents', '250'), 10),
    affineMcpCommand: input('affine-mcp-command').trim(),
    affineMcpPackage: input('affine-mcp-package', 'affine-mcp-server@3.8.2').trim(),
    skillTag: input('skill-tag', 'skill').trim(),
    skillIconProperty: input('skill-icon-property', 'shiori-icon').trim(),
    skillIconAllowedOrigins: input('skill-icon-allowed-origins').split(',').map(value => value.trim()).filter(Boolean).map(value => new URL(value).origin),
    skillIconMaxBytes: Number.parseInt(input('skill-icon-max-bytes', '524288'), 10),
    skillsDirectory: input('skills-directory', '.agents/skills'),
    pluginDirectory: input('plugin-directory', 'plugins'),
    marketplaceName: input('marketplace-name', 'shiori-knowledge'),
    repository: input('repository').trim() || (process.env.GITHUB_REPOSITORY ?? '').trim()
  };
  if (!Number.isSafeInteger(config.maxDocuments) || config.maxDocuments < 1) throw new Error("Input 'max-documents' must be a positive integer.");
  if (!Number.isSafeInteger(config.skillIconMaxBytes) || config.skillIconMaxBytes < 1) throw new Error("Input 'skill-icon-max-bytes' must be a positive integer.");
  new URL(config.baseUrl);
  validateAuthConfig(config);
  console.log('::group::Shiori — compiling AFFiNE knowledge');
  const source = new AffineMcpSource(config);
  let result;
  try {
    await source.connect();
    config.password = '';
    result = await compile(source, config);
  } finally {
    await source.close();
  }
  console.log(`Exported ${result.documentCount} document(s) to ${config.outputDirectory}.`);
  if (config.skillTag) console.log(`Generated ${result.skillCount} Agent Skill(s) from AFFiNE tag '${config.skillTag}'.`);
  console.log('::endgroup::');
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(outputFile, `document-count=${result.documentCount}\nskill-count=${result.skillCount}\n`, 'utf8');
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message.replace(/\r?\n/g, '%0A')}`);
  process.exitCode = 1;
});
