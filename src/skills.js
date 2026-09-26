import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fetchSkillIcon } from './icons.js';
import { normalizeMarkdown, slugify, stableJson } from './model.js';

const STATE_FILE = '.shiori/generated-skills.json';
const GENERATED_PLUGIN_PREFIX = 'shiori-';
const AGGREGATE_PLUGIN_NAME = 'shiori';

export async function generateSkills(documents, taggedIds, config) {
  const tagged = [...taggedIds]
    .filter(id => documents.has(id))
    .map(id => documents.get(id))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  const skills = assignSkillNames(tagged);
  await removePreviousGeneratedFiles(config.repositoryRoot);
  const generatedFiles = [];
  const pluginRoot = `${config.pluginDirectory}/${AGGREGATE_PLUGIN_NAME}`;
  let pluginIcon = null;

  for (const skill of skills) {
    const iconUrl = skill.document.properties?.[config.skillIconProperty] ?? null;
    if (!pluginIcon && iconUrl) {
      try {
        const icon = await fetchSkillIcon(iconUrl, config);
        if (icon) {
          const relativePath = `assets/icon.${icon.extension}`;
          const repositoryPath = `${pluginRoot}/${relativePath}`;
          pluginIcon = {
            relativePath,
            repositoryPath,
            publicUrl: config.repository ? rawGitHubUrl(config.repository, repositoryPath) : undefined
          };
          await writeGeneratedBuffer(config.repositoryRoot, repositoryPath, icon.bytes, generatedFiles);
        }
      } catch (error) {
        console.warn(`::warning::Unable to download the optional Shiori plugin icon from '${skill.document.title}'; continuing without it. ${error.message}`);
      }
    }
    const skillMd = renderSkill(skill);
    const reference = renderReference(skill.document);
    for (const root of projectSkillRoots(config)) {
      await writeGenerated(config.repositoryRoot, `${root}/${skill.name}/SKILL.md`, skillMd, generatedFiles);
      await writeGenerated(config.repositoryRoot, `${root}/${skill.name}/references/source.md`, reference, generatedFiles);
    }

    await writeGenerated(config.repositoryRoot, `${pluginRoot}/skills/${skill.name}/SKILL.md`, skillMd, generatedFiles);
    await writeGenerated(config.repositoryRoot, `${pluginRoot}/skills/${skill.name}/references/source.md`, reference, generatedFiles);
  }

  const plugin = { name: AGGREGATE_PLUGIN_NAME, icon: pluginIcon };
  await writeGenerated(config.repositoryRoot, `${pluginRoot}/.codex-plugin/plugin.json`, stableJson(codexPluginManifest(plugin, config)), generatedFiles);
  await writeGenerated(config.repositoryRoot, `${pluginRoot}/.claude-plugin/plugin.json`, stableJson(pluginManifest(config)), generatedFiles);
  await writeGenerated(config.repositoryRoot, `${pluginRoot}/.cursor-plugin/plugin.json`, stableJson(cursorPluginManifest(plugin, config)), generatedFiles);
  await writeGenerated(config.repositoryRoot, `${pluginRoot}/.zcode-plugin/plugin.json`, stableJson(zcodePluginManifest(config)), generatedFiles);
  await writeGenerated(config.repositoryRoot, `${pluginRoot}/.devin-plugin/plugin.json`, stableJson(devinPluginManifest(config)), generatedFiles);
  await updateClaudeMarketplace(plugin, config);
  await updateCursorMarketplace(plugin, config);
  await updateZcodeMarketplace(plugin, config);
  await updateDevinMarketplace(config);
  await writeGenerated(config.repositoryRoot, STATE_FILE, stableJson({ schemaVersion: 2, tag: config.skillTag, iconProperty: config.skillIconProperty || null, files: generatedFiles.sort() }), []);
  return { count: skills.length, skills };
}

function assignSkillNames(documents) {
  const used = new Set();
  return documents.map(document => {
    const base = slugify(document.title).slice(0, 56).replace(/-+$/g, '') || 'untitled';
    let name = base;
    if (used.has(name)) name = `${base.slice(0, 47).replace(/-+$/g, '')}-${slugify(document.id).slice(0, 8)}`;
    used.add(name);
    return { name, document };
  });
}

