import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { doctorPipeOneLiners, installSupportFiles } from '../src/install-support.js';
import {
  agentsSkill,
  baseDoctorEnv,
  checkoutSkills,
  doctorKinds,
  forEachDoctorKind,
  isWindows,
  makeUpstreamRepo,
  runDoctor,
  snapshotDoctorStdout,
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
  assert.match(guide, /A bare `curl \| sh` \/ `irm \| iex` with no environment variable stays read-only/);
  const lines = doctorPipeOneLiners('example/project');
  assert.ok(guide.indexOf(lines.installAllSh) < guide.indexOf(lines.installNamedSh));
  assert.ok(guide.indexOf(lines.installAllPs1) < guide.indexOf(lines.installNamedPs1));
  assert.match(guide, new RegExp(lines.updateAllSh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(sh, /SHIORI_INSTALL=all sh/);
  assert.match(sh, /SHIORI_UPDATE=all sh/);
  assert.match(sh, /SHIORI_INSTALL=.*codex,claude,cursor/);
  assert.ok(sh.indexOf(lines.installAllSh) < sh.search(/SHIORI_INSTALL=.*codex,claude,cursor/));
  assert.match(ps1, /SHIORI_INSTALL='all'/);
  assert.match(ps1, /SHIORI_UPDATE='all'/);
  assert.ok(ps1.indexOf(lines.installAllSh) < ps1.indexOf(`SHIORI_INSTALL='codex,claude,cursor'`));
});

forEachDoctorKind('doctor --help prints the all pipe one-liner before named hosts', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  const result = runDoctor(workDir, { help: true }, { home, env, kind });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const text = `${result.stdout}\n${result.stderr}`;
  const allIdx = text.search(/SHIORI_INSTALL=all|SHIORI_INSTALL='all'/);
  const namedIdx = text.indexOf("SHIORI_INSTALL='codex,claude,cursor'");
  assert.ok(allIdx >= 0, text);
  assert.ok(namedIdx >= 0, text);
  assert.ok(allIdx < namedIdx);
  assert.match(text, /SHIORI_UPDATE=all|SHIORI_UPDATE='all'/);
  assert.match(text, /read-only/);
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
  assert.doesNotMatch(result.stdout, /^detected:.*\bdevin\b/m);
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

forEachDoctorKind('SHIORI_INSTALL=all matches bare --install', async (_t, kind) => {
  const cli = await setupDoctor();
  const envRun = await setupDoctor();
  await mkdir(join(cli.home, '.cursor'), { recursive: true });
  await mkdir(join(envRun.home, '.cursor'), { recursive: true });
  const fromFlags = runDoctor(cli.workDir, { install: [] }, { home: cli.home, env: cli.env, kind });
  const fromEnv = runDoctor(envRun.workDir, { rest: [] }, {
    home: envRun.home,
    env: { ...envRun.env, SHIORI_INSTALL: 'all' },
    kind
  });
  assert.equal(fromFlags.status, 0, fromFlags.stderr + fromFlags.stdout);
  assert.equal(fromEnv.status, 0, fromEnv.stderr + fromEnv.stdout);
  assert.equal(snapshotDoctorStdout(fromFlags.stdout), snapshotDoctorStdout(fromEnv.stdout));
  assert.deepEqual(await recordedHosts(cli.home), ['cursor']);
  assert.deepEqual(await recordedHosts(envRun.home), ['cursor']);
  assert.equal(existsSync(join(cli.home, '.cursor/mcp.json')), true);
  assert.equal(existsSync(join(envRun.home, '.cursor/mcp.json')), true);
});

forEachDoctorKind('SHIORI_INSTALL=<list> installs only named hosts', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.cursor'), { recursive: true });
  await mkdir(join(home, '.config/opencode'), { recursive: true });
  await mkdir(join(home, '.vibe'), { recursive: true });
  const result = runDoctor(workDir, { rest: [] }, {
    home,
    env: { ...env, SHIORI_INSTALL: 'opencode,cursor' },
    kind
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const recorded = await recordedHosts(home);
  assert.deepEqual([...recorded].sort(), ['cursor', 'opencode']);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), true);
  assert.equal(existsSync(join(home, '.config/opencode/opencode.jsonc')) || existsSync(join(home, '.config/opencode/opencode.json')), true);
  assert.equal(existsSync(join(home, '.vibe/skills')), false);
  assert.ok(!recorded.includes('vibe'));
});

forEachDoctorKind('SHIORI_UPDATE=all matches bare --update', async (_t, kind) => {
  const cli = await setupDoctor();
  const envRun = await setupDoctor();
  for (const setup of [cli, envRun]) {
    await mkdir(join(setup.home, '.config/opencode'), { recursive: true });
    const first = runDoctor(setup.workDir, { install: ['opencode'] }, { home: setup.home, env: setup.env, kind });
    assert.equal(first.status, 0, first.stderr + first.stdout);
    await mkdir(join(setup.home, '.cursor'), { recursive: true });
  }
  const fromFlags = runDoctor(cli.workDir, { update: true }, { home: cli.home, env: cli.env, kind });
  const fromEnv = runDoctor(envRun.workDir, { rest: [] }, {
    home: envRun.home,
    env: { ...envRun.env, SHIORI_UPDATE: 'all' },
    kind
  });
  assert.equal(fromFlags.status, 0, fromFlags.stderr + fromFlags.stdout);
  assert.equal(fromEnv.status, 0, fromEnv.stderr + fromEnv.stdout);
  assert.equal(snapshotDoctorStdout(fromFlags.stdout), snapshotDoctorStdout(fromEnv.stdout));
  const recordedCli = await recordedHosts(cli.home);
  const recordedEnv = await recordedHosts(envRun.home);
  assert.ok(recordedCli.includes('opencode') && recordedCli.includes('cursor'), recordedCli.join(','));
  assert.deepEqual([...recordedCli].sort(), [...recordedEnv].sort());
});

test('SHIORI_INSTALL=all and SHIORI_UPDATE=all match between sh and ps1', async () => {
  const kinds = doctorKinds();
  assert.ok(kinds.includes('sh') && kinds.includes('ps1'), `need sh and ps1, got ${kinds.join(',')}`);
  const results = {};
  for (const kind of kinds) {
    const setup = await setupDoctor();
    await mkdir(join(setup.home, '.cursor'), { recursive: true });
    const installed = runDoctor(setup.workDir, { rest: [] }, {
      home: setup.home,
      env: { ...setup.env, SHIORI_INSTALL: 'all' },
      kind
    });
    assert.equal(installed.status, 0, installed.stderr + installed.stdout);
    const listed = await setupDoctor();
    await mkdir(join(listed.home, '.cursor'), { recursive: true });
    await mkdir(join(listed.home, '.config/opencode'), { recursive: true });
    const named = runDoctor(listed.workDir, { rest: [] }, {
      home: listed.home,
      env: { ...listed.env, SHIORI_INSTALL: 'opencode,cursor' },
      kind
    });
    assert.equal(named.status, 0, named.stderr + named.stdout);
    const updated = runDoctor(setup.workDir, { rest: [] }, {
      home: setup.home,
      env: { ...setup.env, SHIORI_UPDATE: 'all' },
      kind
    });
    assert.equal(updated.status, 0, updated.stderr + updated.stdout);
    results[kind] = {
      installOut: snapshotDoctorStdout(installed.stdout),
      updateOut: snapshotDoctorStdout(updated.stdout),
      installedHosts: await recordedHosts(setup.home),
      namedHosts: await recordedHosts(listed.home)
    };
  }
  assert.equal(results.sh.installOut, results.ps1.installOut);
  assert.equal(results.sh.updateOut, results.ps1.updateOut);
  assert.deepEqual(results.sh.installedHosts, results.ps1.installedHosts);
  assert.deepEqual([...results.sh.namedHosts].sort(), [...results.ps1.namedHosts].sort());
});

test('README lists SHIORI_INSTALL=all one-liners before named hosts', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const allSh = readme.indexOf('SHIORI_INSTALL=all sh');
  const allPs = readme.indexOf("$env:SHIORI_INSTALL='all'");
  const namedSh = readme.indexOf("SHIORI_INSTALL='codex,claude,cursor' sh");
  const namedPs = readme.indexOf("$env:SHIORI_INSTALL='codex,claude,cursor'");
  assert.ok(allSh >= 0 && allPs >= 0 && namedSh >= 0 && namedPs >= 0);
  assert.ok(allSh < namedSh);
  assert.ok(allPs < namedPs);
  assert.match(readme, /bare `curl \| sh` \/ `irm \| iex` with no environment variable stays read-only/);
});
