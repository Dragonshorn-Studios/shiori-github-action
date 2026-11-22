import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DOCTOR_HOSTS,
  SKILL_DESTINATIONS,
  installSupportFiles,
  installableDoctorHosts
} from '../src/install-support.js';
import {
  ARCHIVE_URL,
  MARKETPLACE,
  PWSH,
  REPOSITORY,
  SKIP_NO_WINDOWS_RUNNER,
  agentsSkill,
  baseDoctorEnv,
  checkoutSkills,
  claudeSkill,
  forEachDoctorKind,
  git,
  isWindows,
  makeUpstreamRepo,
  plantDanglingSkillLink,
  plantLeftoverSkillFile,
  plantLeftoverSkillFileLink,
  plantLeftoverSkillJunction,
  plantLeftoverSkillLink,
  plantOutwardJunction,
  plantOutwardSymlink,
  runDoctor,
  samePath,
  skillLinkTarget,
  writeDoctorTree,
  writeFakeGit
} from './doctor-fixtures.js';

async function setupDoctor(options = {}) {
  const workDir = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const upstream = options.upstream || await makeUpstreamRepo(options);
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(workDir, options);
  const env = baseDoctorEnv(home, { binDir, gitEnv: gitVars, extra: options.env });
  return { workDir, home, binDir, upstream, env };
}

function assertOurLink(path, expectedTarget) {
  assert.equal(existsSync(path), true, `missing skill link ${path}`);
  assert.equal(samePath(skillLinkTarget(path), expectedTarget), true, `unexpected link target for ${path}`);
}

function isDirectoryNotLink(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return false;
  return stat.isDirectory();
}

function assertPathGone(path, message) {
  try {
    lstatSync(path);
    assert.fail(message || `expected missing path: ${path}`);
  } catch (error) {
    assert.equal(error.code, 'ENOENT', message || `expected missing path: ${path}`);
  }
}

test('one host map generates sh, ps1, and the guide host table', () => {
  const files = installSupportFiles({ repository: REPOSITORY, marketplaceName: MARKETPLACE });
  const sh = files.get('scripts/shiori-doctor.sh');
  const ps1 = files.get('scripts/shiori-doctor.ps1');
  const guide = files.get('AGENT-SETUP.md');
  assert.match(sh, /sync_skills_dest/);
  assert.match(ps1, /Sync-SkillsDest/);
  assert.match(ps1, /\[IO\.Directory\]::Delete/);
  assert.match(ps1, /\[IO\.File\]::Delete/);
  assert.match(ps1, /FileAttributes\]::ReparsePoint/);
  assert.equal([...ps1.matchAll(/\[IO\.Directory\]::Delete/g)].length, 2);
  assert.match(ps1, /\$LeftoverPath = \$_\.FullName/);
  assert.match(ps1, /could not remove leftover skill temp \$LeftoverPath/);
  assert.doesNotMatch(ps1, /could not remove leftover skill temp \$\(\$_\.FullName\)/);
  assert.match(ps1, /could not remove obsolete skill link \$OldTarget/);
  assert.doesNotMatch(ps1, /Remove-Item/);
  assert.equal(SKILL_DESTINATIONS.agents.homePath, '.agents/skills');
  assert.equal(SKILL_DESTINATIONS.claude.homePath, '.claude/skills');
  for (const host of installableDoctorHosts()) {
    assert.match(sh, new RegExp(`\\b${host.id}\\b`));
    assert.match(ps1, new RegExp(`\\b${host.id}\\b`));
    assert.match(guide, new RegExp(`\\| ${host.guideName} \\|`));
  }
  assert.match(sh, /agents_skills_selected='true'/);
  assert.match(sh, /claude_skills_selected='true'/);
  assert.match(sh, /claude_skills_root=/);
  assert.match(ps1, /ClaudeSkillsRoot/);
  assert.doesNotMatch(sh, /codex plugin marketplace add /);
  assert.doesNotMatch(sh, /codex plugin add /);
  assert.doesNotMatch(sh, /claude plugin marketplace add /);
  assert.doesNotMatch(sh, /claude plugin install --scope user --yes/);
  assert.doesNotMatch(ps1, /Install-CodexPlugin/);
  assert.doesNotMatch(ps1, /Install-ClaudePlugin/);
  assert.match(sh, /codex plugin remove shiori@/);
  assert.match(sh, /claude plugin uninstall shiori@/);
  assert.match(ps1, /codex plugin remove shiori@/);
  assert.match(ps1, /claude plugin uninstall shiori@/);
  assert.equal(DOCTOR_HOSTS.some(host => host.id === 'zcode' && !host.installable), true);
  assert.doesNotMatch(sh, /--install zcode/);
  assert.doesNotMatch(ps1, /-Install zcode/);
});

