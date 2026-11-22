import { existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, delimiter, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { installSupportFiles } from '../src/install-support.js';

export const isWindows = process.platform === 'win32';
export const SKIP_NO_WINDOWS_RUNNER = 'skipped: no Windows runner';

export function snapshotDoctorStdout(stdout) {
  return String(stdout || '')
    .replaceAll('\r\n', '\n')
    .replace(/[0-9a-f]{40}/gi, '<sha>')
    .replace(/^(detected|not detected): (.*)$/gm, (_match, label, list) => {
      if (list === 'none') return `${label}: none`;
      return `${label}: ${list.split(/[,\s]+/).filter(Boolean).join(', ')}`;
    })
    .replace(/[ \t]+$/gm, '')
    .trim() + '\n';
}

function resolveOnPath(names) {
  for (const name of names) {
    const result = spawnSync(isWindows ? 'where.exe' : 'sh', isWindows ? [name] : ['-c', `command -v ${JSON.stringify(name)}`], {
      encoding: 'utf8',
      env: process.env
    });
    const line = String(result.stdout || '').split(/\r?\n/).find(item => item.trim());
    if (line) return line.trim();
  }
  return null;
}

export const PWSH = resolveOnPath(isWindows ? ['pwsh.exe', 'pwsh', 'powershell.exe'] : ['pwsh']);
export const doctorKind = isWindows ? 'ps1' : 'sh';

export function doctorKinds() {
  const kinds = [];
  if (!isWindows) kinds.push('sh');
  if (PWSH) kinds.push('ps1');
  return kinds;
}

export function forEachDoctorKind(name, fn) {
  for (const kind of doctorKinds()) {
    test(`${name} (${kind})`, async (t) => {
      await fn(t, kind);
    });
  }
}
export const REPOSITORY = 'example/project';
export const MARKETPLACE = 'shiori-knowledge';
export const ARCHIVE_URL = 'https://example.github.io/project/';

function whichGit() {
  const result = spawnSync(isWindows ? 'where.exe' : 'sh', isWindows ? ['git'] : ['-c', 'command -v git'], { encoding: 'utf8' });
  const line = String(result.stdout || '').split(/\r?\n/).find(item => item.trim());
  if (!line) throw new Error('git is required for doctor tests');
  return line.trim();
}

const REAL_GIT = whichGit();

export const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Shiori Test',
  GIT_AUTHOR_EMAIL: 'shiori-test@example.test',
  GIT_COMMITTER_NAME: 'Shiori Test',
  GIT_COMMITTER_EMAIL: 'shiori-test@example.test',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0'
};

function gitEnv(extra = {}) {
  return { ...process.env, ...GIT_IDENTITY, ...extra };
}

export function git(args, opts = {}) {
  return execFileSync(REAL_GIT, args, { encoding: 'utf8', env: gitEnv(opts.env), cwd: opts.cwd, stdio: opts.stdio });
}