function projectSkillRoots(config) {
  return [...new Set([
    config.skillsDirectory,
    '.claude/skills',
    '.cursor/skills',
    '.windsurf/skills',
    '.vibe/skills',
    '.devin/skills',
    'skills'
  ].map(path => path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')))];
}

function renderSkill({ name, document }) {
  const description = `Use when a task involves ${document.title} or needs the corresponding AFFiNE-sourced project workflow and constraints.`;
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${document.title}\n\n## When to use\n\nUse this skill when the task touches **${document.title}** or when its project-specific decisions and workflow are relevant.\n\n## Instructions\n\n1. Read [the generated AFFiNE reference](references/source.md) before planning or changing code.\n2. Apply the requirements, invariants, decisions, and workflow from that reference that are relevant to the task.\n3. If current repository behavior or explicit user direction conflicts with the reference, surface the conflict instead of silently choosing one.\n4. AFFiNE is canonical. Do not edit this generated skill or its reference by hand.\n`;
}

function renderReference(document) {
  return `# ${document.title}\n\n> Generated by Shiori from AFFiNE document \`${document.id}\`. AFFiNE is canonical.\n\n${normalizeMarkdown(document.markdown)}`;
}

function pluginManifest(config) {
  return {
    name: AGGREGATE_PLUGIN_NAME,
    version: '1.0.0',
    description: 'AFFiNE-sourced shared coding-agent brain generated by Shiori.',
    author: { name: 'Shiori' },
    repository: config.repository ? `https://github.com/${config.repository}` : undefined
  };
}

function codexPluginManifest(plugin, config) {
  return {
    ...pluginManifest(config),
    skills: './skills/',
    interface: {
      displayName: 'Shiori',
      shortDescription: 'Shared coding-agent knowledge from AFFiNE.',
      longDescription: 'Dragonshorn Studios shared engineering rules and reusable workflows, synchronized from AFFiNE by Shiori.',
      developerName: 'Dragonshorn Studios',
      category: 'Productivity',
      capabilities: ['Instructions'],
      defaultPrompt: [
        'Apply the relevant Shiori engineering guidance.',
        'Use a Shiori workflow skill for this task.'
      ],
      composerIcon: plugin.icon?.relativePath,
      logo: plugin.icon?.relativePath
    }
  };
}

function cursorPluginManifest(plugin, config) {
  return {
    name: AGGREGATE_PLUGIN_NAME,
    displayName: 'Shiori',
    version: '1.0.0',
    description: 'AFFiNE-sourced shared coding-agent brain generated by Shiori.',
    author: { name: 'Shiori' },
    license: 'MIT',
    keywords: ['shiori', 'affine', 'project-knowledge'],
    logo: plugin.icon?.relativePath
  };
}

function zcodePluginManifest(config) {
  return {
    ...pluginManifest(config),
    license: 'MIT',
    keywords: ['shiori', 'affine', 'project-knowledge'],
    skills: 'skills'
  };
}

function devinPluginManifest(config) {
  return {
    ...pluginManifest(config),
    license: 'MIT',
    keywords: ['shiori', 'affine', 'project-knowledge']
  };
}

async function updateClaudeMarketplace(plugin, config) {
  const path = '.claude-plugin/marketplace.json';
  const existing = await readJson(config.repositoryRoot, path, {});
  const plugins = Array.isArray(existing.plugins) ? existing.plugins.filter(item => !isGeneratedPluginSource(item?.source, config)) : [];
  plugins.push(marketplaceEntry(plugin, config));
  const value = {
    ...existing,
    $schema: existing.$schema ?? 'https://anthropic.com/claude-code/marketplace.schema.json',
    name: existing.name ?? config.marketplaceName,
    description: existing.description ?? 'AFFiNE-sourced project skills generated by Shiori.',
    owner: existing.owner ?? { name: config.repository?.split('/')[0] || 'Shiori' },
    plugins
  };
  await writeDirect(config.repositoryRoot, path, stableJson(value));
}

async function updateCursorMarketplace(plugin, config) {
  const path = '.cursor-plugin/marketplace.json';
  const existing = await readJson(config.repositoryRoot, path, {});
  const plugins = Array.isArray(existing.plugins) ? existing.plugins.filter(item => !isGeneratedPluginSource(item?.source, config)) : [];
  plugins.push({ name: plugin.name, source: `./${config.pluginDirectory}/${plugin.name}`, description: 'AFFiNE-sourced shared coding-agent brain generated by Shiori.' });
  const value = {
    ...existing,
    name: existing.name ?? config.marketplaceName,
    owner: existing.owner ?? { name: config.repository?.split('/')[0] || 'Shiori' },
    metadata: existing.metadata ?? { description: 'AFFiNE-sourced project skills generated by Shiori.', version: '1.0.0' },
    plugins
  };
  await writeDirect(config.repositoryRoot, path, stableJson(value));
}

async function updateZcodeMarketplace(plugin, config) {
  const path = 'marketplace.json';
  const existing = await readJson(config.repositoryRoot, path, {});
  const plugins = Array.isArray(existing.plugins) ? existing.plugins.filter(item => !isGeneratedPluginSource(item?.source, config)) : [];
  plugins.push({
    name: plugin.name,
    source: `./${config.pluginDirectory}/${plugin.name}`,
    description: 'AFFiNE-sourced shared coding-agent brain generated by Shiori.',
    version: '1.0.0',
    category: 'productivity',
    tags: ['shiori', 'affine', 'skill'],
    icon: plugin.icon?.publicUrl
  });
  const value = {
    ...existing,
    name: existing.name ?? config.marketplaceName,
    description: existing.description ?? 'AFFiNE-sourced project skills generated by Shiori.',
    plugins
  };
  await writeDirect(config.repositoryRoot, path, stableJson(value));
}

async function updateDevinMarketplace(config) {
  const path = '.devin-plugin/plugin.json';
  const existing = await readJson(config.repositoryRoot, path, {});
  const requiredPlugins = Array.isArray(existing.requiredPlugins)
    ? existing.requiredPlugins.filter(item => !String(item?.path ?? '').startsWith(`${config.pluginDirectory}/${GENERATED_PLUGIN_PREFIX}`))
    : [];
  const value = {
    ...existing,
    name: AGGREGATE_PLUGIN_NAME,
    version: existing.version ?? '1.0.0',
    description: 'AFFiNE-sourced shared coding-agent brain generated by Shiori.',
    author: existing.author ?? { name: config.repository?.split('/')[0] || 'Shiori' },
    requiredPlugins
  };
  await writeDirect(config.repositoryRoot, path, stableJson(value));
}

function marketplaceEntry(plugin, config) {
  return {
    name: plugin.name,
    description: 'AFFiNE-sourced shared coding-agent brain generated by Shiori.',
    author: { name: 'Shiori' },
    source: `./${config.pluginDirectory}/${plugin.name}`,
    category: 'productivity',
    version: '1.0.0'
  };
}

function isGeneratedPluginSource(source, config) {
  const path = String(typeof source === 'string' ? source : source?.path ?? '').replace(/^\.\//, '');
  const base = `${config.pluginDirectory}/${AGGREGATE_PLUGIN_NAME}`;
  return path === base || path.startsWith(`${config.pluginDirectory}/${GENERATED_PLUGIN_PREFIX}`);
}

function rawGitHubUrl(repository, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${repository}/HEAD/${encodedPath}`;
}

async function removePreviousGeneratedFiles(repositoryRoot) {
  const state = await readJson(repositoryRoot, STATE_FILE, { files: [] });
  if (!Array.isArray(state.files)) return;
  for (const file of state.files) {
    if (typeof file !== 'string') continue;
    const target = safeRepositoryPath(repositoryRoot, file);
    await rm(target, { force: true });
  }
}

async function readJson(repositoryRoot, path, fallback) {
  try {
    return JSON.parse(await readFile(safeRepositoryPath(repositoryRoot, path), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Unable to read ${path}: ${error.message}`);
  }
}

async function writeGenerated(repositoryRoot, path, content, list) {
  await writeDirect(repositoryRoot, path, content);
  list.push(path.replaceAll('\\', '/'));
}

async function writeGeneratedBuffer(repositoryRoot, path, content, list) {
  const target = safeRepositoryPath(repositoryRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  list.push(path.replaceAll('\\', '/'));
}

async function writeDirect(repositoryRoot, path, content) {
  const target = safeRepositoryPath(repositoryRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function safeRepositoryPath(repositoryRoot, requested) {
  if (!requested || isAbsolute(requested)) throw new Error('Generated skill paths must be non-empty and repository-relative.');
  const root = resolve(repositoryRoot);
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Generated skill path escapes the repository: ${requested}`);
  return target;
}
