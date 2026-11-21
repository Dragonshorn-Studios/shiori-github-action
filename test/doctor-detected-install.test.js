import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { installSupportFiles } from '../src/install-support.js';
import {
  agentsSkill,
  baseDoctorEnv,
  checkoutSkills,
  forEachDoctorKind,
  isWindows,
  makeUpstreamRepo,
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

async function recordedHosts(home) {
  try {
    return (await readFile(join(home, '.local/state/shiori/installed-hosts'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function assertOurLink(path, expectedTarget) {
  assert.equal(existsSync(path), true, `missing skill link ${path}`);
}

function undetectedHostPaths(home) {
  return [
    join(home, '.vibe'),
    join(home, '.minimax'),
    join(home, '.codex'),
    join(home, '.claude'),
    join(home, '.config/opencode'),
    join(home, '.config/devin'),
    join(home, '.devin'),
    join(home, '.config/zed'),
    join(home, '.local/share/zed'),
    join(home, '.windsurf')
  ];
}

function pathWithoutNode(binDir) {
  const nodeDir = dirname(process.execPath);
  const candidates = isWindows
    ? [binDir, ...String(process.env.PATH || '').split(delimiter)]
    : [binDir, '/usr/bin', '/bin'];
  return candidates.filter(dir => {
    if (!dir || dir === nodeDir) return false;
    return !existsSync(join(dir, isWindows ? 'node.exe' : 'node'));
  }).join(delimiter);
}

test('generated doctors treat a missing host list as every detected installable host', () => {
  const files = installSupportFiles({ repository: 'example/project', marketplaceName: 'shiori-knowledge' });
  const sh = files.get('scripts/shiori-doctor.sh');
  const ps1 = files.get('scripts/shiori-doctor.ps1');
  const guide = files.get('AGENT-SETUP.md');
  assert.match(sh, /select_detected_hosts/);
  assert.match(sh, /No installable hosts detected/);
  assert.doesNotMatch(sh, /Pass at least one installer/);
  assert.doesNotMatch(sh, /No recorded Shiori installations to update/);
  assert.doesNotMatch(sh, /Detected locally but not recorded/);
  assert.match(ps1, /No installable hosts detected/);
  assert.doesNotMatch(ps1, /Pass at least one installer/);
  assert.doesNotMatch(ps1, /No recorded Shiori installations to update/);
  assert.match(guide, /with no host names sets up every locally detected installable host/);
  assert.match(guide, /A bare `--update` \(or `SHIORI_UPDATE=all`\) sets up every host the doctor currently detects/);
  assert.match(guide, /cloud-capable status alone is not enough/);
});

forEachDoctorKind('bare --install on a Cursor-only home installs only Cursor', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.cursor'), { recursive: true });
  const result = runDoctor(workDir, { install: [] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.doesNotMatch(result.stderr + result.stdout, /Pass at least one installer/);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.equal(config.mcpServers['shiori-brain'].command, 'node');
  assert.deepEqual(await recordedHosts(home), ['cursor']);
  assert.equal(existsSync(join(home, '.cursor/skills')), false);
  for (const path of undetectedHostPaths(home)) {
    assert.equal(existsSync(path), false, `unexpected path for undetected host: ${path}`);
  }
});

forEachDoctorKind('bare --update installs detected hosts that were never recorded', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.config/opencode'), { recursive: true });
  const extraHost = kind === 'ps1' ? 'vibe' : 'zed';
  const extraDir = kind === 'ps1' ? '.vibe' : '.config/zed';
  const first = runDoctor(workDir, { install: ['opencode'] }, { home, env, kind });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.deepEqual(await recordedHosts(home), ['opencode']);
  await mkdir(join(home, extraDir), { recursive: true });
  const result = runDoctor(workDir, { update: true }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const recorded = await recordedHosts(home);
  assert.ok(recorded.includes('opencode'), recorded.join(','));
  assert.ok(recorded.includes(extraHost), recorded.join(','));
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assert.equal(existsSync(join(home, '.config/opencode/opencode.jsonc')) || existsSync(join(home, '.config/opencode/opencode.json')), true);
});

forEachDoctorKind('explicit host list takes precedence over detection', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.cursor'), { recursive: true });
  await mkdir(join(home, '.config/opencode'), { recursive: true });
  const result = runDoctor(workDir, { install: ['opencode'] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(await recordedHosts(home), ['opencode']);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
  assert.equal(existsSync(join(home, '.config/opencode/opencode.jsonc')) || existsSync(join(home, '.config/opencode/opencode.json')), true);
  const namedUpdate = runDoctor(workDir, { update: ['opencode'] }, { home, env, kind });
  assert.equal(namedUpdate.status, 0, namedUpdate.stderr + namedUpdate.stdout);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
});

forEachDoctorKind('bare --install does not select cloud-capable Devin without a local CLI or config', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.cursor'), { recursive: true });
  const result = runDoctor(workDir, { install: [] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(join(home, '.config/devin')), false);
  assert.equal(existsSync(join(home, '.devin')), false);
  assert.ok(!(await recordedHosts(home)).includes('devin'));
  assert.match(result.stdout, /cloud-capable/);
});

forEachDoctorKind('bare --install with no detected hosts writes nothing and errors on stderr', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { install: [] }, { home, env, kind });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No installable hosts detected/);
  assert.equal(existsSync(join(home, '.local/share/shiori')), false);
  assert.equal(existsSync(join(home, '.local/state/shiori')), false);
  assert.equal(existsSync(join(home, '.agents')), false);
  assert.equal(existsSync(join(home, '.cursor')), false);
});

forEachDoctorKind('a host that cannot be installed is skipped with a warning and a non-zero exit', async (_t, kind) => {
  const { workDir, home, env, binDir } = await setupDoctor();
  await mkdir(join(home, '.cursor'), { recursive: true });
  await mkdir(join(home, '.minimax'), { recursive: true });
  const result = runDoctor(workDir, { install: [] }, {
    home,
    env: { ...env, PATH: pathWithoutNode(binDir) },
    kind
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Warning: cannot install cursor/);
  assert.match(result.stderr, /continuing with remaining hosts/);
  assertOurLink(agentsSkill(home, 'alpha'), checkoutSkills(home, 'alpha'));
  assert.deepEqual(await recordedHosts(home), ['mcode']);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
});

forEachDoctorKind('read-only doctor on a detected Cursor home still writes nothing', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.cursor'), { recursive: true });
  const result = runDoctor(workDir, { rest: [] }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(home, '.agents')), false);
  assert.equal(existsSync(join(home, '.local/share/shiori')), false);
  assert.equal(existsSync(join(home, '.local/state/shiori')), false);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);
});