export async function writeSkill(root, name) {
  const dir = join(root, 'skills', name);
  await mkdir(join(dir, 'references'), { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`);
  await writeFile(join(dir, 'references', 'source.md'), `# ${name} source\n`);
}

export async function makeUpstreamRepo(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'shiori-upstream-'));
  const files = installSupportFiles({ repository: options.repository || REPOSITORY, marketplaceName: options.marketplace || MARKETPLACE });
  for (const [path, content] of files) {
    if (!path.startsWith('packages/')) continue;
    await mkdir(join(dir, dirname(path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await writeSkill(dir, 'alpha');
  await writeSkill(dir, 'beta');
  git(['init', '-b', 'main'], { cwd: dir });
  git(['add', '.'], { cwd: dir });
  git(['commit', '-m', 'upstream skills'], { cwd: dir });
  return dir;
}

const FAKE_GIT_SOURCE = `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const realGit = process.env.SHIORI_REAL_GIT;
const upstream = process.env.SHIORI_UPSTREAM;
const args = process.argv.slice(2);
function run(argv, extra = {}) {
  const result = spawnSync(realGit, argv, { stdio: extra.stdio || 'inherit', encoding: 'utf8', env: process.env });
  if (typeof extra.status === 'function') return extra.status(result);
  process.exit(result.status ?? 1);
}
let cwdArgs = [];
const rest = [...args];
if (rest[0] === '-C') {
  cwdArgs = ['-C', rest[1]];
  rest.splice(0, 2);
}
if (rest[0] === 'clone') {
  const dest = rest.at(-1);
  const url = rest.at(-2);
  const quiet = rest.includes('-q') || rest.includes('--quiet');
  const clone = spawnSync(realGit, ['clone', ...(quiet ? ['-q'] : []), '--filter=blob:none', '--branch', 'main', upstream, dest], { stdio: 'inherit', env: process.env });
  if (clone.status) process.exit(clone.status);
  const setUrl = spawnSync(realGit, ['-C', dest, 'remote', 'set-url', 'origin', url], { stdio: 'inherit', env: process.env });
  process.exit(setUrl.status ?? 1);
}
if (rest[0] === 'pull') {
  const quiet = rest.includes('-q') || rest.includes('--quiet');
  const fetch = spawnSync(realGit, [...cwdArgs, 'fetch', ...(quiet ? ['-q'] : []), upstream, 'main'], { stdio: 'inherit', env: process.env });
  if (fetch.status) process.exit(fetch.status);
  const merge = spawnSync(realGit, [...cwdArgs, 'merge', ...(quiet ? ['-q'] : []), '--ff-only', 'FETCH_HEAD'], { stdio: 'inherit', env: process.env });
  process.exit(merge.status ?? 1);
}
run(args);
`;

export async function writeFakeGit(binDir, upstream) {
  await mkdir(binDir, { recursive: true });
  const script = join(binDir, 'fake-git.mjs');
  await writeFile(script, FAKE_GIT_SOURCE);
  if (isWindows) {
    await writeFile(join(binDir, 'git.cmd'), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    await writeFile(join(binDir, 'git'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  }
  return { SHIORI_REAL_GIT: REAL_GIT, SHIORI_UPSTREAM: upstream };
}

export async function writeDoctorTree(workDir, options = {}) {
  const files = installSupportFiles({
    repository: options.repository || REPOSITORY,
    marketplaceName: options.marketplace || MARKETPLACE
  });
  for (const [path, content] of files) {
    await mkdir(join(workDir, dirname(path)), { recursive: true });
    await writeFile(join(workDir, path), content, path.endsWith('.sh') ? { mode: 0o755 } : undefined);
  }
  return files;
}

export function doctorPath(env, extra = {}) {
  const nodeDir = dirname(process.execPath);
  const parts = isWindows
    ? [env.binDir, nodeDir, process.env.PATH]
    : [env.binDir, nodeDir, '/usr/bin', '/bin'];
  return [extra.binDir, ...parts].filter(Boolean).join(delimiter);
}

export function baseDoctorEnv(home, { binDir, gitEnv: gitVars = {}, extra = {} } = {}) {
  const env = {
    ...process.env,
    ...GIT_IDENTITY,
    ...gitVars,
    HOME: home,
    USERPROFILE: home,
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    POWERSHELL_UPDATECHECK: 'Off',
    SHIORI_BRAIN_BASE_URL: ARCHIVE_URL,
    PATH: doctorPath({ binDir }),
    ...extra
  };
  delete env.SHIORI_INSTALL;
  delete env.SHIORI_UPDATE;
  delete env.SHIORI_CHECKOUT;
  return env;
}

function shArgs(operation) {
  const prefix = operation.verbose ? ['--verbose'] : [];
  if (operation.help) return [...prefix, '--help'];
  if (operation.install === true || (Array.isArray(operation.install) && operation.install.length === 0)) {
    return [...prefix, '--install'];
  }
  if (operation.install) return [...prefix, '--install', ...operation.install];
  if (operation.update === true) return [...prefix, '--update'];
  if (Array.isArray(operation.update)) return [...prefix, '--update', ...operation.update];
  if (operation.verbose) return operation.rest ? ['--verbose', ...operation.rest] : ['--verbose'];
  return operation.rest || [];
}

function psArgs(operation) {
  const prefix = operation.verbose ? ['-Verbose'] : [];
  if (operation.help) return [...prefix, '-Help'];
  if (operation.install === true || (Array.isArray(operation.install) && operation.install.length === 0)) {
    return [...prefix, '-Install', 'all'];
  }
  if (operation.install) return [...prefix, '-Install', operation.install.join(',')];
  if (operation.update === true) return [...prefix, '-Update'];
  if (Array.isArray(operation.update)) return [...prefix, '-Update', '-UpdateTargets', operation.update.join(',')];
  if (operation.verbose) return ['-Verbose', ...(operation.rest || [])];
  return operation.rest || [];
}

export function runDoctor(workDir, operation, { kind, home, env, timeout = 30000 } = {}) {
  const resolvedKind = kind || (isWindows ? 'ps1' : 'sh');
  if (resolvedKind === 'ps1') {
    if (!PWSH) throw new Error('pwsh is required to run generated shiori-doctor.ps1 tests');
    const script = join(workDir, 'scripts/shiori-doctor.ps1');
    const args = ['-NoProfile', '-NonInteractive'];
    if (isWindows) args.push('-ExecutionPolicy', 'Bypass');
    args.push('-File', script, ...psArgs(operation));
    const result = spawnSync(PWSH, args, {
      cwd: workDir,
      env,
      encoding: 'utf8',
      timeout,
      windowsHide: true
    });
    return {
      status: result.status,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      error: result.error,
      kind: resolvedKind
    };
  }
  const script = join(workDir, 'scripts/shiori-doctor.sh');
  const result = spawnSync('sh', [script, ...shArgs(operation)], {
    cwd: workDir,
    env,
    encoding: 'utf8',
    timeout,
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error,
    kind: resolvedKind
  };
}

export async function plantOutwardSymlink(home, rel = '.agents/skills') {
  const dest = join(home, rel);
  const outside = await mkdtemp(join(tmpdir(), 'shiori-outside-'));
  await mkdir(dirname(dest), { recursive: true });
  await symlink(outside, dest, 'dir');
  return { dest, outside };
}

export async function plantLeftoverSkillLink(destRoot, options = {}) {
  const leftoverTarget = options.target || await mkdtemp(join(tmpdir(), 'shiori-link-target-'));
  await mkdir(leftoverTarget, { recursive: true });
  await writeFile(join(leftoverTarget, 'sentinel'), 'keep');
  await mkdir(destRoot, { recursive: true });
  const leftover = join(destRoot, options.name || '.shiori-link-leftover');
  await symlink(leftoverTarget, leftover, 'dir');
  return { leftover, leftoverTarget };
}

export async function plantLeftoverSkillFile(destRoot, options = {}) {
  await mkdir(destRoot, { recursive: true });
  const leftover = join(destRoot, options.name || '.shiori-link-leftover-file');
  await writeFile(leftover, options.contents || 'stale-temp');
  return { leftover };
}

export async function plantLeftoverSkillFileLink(destRoot, options = {}) {
  const leftoverTargetDir = options.targetDir || await mkdtemp(join(tmpdir(), 'shiori-file-target-'));
  await mkdir(leftoverTargetDir, { recursive: true });
  const leftoverTarget = options.target || join(leftoverTargetDir, 'sentinel');
  await writeFile(leftoverTarget, 'keep-file');
  await mkdir(destRoot, { recursive: true });
  const leftover = join(destRoot, options.name || '.shiori-link-leftover-file');
  await symlink(leftoverTarget, leftover);
  return { leftover, leftoverTarget };
}

export async function plantDanglingSkillLink(destRoot, expectedTarget, name = 'stale') {
  await mkdir(destRoot, { recursive: true });
  const link = join(destRoot, name);
  await symlink(expectedTarget, link, 'dir');
  return link;
}

export async function plantLeftoverSkillJunction(destRoot, options = {}) {
  if (!isWindows) throw new Error('junctions require Windows');
  const leftoverTarget = options.target || await mkdtemp(join(tmpdir(), 'shiori-link-target-'));
  await mkdir(leftoverTarget, { recursive: true });
  await writeFile(join(leftoverTarget, 'sentinel'), 'keep');
  await mkdir(destRoot, { recursive: true });
  const leftover = join(destRoot, options.name || '.shiori-link-leftover');
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', leftover, leftoverTarget], { encoding: 'utf8' });
  return { leftover, leftoverTarget };
}

export async function plantOutwardJunction(home, rel = '.agents/skills') {
  if (!isWindows) throw new Error('junctions require Windows');
  const dest = join(home, rel);
  const outside = await mkdtemp(join(tmpdir(), 'shiori-outside-'));
  await mkdir(dirname(dest), { recursive: true });
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', dest, outside], { encoding: 'utf8' });
  return { dest, outside };
}

export async function plantOutwardSkillsDir(home, rel = '.agents/skills') {
  return isWindows ? plantOutwardJunction(home, rel) : plantOutwardSymlink(home, rel);
}

export function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink() || Boolean(lstatSync(path).isDirectory && readlinkSync(path));
  } catch {
    return false;
  }
}

export function samePath(left, right) {
  const normalize = (value) => {
    const raw = String(value || '').replaceAll('\\', '/').replace(/\/$/, '');
    try {
      return realpathSync(raw).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    } catch {
      return raw.toLowerCase();
    }
  };
  return normalize(left) === normalize(right);
}

export function skillLinkTarget(path) {
  if (isWindows) {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-Item -LiteralPath '${path.replaceAll("'", "''")}').Target`
    ], { encoding: 'utf8' });
    return String(result.stdout || '').trim();
  }
  return readlinkSync(path);
}

export function checkoutSkills(home, name) {
  return join(home, '.local/share/shiori/shiori-brain/skills', name);
}

export function agentsSkill(home, name) {
  return join(home, '.agents/skills', name);
}

export function claudeSkill(home, name) {
  return join(home, '.claude/skills', name);
}

export async function listNames(dir) {
  try {
    const { readdir } = await import('node:fs/promises');
    return (await readdir(dir)).filter(name => !name.startsWith('.')).sort();
  } catch {
    return [];
  }
}

export { existsSync, join, mkdir, mkdtemp, readFile, rm, symlink, tmpdir, writeFile, pathToFileURL, cp };