test('pwsh is available for ps1 doctor tests', () => {
  assert.ok(PWSH, 'pwsh must be on PATH so ubuntu-latest can run generated shiori-doctor.ps1');
});

forEachDoctorKind('read-only doctor writes nothing', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const before = await readFile(join(workDir, 'scripts/shiori-doctor.sh'), 'utf8').catch(() => '');
  const result = runDoctor(workDir, { rest: [] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(home, '.agents')), false);
  assert.equal(existsSync(join(home, '.claude')), false);
  assert.equal(existsSync(join(home, '.local/share/shiori')), false);
  assert.equal(existsSync(join(home, '.local/state/shiori')), false);
  assert.equal(existsSync(join(home, '.cursor')), false);
  void before;
});

forEachDoctorKind('--install mcode links skills only into ~/.agents/skills', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assertOurLink(agentsSkill(home, 'beta'), checkoutSkills(home, 'beta'));
  assert.equal(existsSync(join(home, '.vibe')), false);
  assert.equal(existsSync(join(home, '.claude/skills')), false);
  assert.equal(existsSync(join(home, '.cursor/skills')), false);
  assert.equal(existsSync(join(home, '.minimax')), false);
  const managed = await readFile(join(home, '.local/state/shiori/managed-skills'), 'utf8');
  assert.match(managed, /^alpha$/m);
  assert.match(managed, /^beta$/m);
  const recorded = await readFile(join(home, '.local/state/shiori/installed-hosts'), 'utf8');
  assert.match(recorded, /^mcode$/m);
});

