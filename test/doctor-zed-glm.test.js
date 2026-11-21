import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { installSupportFiles } from '../src/install-support.js';
import {
  agentsSkill,
  baseDoctorEnv,
  checkoutSkills,
  claudeSkill,
  isWindows,
  makeUpstreamRepo,
  plantOutwardSkillsDir,
  runDoctor,
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

async function assertLink(path, expectedTarget) {
  const { readlinkSync, lstatSync } = await import('node:fs');
  if (isWindows) {
    const { samePath, skillLinkTarget } = await import('./doctor-fixtures.js');
    assert.equal(samePath(skillLinkTarget(path), expectedTarget), true);
    return;
  }
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(readlinkSync(path), expectedTarget);
}

test('generated doctors include zed and glm from the host map; ZCode stays manual', () => {
  const files = installSupportFiles({ repository: 'example/project', marketplaceName: 'shiori-knowledge' });
  const sh = files.get('scripts/shiori-doctor.sh');
  const ps1 = files.get('scripts/shiori-doctor.ps1');
  const guide = files.get('AGENT-SETUP.md');
  assert.match(sh, /zed\) has_command zed \|\| has_home '\.config\/zed'/);
  assert.match(sh, /glm\|glm-acp\) has_command glm-acp-agent/);
  assert.match(sh, /external_agents\/registry\/npx\/glm-acp-agent/);
  assert.match(guide, /\| zed \|/);
  assert.match(guide, /\| glm \|/);
  assert.match(guide, /Settings -> Plugins -> Create -> Add marketplace/);
  assert.doesNotMatch(sh, /install:zcode/);
  assert.doesNotMatch(ps1, /install:zcode/);
  assert.match(ps1, /Skipping ' \+ \$Target \+ ': Windows support is not available/);
});

test('--install zed links skills into ~/.agents/skills only', { skip: isWindows }, async () => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { install: ['zed'] }, { home, env, kind: 'sh' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  await assertLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  await assertLink(agentsSkill(home, 'beta'), checkoutSkills(home, 'beta'));
  assert.equal(existsSync(join(home, '.config/zed/skills')), false);
  assert.equal(existsSync(join(home, '.zed')), false);
  const again = runDoctor(workDir, { install: ['zed'] }, { home, env, kind: 'sh' });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already current/);
});

test('zed is detected from ~/.config/zed without a binary', { skip: isWindows }, async () => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.config/zed'), { recursive: true });
  const result = runDoctor(workDir, { rest: [] }, { home, env, kind: 'sh' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Zed\s+detected/);
  assert.doesNotMatch(result.stdout, /glm-acp-agent\s+detected/);
});

test('--install glm links into ~/.claude/skills when glm-acp-agent is a file', { skip: isWindows }, async () => {
  const { workDir, home, env, binDir } = await setupDoctor();
  const log = join(binDir, 'glm-spawn.log');
  await writeFile(join(binDir, 'glm-acp-agent'), `#!/bin/sh\nprintf 'spawned %s\\n' "$*" >> "${log}"\nexit 0\n`, { mode: 0o755 });
  const result = runDoctor(workDir, { install: ['glm'] }, { home, env, kind: 'sh' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  await assertLink(claudeSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assert.equal(existsSync(join(home, '.agents/skills/alpha')), false);
  assert.equal(existsSync(log), false);
  const managed = await readFile(join(home, '.local/state/shiori/managed-claude-skills'), 'utf8');
  assert.match(managed, /^alpha$/m);
});

test('glm detection uses the npx registry file and never a Zed directory alone', { skip: isWindows }, async () => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.config/zed'), { recursive: true });
  await mkdir(join(home, '.local/share/zed'), { recursive: true });
  const readonly = runDoctor(workDir, { rest: [] }, { home, env, kind: 'sh' });
  assert.equal(readonly.status, 0, readonly.stderr);
  assert.doesNotMatch(readonly.stdout, /glm-acp-agent\s+detected/);

  const agentPath = join(home, '.local/share/zed/external_agents/registry/npx/glm-acp-agent/node_modules/.bin/glm-acp-agent');
  await mkdir(dirname(agentPath), { recursive: true });
  await writeFile(agentPath, '#!/bin/sh\necho spawned >> /tmp/glm-should-not-run\n', { mode: 0o755 });
  const detected = runDoctor(workDir, { rest: [] }, { home, env, kind: 'sh' });
  assert.equal(detected.status, 0, detected.stderr);
  assert.match(detected.stdout, /glm-acp-agent\s+detected/);
  assert.equal(existsSync('/tmp/glm-should-not-run'), false);
});

test('--install claude glm shares one ~/.claude/skills sync', { skip: isWindows }, async () => {
  const { workDir, home, env, binDir } = await setupDoctor();
  await writeFile(join(binDir, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = runDoctor(workDir, { install: ['claude', 'glm'] }, { home, env, kind: 'sh' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  await assertLink(claudeSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  const managed = (await readFile(join(home, '.local/state/shiori/managed-claude-skills'), 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual([...managed].sort(), ['alpha', 'beta']);
  const recorded = await readFile(join(home, '.local/state/shiori/installed-hosts'), 'utf8');
  assert.match(recorded, /^claude$/m);
  assert.match(recorded, /^glm$/m);
});

test('glm alias glm-acp is accepted', { skip: isWindows }, async () => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { install: ['glm-acp'] }, { home, env, kind: 'sh' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  await assertLink(claudeSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  const recorded = await readFile(join(home, '.local/state/shiori/installed-hosts'), 'utf8');
  assert.match(recorded, /^glm$/m);
});

test('foreign skill in ~/.claude/skills survives glm install', { skip: isWindows }, async () => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.claude/skills/alpha'), { recursive: true });
  await writeFile(join(home, '.claude/skills/alpha/SKILL.md'), '# keep\n');
  const result = runDoctor(workDir, { install: ['glm'] }, { home, env, kind: 'sh' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Warning: skipping skill alpha/);
  assert.equal(await readFile(join(home, '.claude/skills/alpha/SKILL.md'), 'utf8'), '# keep\n');
  await assertLink(claudeSkill(home, 'beta'), checkoutSkills(home, 'beta'));
});

test('outward-pointing claude skills dir is refused for glm', { skip: isWindows }, async () => {
  const { workDir, home, env } = await setupDoctor();
  await plantOutwardSkillsDir(home, '.claude/skills');
  const result = runDoctor(workDir, { install: ['glm'] }, { home, env, kind: 'sh' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /leaves HOME/i);
  assert.equal(existsSync(claudeSkill(home, 'alpha')), false);
});

test('PowerShell doctor skips zed and glm with one log line', async () => {
  const { workDir, home, env } = await setupDoctor();
  const zed = runDoctor(workDir, { install: ['zed'] }, { home, env, kind: 'ps1' });
  assert.match(zed.stderr, /Skipping zed: Windows support is not available/);
  assert.equal((zed.stderr.match(/Skipping zed:/g) || []).length, 1);
  assert.equal(existsSync(join(home, '.agents/skills')), false);
  const glm = runDoctor(workDir, { install: ['glm'] }, { home, env, kind: 'ps1' });
  assert.match(glm.stderr, /Skipping glm: Windows support is not available/);
  assert.equal(existsSync(join(home, '.claude/skills')), false);
});
