import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocumentLinks, rewriteDocumentLinks } from './links.js';
import { normalizeMarkdown, sha256, slugify, stableJson } from './model.js';
import { generateSkills } from './skills.js';

const MANAGED_START = '<!-- shiori:start -->';
const MANAGED_END = '<!-- shiori:end -->';

export async function compile(source, config) {
  const outputRoot = safeRepositoryPath(config.repositoryRoot, config.outputDirectory);
  const documents = await collectDocuments(source, config);
  const pathById = assignPaths(documents, config.rootDocumentId);
  let skillTaggedIds = new Set();
  let agentTaggedIds = new Set();
  if (config.skillTag || config.agentTag) {
    if (typeof source.listTaggedDocumentIds !== 'function') throw new Error('The configured knowledge source does not support AFFiNE tag discovery.');
    if (config.skillTag) skillTaggedIds = new Set(await source.listTaggedDocumentIds(config.skillTag));
    if (config.agentTag) {
      agentTaggedIds = config.agentTag === config.skillTag
        ? new Set(skillTaggedIds)
        : new Set(await source.listTaggedDocumentIds(config.agentTag));
    }
    const packagedIds = new Set([...skillTaggedIds, ...agentTaggedIds]);
    if (config.skillIconProperty && typeof source.getTextProperty === 'function') {
      for (const id of packagedIds) {
        const document = documents.get(id);
        if (!document) continue;
        const iconUrl = await source.getTextProperty(id, config.skillIconProperty);
        if (iconUrl) document.properties = { ...(document.properties ?? {}), [config.skillIconProperty]: iconUrl };
      }
    }
  }
  const written = [];

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const document of documents.values()) {
    const target = pathById.get(document.id);
    const body = rewriteDocumentLinks(document.markdown, config, target, pathById);
    const content = frontmatter(document) + normalizeMarkdown(body);
    await write(outputRoot, target, content);
    written.push({ document, path: target, content });
  }

  const readme = `---\nlayout: default\ntitle: Archive index\n---\n\n${renderIndex(documents, pathById, config.rootDocumentId)}`;
  await write(outputRoot, 'README.md', readme);

  const manifest = createManifest(written, config, skillTaggedIds, agentTaggedIds);
  await write(outputRoot, 'manifest.json', stableJson(manifest));

  if (config.agentFile) await updateAgentFile(config);
  if (config.pages) {
    await write(dirname(outputRoot), '_data/shiori-nav.yml', renderNavigation(documents, pathById, config.rootDocumentId, agentTaggedIds, skillTaggedIds));
    await writePagesShell(config, outputRoot);
  }
  let skillCount = 0;
  let agentCount = 0;
  if (config.skillTag || config.agentTag) {
    const packagedIds = new Set([...skillTaggedIds, ...agentTaggedIds]);
    const generated = await generateSkills(documents, packagedIds, config, agentTaggedIds);
    skillCount = generated.count;
    agentCount = generated.agentCount;
  }
  return { documentCount: documents.size, skillCount, agentCount, outputRoot, manifest };
}

export async function collectDocuments(source, config) {
  const found = new Map();
  const queue = [{ id: config.rootDocumentId, parentId: null, depth: 0 }];
  while (queue.length) {
    const item = queue.shift();
    if (found.has(item.id)) continue;
    if (found.size >= config.maxDocuments) throw new Error(`Export exceeded max-documents (${config.maxDocuments}). Narrow the root or raise the explicit cap.`);
    const document = await source.getDocument(item.id);
    if (!document || document.id !== item.id) throw new Error(`Source returned an invalid document for ${item.id}.`);
    const links = extractDocumentLinks(document.markdown, config).filter(id => id !== item.id);
    found.set(item.id, { ...document, parentId: item.parentId, depth: item.depth, childIds: links });
    for (const id of links) if (!found.has(id) && !queue.some(entry => entry.id === id)) queue.push({ id, parentId: item.id, depth: item.depth + 1 });
  }
  return found;
}

export function assignPaths(documents, rootId) {
  const paths = new Map([[rootId, 'overview.md']]);
  const used = new Set(['overview.md']);
  const queue = [rootId];
  while (queue.length) {
    const parentId = queue.shift();
    const parent = documents.get(parentId);
    for (const childId of parent.childIds) {
      if (!documents.has(childId) || paths.has(childId)) continue;
      const child = documents.get(childId);
      const parentPath = paths.get(parentId);
      const baseDir = parentId === rootId ? '' : parentPath.replace(/\.md$/, '');
      const base = slugify(child.title);
      let candidate = [baseDir, `${base}.md`].filter(Boolean).join('/');
      if (used.has(candidate)) candidate = [baseDir, `${base}--${slugify(childId).slice(0, 8)}.md`].filter(Boolean).join('/');
      paths.set(childId, candidate);
      used.add(candidate);
      queue.push(childId);
    }
  }
  return paths;
}