forEachDoctorKind('--install claude links skills only into ~/.claude/skills and does not run plugin CLIs', async (_t, kind) => {
  const { workDir, home, env, binDir } = await setupDoctor();
  const log = join(binDir, 'plugin-log.txt');
  await writeFile(join(binDir, isWindows ? 'claude.cmd' : 'claude'), isWindows
    ? `@echo off\r\necho invoked %*>> "${log}"\r\nexit /b 1\r\n`
    : `#!/bin/sh\nprintf 'invoked %s\\n' "$*" >> "${log}"\nexit 1\n`, { mode: 0o755 });
  const result = runDoctor(workDir, { install: ['claude'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assertOurLink(claudeSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assertOurLink(claudeSkill(home, 'beta'), checkoutSkills(home, 'beta'));
  assert.equal(existsSync(join(home, '.agents/skills/alpha')), false);
  assert.equal(existsSync(join(home, '.claude/plugins')), false);
  const managed = await readFile(join(home, '.local/state/shiori/managed-claude-skills'), 'utf8');
  assert.match(managed, /^alpha$/m);
  if (existsSync(log)) {
    const invoked = await readFile(log, 'utf8');
    assert.doesNotMatch(invoked, /plugin marketplace add/);
    assert.doesNotMatch(invoked, /plugin install/);
  }
});

forEachDoctorKind('--install codex joins ~/.agents/skills and does not run plugin CLIs', async (_t, kind) => {
  const { workDir, home, env, binDir } = await setupDoctor();
  const log = join(binDir, 'codex-log.txt');
  await writeFile(join(binDir, isWindows ? 'codex.cmd' : 'codex'), isWindows
    ? `@echo off\r\necho invoked %*>> "${log}"\r\nexit /b 1\r\n`
    : `#!/bin/sh\nprintf 'invoked %s\\n' "$*" >> "${log}"\nexit 1\n`, { mode: 0o755 });
  const result = runDoctor(workDir, { install: ['codex'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assert.equal(existsSync(join(home, '.codex/skills')), false);
  if (existsSync(log)) {
    const invoked = await readFile(log, 'utf8');
    assert.doesNotMatch(invoked, /plugin marketplace add/);
    assert.doesNotMatch(invoked, /plugin add/);
  }
});

forEachDoctorKind('--install cursor writes MCP and joins ~/.agents/skills without ~/.cursor/skills', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { install: ['cursor'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assert.equal(existsSync(join(home, '.cursor/skills')), false);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.equal(config.mcpServers['shiori-brain'].command, 'node');
  assert.equal(config.mcpServers['shiori-brain'].env.SHIORI_BRAIN_BASE_URL, ARCHIVE_URL);
});

forEachDoctorKind('two hosts that share ~/.agents/skills sync once', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { install: ['opencode', 'mcode'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assertOurLink(agentsSkill(home, 'beta'), checkoutSkills(home, 'beta'));
  const managed = (await readFile(join(home, '.local/state/shiori/managed-skills'), 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual([...managed].sort(), ['alpha', 'beta']);
  const recorded = await readFile(join(home, '.local/state/shiori/installed-hosts'), 'utf8');
  assert.match(recorded, /^opencode$/m);
  assert.match(recorded, /^mcode$/m);
});

forEachDoctorKind('foreign same-name skill survives install and update with one stderr warning', async (_t, kind) => {
  const { workDir, home, env, binDir } = await setupDoctor();
  await writeFile(join(binDir, isWindows ? 'claude.cmd' : 'claude'), isWindows
    ? '@echo off\r\nexit /b 1\r\n'
    : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await mkdir(join(home, '.agents/skills/alpha'), { recursive: true });
  await writeFile(join(home, '.agents/skills/alpha/SKILL.md'), '# keep me\n');
  await mkdir(join(home, '.claude/skills/alpha'), { recursive: true });
  await writeFile(join(home, '.claude/skills/alpha/SKILL.md'), '# claude keep me\n');
  const first = runDoctor(workDir, { install: ['vibe'] }, { home, env, kind });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.match(first.stderr, /Warning: skipping skill alpha/);
  assert.equal((first.stderr.match(/skipping skill alpha/g) || []).length, 1);
  assert.equal(isDirectoryNotLink(join(home, '.agents/skills/alpha')), true);
  assert.equal(await readFile(join(home, '.agents/skills/alpha/SKILL.md'), 'utf8'), '# keep me\n');
  assertOurLink(agentsSkill(home, 'beta'), checkoutSkills(home, 'beta'));
  const second = runDoctor(workDir, { update: ['vibe'] }, { home, env, kind });
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.match(second.stderr, /Warning: skipping skill alpha/);
  assert.equal(isDirectoryNotLink(join(home, '.agents/skills/alpha')), true);
  assert.equal(await readFile(join(home, '.agents/skills/alpha/SKILL.md'), 'utf8'), '# keep me\n');

  const claude = runDoctor(workDir, { install: ['claude'] }, { home, env, kind });
  assert.equal(claude.status, 0, claude.stderr + claude.stdout);
  assert.match(claude.stderr, /Warning: skipping skill alpha/);
  assert.equal(isDirectoryNotLink(join(home, '.claude/skills/alpha')), true);
  assert.equal(await readFile(join(home, '.claude/skills/alpha/SKILL.md'), 'utf8'), '# claude keep me\n');
  assertOurLink(claudeSkill(home, 'beta'), checkoutSkills(home, 'beta'));
});

forEachDoctorKind('update/dedupe removes only marked entries', async (_t, kind) => {
  const { workDir, home, env, upstream } = await setupDoctor();
  const first = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(first.status, 0, first.stderr);
  await mkdir(join(home, '.agents/skills/foreign'), { recursive: true });
  await writeFile(join(home, '.agents/skills/foreign/SKILL.md'), '# foreign\n');
  await rm(join(upstream, 'skills/beta'), { recursive: true, force: true });
  git(['add', '-A'], { cwd: upstream });
  git(['commit', '-m', 'drop beta'], { cwd: upstream });
  const second = runDoctor(workDir, { update: ['mcode'] }, { home, env, kind });
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assertPathGone(agentsSkill(home, 'beta'), 'dropped dest skill link should be gone');
  assert.equal(existsSync(join(home, '.agents/skills/foreign/SKILL.md')), true);
  const managed = await readFile(join(home, '.local/state/shiori/managed-skills'), 'utf8');
  assert.match(managed, /^alpha$/m);
  assert.doesNotMatch(managed, /^beta$/m);
  assert.doesNotMatch(managed, /^foreign$/m);
});

forEachDoctorKind('leftover temp skill link is cleaned up and replaced with a complete link', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const destRoot = join(home, '.agents/skills');
  const { leftover, leftoverTarget } = await plantLeftoverSkillLink(destRoot);
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(leftover), false);
  assert.equal(await readFile(join(leftoverTarget, 'sentinel'), 'utf8'), 'keep');
  assert.equal(existsSync(leftoverTarget), true);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assertOurLink(agentsSkill(home, 'beta'), checkoutSkills(home, 'beta'));
});

test('ps1 leftover skill symlink is removed without touching its target (ubuntu stand-in)', {
  skip: PWSH ? false : 'pwsh must be on PATH so ubuntu-latest can run generated shiori-doctor.ps1'
}, async () => {
  const { workDir, home, env } = await setupDoctor();
  const destRoot = join(home, '.agents/skills');
  const { leftover, leftoverTarget } = await plantLeftoverSkillLink(destRoot);
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(leftover), false);
  assert.equal(lstatSync(leftoverTarget).isDirectory(), true);
  assert.equal(await readFile(join(leftoverTarget, 'sentinel'), 'utf8'), 'keep');
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
});

test('ps1 leftover skill junction is removed without touching its target', {
  skip: isWindows ? false : SKIP_NO_WINDOWS_RUNNER
}, async () => {
  const { workDir, home, env } = await setupDoctor();
  const destRoot = join(home, '.agents/skills');
  const { leftover, leftoverTarget } = await plantLeftoverSkillJunction(destRoot);
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(leftover), false);
  assert.equal(lstatSync(leftoverTarget).isDirectory(), true);
  assert.equal(await readFile(join(leftoverTarget, 'sentinel'), 'utf8'), 'keep');
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
});

test('ps1 obsolete managed skill junction is removed without touching a sibling target', {
  skip: isWindows ? false : SKIP_NO_WINDOWS_RUNNER
}, async () => {
  const { workDir, home, env, upstream } = await setupDoctor();
  const first = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const destRoot = join(home, '.agents/skills');
  const sibling = join(destRoot, 'keep-me');
  await mkdir(sibling, { recursive: true });
  await writeFile(join(sibling, 'sentinel'), 'keep-sibling');
  await rm(join(upstream, 'skills/beta'), { recursive: true, force: true });
  git(['add', '-A'], { cwd: upstream });
  git(['commit', '-m', 'drop beta'], { cwd: upstream });
  const second = runDoctor(workDir, { update: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assertPathGone(agentsSkill(home, 'beta'), 'obsolete dest junction should be gone');
  assert.equal(isDirectoryNotLink(sibling), true);
  assert.equal(await readFile(join(sibling, 'sentinel'), 'utf8'), 'keep-sibling');
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
});

test('ps1 leftover real directory under the temp prefix is not deleted', {
  skip: PWSH ? false : 'pwsh must be on PATH so ubuntu-latest can run generated shiori-doctor.ps1'
}, async () => {
  const { workDir, home, env } = await setupDoctor();
  const leftoverDir = join(home, '.agents/skills', '.shiori-link-keepdir');
  await mkdir(leftoverDir, { recursive: true });
  await writeFile(join(leftoverDir, 'sentinel'), 'keep-dir');
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stderr, /skipping leftover skill temp/);
  assert.equal(isDirectoryNotLink(leftoverDir), true);
  assert.equal(await readFile(join(leftoverDir, 'sentinel'), 'utf8'), 'keep-dir');
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
});

test('ps1 leftover skill temp that cannot be removed warns and install continues', {
  skip: isWindows
    ? 'NTFS ignores POSIX chmod for deletes'
    : (PWSH ? false : 'pwsh must be on PATH so ubuntu-latest can run generated shiori-doctor.ps1')
}, async () => {
  const { workDir, home, env } = await setupDoctor();
  const first = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const destRoot = join(home, '.agents/skills');
  const { leftover } = await plantLeftoverSkillFile(destRoot);
  await chmod(destRoot, 0o555);
  try {
    const second = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.match(second.stderr, /could not remove leftover skill temp/);
    assert.equal(second.stderr.includes(leftover), true, second.stderr);
    assert.equal(existsSync(leftover), true);
    assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  } finally {
    await chmod(destRoot, 0o755);
  }
});

test('ps1 obsolete skill link that cannot be removed warns and install continues', {
  skip: isWindows
    ? 'NTFS ignores POSIX chmod for deletes'
    : (PWSH ? false : 'pwsh must be on PATH so ubuntu-latest can run generated shiori-doctor.ps1')
}, async () => {
  const { workDir, home, env } = await setupDoctor();
  const first = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const destRoot = join(home, '.agents/skills');
  const staleLink = await plantDanglingSkillLink(destRoot, checkoutSkills(home, 'stale'));
  const managedPath = join(home, '.local/state/shiori/managed-skills');
  const managed = await readFile(managedPath, 'utf8');
  await writeFile(managedPath, `${managed.trimEnd()}\nstale\n`);
  await chmod(destRoot, 0o555);
  try {
    const second = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.match(second.stderr, /could not remove obsolete skill link/);
    assert.equal(second.stderr.includes(staleLink), true, second.stderr);
    assert.equal(lstatSync(staleLink).isSymbolicLink(), true);
    assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  } finally {
    await chmod(destRoot, 0o755);
  }
});

forEachDoctorKind('leftover temp skill file is removed and install still succeeds', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const destRoot = join(home, '.agents/skills');
  const { leftover } = await plantLeftoverSkillFile(destRoot);
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(leftover), false);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assertOurLink(agentsSkill(home, 'beta'), checkoutSkills(home, 'beta'));
});

forEachDoctorKind('leftover temp skill file link is removed without touching its target', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const destRoot = join(home, '.agents/skills');
  const { leftover, leftoverTarget } = await plantLeftoverSkillFileLink(destRoot);
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(leftover), false);
  assert.equal(lstatSync(leftoverTarget).isFile(), true);
  assert.equal(await readFile(leftoverTarget, 'utf8'), 'keep-file');
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
});

forEachDoctorKind('obsolete managed skill link is removed without touching a sibling target', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const first = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const destRoot = join(home, '.agents/skills');
  const sibling = join(destRoot, 'keep-me');
  await mkdir(sibling, { recursive: true });
  await writeFile(join(sibling, 'sentinel'), 'keep-sibling');
  const staleSource = checkoutSkills(home, 'stale');
  const staleLink = await plantDanglingSkillLink(destRoot, staleSource);
  assert.equal(lstatSync(staleLink).isSymbolicLink(), true);
  const managedPath = join(home, '.local/state/shiori/managed-skills');
  const managed = await readFile(managedPath, 'utf8');
  await writeFile(managedPath, `${managed.trimEnd()}\nstale\n`);
  const second = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assertPathGone(staleLink, 'obsolete dest link should be gone');
  assert.equal(isDirectoryNotLink(sibling), true);
  assert.equal(await readFile(join(sibling, 'sentinel'), 'utf8'), 'keep-sibling');
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assertOurLink(agentsSkill(home, 'beta'), checkoutSkills(home, 'beta'));
  const afterManaged = await readFile(managedPath, 'utf8');
  assert.match(afterManaged, /^alpha$/m);
  assert.match(afterManaged, /^beta$/m);
  assert.doesNotMatch(afterManaged, /^stale$/m);
  assert.doesNotMatch(afterManaged, /^keep-me$/m);
});

forEachDoctorKind('replaced managed skill link is not followed into a live sentinel', async (_t, kind) => {
  const { workDir, home, env, upstream } = await setupDoctor();
  const first = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const destRoot = join(home, '.agents/skills');
  await rm(agentsSkill(home, 'beta'), { force: true });
  const { leftover, leftoverTarget } = await plantLeftoverSkillLink(destRoot, { name: 'beta' });
  await rm(join(upstream, 'skills/beta'), { recursive: true, force: true });
  git(['add', '-A'], { cwd: upstream });
  git(['commit', '-m', 'drop beta'], { cwd: upstream });
  const second = runDoctor(workDir, { update: ['mcode'] }, { home, env, kind });
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.equal(lstatSync(leftover).isSymbolicLink(), true);
  assert.equal(lstatSync(leftoverTarget).isDirectory(), true);
  assert.equal(await readFile(join(leftoverTarget, 'sentinel'), 'utf8'), 'keep');
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
});

forEachDoctorKind('outward-pointing skills directory is refused', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const { dest, outside } = await plantOutwardSymlink(home, '.agents/skills');
  await writeFile(join(outside, 'sentinel'), 'no-touch');
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /leaves HOME|symlink that leaves HOME/i);
  assert.equal(existsSync(join(dest, 'alpha')), false);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'no-touch');
  assert.equal(existsSync(join(outside, 'alpha')), false);
});

test('outward-pointing skills directory is refused (junction/reparse point)', {
  skip: isWindows ? false : SKIP_NO_WINDOWS_RUNNER
}, async () => {
  const { workDir, home, env } = await setupDoctor();
  const { dest, outside } = await plantOutwardJunction(home, '.agents/skills');
  await writeFile(join(outside, 'sentinel'), 'no-touch');
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind: 'ps1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /leaves HOME/i);
  assert.equal(existsSync(join(dest, 'alpha')), false);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'no-touch');
  assert.equal(existsSync(join(outside, 'alpha')), false);
});

