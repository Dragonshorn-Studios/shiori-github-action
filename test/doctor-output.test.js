import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  baseDoctorEnv,
  forEachDoctorKind,
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

const EXPECTED_INSTALL = `checkout: cloned <sha>
detected: cursor
cursor: skills -> ~/.agents/skills
cursor: MCP -> ~/.cursor/mcp.json
cursor: MCP shiori-brain added
updated
`;

const EXPECTED_UPDATE = `checkout: already up to date <sha>
detected: cursor
cursor: skills -> ~/.agents/skills
cursor: MCP -> ~/.cursor/mcp.json
cursor: MCP shiori-brain unchanged
already current
`;

forEachDoctorKind('default install/update stdout snapshot', async (_t, kind) => {
  const { workDir, home, env } = await setupDoctor();
  await mkdir(join(home, '.cursor'), { recursive: true });
  const installed = runDoctor(workDir, { install: [] }, { home, env, kind });
  assert.equal(installed.status, 0, installed.stderr + installed.stdout);
  assert.equal(snapshotDoctorStdout(installed.stdout), EXPECTED_INSTALL);

  const updated = runDoctor(workDir, { update: true }, { home, env, kind });
  assert.equal(updated.status, 0, updated.stderr + updated.stdout);
  assert.equal(snapshotDoctorStdout(updated.stdout), EXPECTED_UPDATE);
});
