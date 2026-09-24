import { compile } from './compiler.js';
import { AffineCliSource } from './affine-cli-source.js';

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
    token: required('affine-token'),
    workspaceId: required('workspace-id'),
    rootDocumentId: required('root-document-id'),
    outputDirectory: input('output-directory', 'docs/brain'),
    agentFile: input('agent-file', 'AGENTS.md'),
    pages: booleanInput('pages', true),
    maxDocuments: Number.parseInt(input('max-documents', '250'), 10),
    affineCli: input('affine-cli', 'affine'),
    installAffineCli: booleanInput('install-affine-cli', true)
  };
  if (!Number.isSafeInteger(config.maxDocuments) || config.maxDocuments < 1) throw new Error("Input 'max-documents' must be a positive integer.");
  new URL(config.baseUrl);
  console.log('::group::Shiori — compiling AFFiNE knowledge');
  const result = await compile(new AffineCliSource(config), config);
  console.log(`Exported ${result.documentCount} document(s) to ${config.outputDirectory}.`);
  console.log('::endgroup::');
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(outputFile, `document-count=${result.documentCount}\n`, 'utf8');
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message.replace(/\r?\n/g, '%0A')}`);
  process.exitCode = 1;
});