forEachDoctorKind('missing HOME aborts', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { install: ['mcode'] }, { home, env: { ...env, HOME: '', USERPROFILE: '' }, kind });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /HOME is empty or missing/);
  assert.equal(existsSync(join(home, '.agents')), false);
});

forEachDoctorKind('second consecutive --update reports already current and leaves disk unchanged', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const first = runDoctor(workDir, { install: ['mcode'] }, { home, env, kind });
  assert.equal(first.status, 0, first.stderr);
  const managedPath = join(home, '.local/state/shiori/managed-skills');
  const beforeManaged = await readFile(managedPath, 'utf8');
  const beforeAlpha = skillLinkTarget(agentsSkill(home, 'alpha'));
  const second = runDoctor(workDir, { update: ['mcode'] }, { home, env, kind });
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.match(second.stdout, /already current/);
  assert.equal(await readFile(managedPath, 'utf8'), beforeManaged);
  assert.equal(skillLinkTarget(agentsSkill(home, 'alpha')), beforeAlpha);
});

forEachDoctorKind('legacy Codex plugin fixture is left untouched and prints the official removal command once', async (_t, kind) => {
  const { workDir, home, env, binDir } = await setupDoctor();
  await mkdir(join(home, '.codex'), { recursive: true });
  const config = join(home, '.codex/config.toml');
  const original = `[marketplaces.shiori-knowledge]
url = "https://github.com/${REPOSITORY}"

[plugins."shiori@${MARKETPLACE}"]
enabled = true

[mcp_servers.shiori-brain]
command = "node"
`;
  await writeFile(config, original);
  const log = join(binDir, 'codex-log.txt');
  await writeFile(join(binDir, isWindows ? 'codex.cmd' : 'codex'), isWindows
    ? `@echo off\r\necho invoked %*>> "${log}"\r\nexit /b 1\r\n`
    : `#!/bin/sh\nprintf 'invoked %s\\n' "$*" >> "${log}"\nexit 1\n`, { mode: 0o755 });
  const result = runDoctor(workDir, { install: ['codex'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(await readFile(config, 'utf8'), original);
  const hints = result.stderr.match(/codex plugin remove shiori@shiori-knowledge/g) || [];
  assert.equal(hints.length, 1, result.stderr);
  if (existsSync(log)) assert.doesNotMatch(await readFile(log, 'utf8'), /plugin remove|plugin marketplace add|plugin add /);
});

forEachDoctorKind('legacy Claude plugin fixture is left untouched and prints the official removal command once', async (_t, kind) => {
  const { workDir, home, env, binDir } = await setupDoctor();
  await writeFile(join(binDir, isWindows ? 'claude.cmd' : 'claude'), isWindows
    ? '@echo off\r\nexit /b 1\r\n'
    : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await mkdir(join(home, '.claude/plugins'), { recursive: true });
  const installed = join(home, '.claude/plugins/installed_plugins.json');
  const original = JSON.stringify({
    plugins: [{ id: `shiori@${MARKETPLACE}`, scope: 'user', installPath: '/tmp/plugin', version: '1.0.0' }]
  }, null, 2);
  await writeFile(installed, original);
  await writeFile(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'shiori-knowledge': { source: REPOSITORY } }));
  const result = runDoctor(workDir, { install: ['claude'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(await readFile(installed, 'utf8'), original);
  const hints = result.stderr.match(/claude plugin uninstall shiori@shiori-knowledge --scope user/g) || [];
  assert.equal(hints.length, 1, result.stderr);
});

forEachDoctorKind('marketplace-only Codex config is not treated as an installed plugin', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(join(home, '.codex/config.toml'), `[marketplaces.shiori-knowledge]\nurl = "https://github.com/${REPOSITORY}"\n\n[mcp_servers.shiori-brain]\ncommand = "node"\n`);
  const result = runDoctor(workDir, { install: ['codex'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /codex plugin remove/);
});