function createManifest(written, config, skillTaggedIds, agentTaggedIds) {
  return {
    schemaVersion: 1,
    generator: 'shiori',
    source: {
      type: 'affine',
      baseUrl: new URL(config.baseUrl).origin,
      workspaceId: config.workspaceId,
      rootDocumentId: config.rootDocumentId,
      traversal: 'same-workspace-links',
      skillTag: config.skillTag || null,
      agentTag: config.agentTag || null,
      skillIconProperty: config.skillIconProperty || null
    },
    documents: written.sort((a, b) => a.path.localeCompare(b.path)).map(({ document, path, content }) => ({
      id: document.id,
      path,
      title: document.title,
      revision: document.revision,
      updatedAt: document.updatedAt,
      skill: skillTaggedIds.has(document.id) || agentTaggedIds.has(document.id),
      agent: agentTaggedIds.has(document.id),
      sha256: sha256(content)
    }))
  };
}

function renderIndex(documents, paths, rootId) {
  const lines = ['# Project knowledge archive', '', '> Generated by Shiori. AFFiNE is canonical; do not edit these files by hand.', '', `Start with [${escapeMd(documents.get(rootId).title)}](${paths.get(rootId)}).`, '', '## Contents', ''];
  const visit = (id, depth) => {
    const doc = documents.get(id);
    lines.push(`${'  '.repeat(depth)}- [${escapeMd(doc.title)}](${paths.get(id)})`);
    for (const childId of doc.childIds) if (documents.has(childId) && documents.get(childId).parentId === id) visit(childId, depth + 1);
  };
  visit(rootId, 0);
  return lines.join('\n') + '\n';
}

function renderNavigation(documents, paths, rootId, agentTaggedIds = new Set(), skillTaggedIds = new Set()) {
  const lines = [];
  const visit = (id, depth) => {
    const indent = '  '.repeat(depth);
    const children = documents.get(id).childIds.filter(childId => documents.has(childId) && documents.get(childId).parentId === id);
    lines.push(`${indent}- title: ${JSON.stringify(documents.get(id).title)}`, `${indent}  url: /brain/${paths.get(id).replace(/\.md$/, '.html')}`);
    if (children.length) {
      lines.push(`${indent}  children:`);
      for (const childId of children) visit(childId, depth + 2);
    }
  };
  visit(rootId, 0);

  const agents = [...agentTaggedIds]
    .filter(id => documents.has(id))
    .map(id => documents.get(id))
    .sort((a, b) => a.title.localeCompare(b.title));

  const skills = [...skillTaggedIds]
    .filter(id => documents.has(id))
    .map(id => documents.get(id))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (agents.length) {
    lines.push('- title: "Agents"');
    lines.push('  children:');
    for (const agentDoc of agents) {
      lines.push(`    - title: ${JSON.stringify(agentDoc.title)}`);
      lines.push(`      url: /brain/${paths.get(agentDoc.id).replace(/\.md$/, '.html')}`);
    }
  }

  if (skills.length) {
    lines.push('- title: "Skills"');
    lines.push('  children:');
    for (const skillDoc of skills) {
      lines.push(`    - title: ${JSON.stringify(skillDoc.title)}`);
      lines.push(`      url: /brain/${paths.get(skillDoc.id).replace(/\.md$/, '.html')}`);
    }
  }

  return lines.join('\n') + '\n';
}

function frontmatter(document) {
  return `---\nlayout: default\ntitle: ${JSON.stringify(document.title)}\nshiori_source_id: ${JSON.stringify(document.id)}\n---\n\n`;
}

async function updateAgentFile(config) {
  const target = safeRepositoryPath(config.repositoryRoot, config.agentFile);
  let existing = '';
  try { existing = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const block = `${MANAGED_START}\n## Project knowledge\n\nProject knowledge is available under \`${config.outputDirectory.replaceAll('\\', '/')}\`.\n\nRead \`${config.outputDirectory.replaceAll('\\', '/')}/README.md\` before planning substantial changes, then follow links to the relevant documentation. AFFiNE is canonical; these files are a generated snapshot and must not be edited manually.\n${MANAGED_END}`;
  const pattern = new RegExp(`${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}`);
  const content = pattern.test(existing) ? existing.replace(pattern, block) : `${existing.trim()}${existing.trim() ? '\n\n' : ''}${block}\n`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function writePagesShell(config, outputRoot) {
  const docsRoot = dirname(outputRoot);
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const templates = join(projectRoot, 'site');
  for (const [source, target] of [
    ['_config.yml', '_config.yml'],
    ['index.md', 'index.md'],
    ['_layouts/default.html', '_layouts/default.html'],
    ['_includes/nav.html', '_includes/nav.html'],
    ['assets/css/shiori.css', 'assets/css/shiori.css']
  ]) {
    const content = await readFile(join(templates, source), 'utf8');
    await write(docsRoot, target, content);
  }
}

function safeRepositoryPath(repositoryRoot, requested) {
  if (!requested || isAbsolute(requested)) throw new Error('Output paths must be non-empty and repository-relative.');
  const root = resolve(repositoryRoot);
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Path escapes the repository: ${requested}`);
  return target;
}

async function write(root, relativePath, content) {
  const target = resolve(root, relativePath);
  const rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Generated path escaped output root: ${relativePath}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function escapeMd(value) { return value.replace(/[\[\]]/g, '\\$&'); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
