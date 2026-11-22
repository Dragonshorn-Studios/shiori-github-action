import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { mcpHelperSource } from '../src/install-support.js';
import {
  ARCHIVE_URL as DOCTOR_ARCHIVE_URL,
  PWSH,
  SKIP_NO_WINDOWS_RUNNER,
  baseDoctorEnv,
  isWindows,
  makeUpstreamRepo,
  runDoctor,
  writeDoctorTree,
  writeFakeGit
} from './doctor-fixtures.js';

async function writeExecutable(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, { mode: 0o755 });
}

async function writeNamedCraftCli(dir, commandName, fileName = commandName) {
  const path = join(dir, fileName);
  await writeExecutable(
    path,
    `@echo off\r\nif "%~1"=="--version" (echo ${commandName} 0.0.0 & exit /b 0)\r\necho ok\r\nexit /b 0\r\n`
  );
  return path;
}

function windowsShortPath(path) {
  const script = `$fso = New-Object -ComObject Scripting.FileSystemObject; $fso.GetFolder('${String(path).replaceAll("'", "''")}').ShortPath`;
  const result = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true
  });
  return String(result.stdout || '').trim();
}

async function writeHelperCopy(dir) {
  const helper = join(dir, 'shiori-mcp.mjs');
  await writeFile(helper, mcpHelperSource());
  return helper;
}

test('windows-latest smoke: doctor writes attach MCP for FigCraft, PdfCraft, and nested DesignCraft', {
  skip: isWindows ? false : SKIP_NO_WINDOWS_RUNNER
}, async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  const figcraftPath = await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  const pdfcraftPath = await writeNamedCraftCli(join(programFiles, 'PdfCraft'), 'pdfcraft-cli', 'pdfcraft-cli.exe');
  const designcraftPath = await writeNamedCraftCli(
    join(programFiles, 'ArtCraft', 'DesignCraft'),
    'designcraft-cli',
    'designcraft-cli.exe'
  );
  await mkdir(join(home, '.cursor'), { recursive: true });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      SHIORI_CRAFT_WSL: '0',
      SHIORI_CRAFT_PROGRAM_FILES: programFiles
    }
  });
  const bare = runDoctor(repositoryRoot, {}, { home, env, kind: 'ps1' });
  assert.equal(bare.status, 0, bare.stderr + bare.stdout);
  assert.match(bare.stdout, /craft: figcraft found/);
  assert.match(bare.stdout, /craft: pdfcraft found/);
  assert.match(bare.stdout, /craft: designcraft found/);
  assert.equal(existsSync(join(home, '.cursor/mcp.json')), false);

  const result = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind: 'ps1' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers.figcraft, { command: figcraftPath, args: ['mcp', '--attach', '7979'] });
  assert.deepEqual(config.mcpServers.pdfcraft, { command: pdfcraftPath, args: ['mcp', '--attach', '7979'] });
  assert.deepEqual(config.mcpServers.designcraft, { command: designcraftPath, args: ['mcp', '--attach', '7979'] });
  assert.equal(config.mcpServers['shiori-brain'].env.SHIORI_BRAIN_BASE_URL, DOCTOR_ARCHIVE_URL);
  assert.match(result.stdout, /cursor: MCP figcraft added/);
  assert.match(result.stdout, /cursor: MCP pdfcraft added/);
  assert.match(result.stdout, /cursor: MCP designcraft added/);
  assert.match(result.stdout, /^updated$/m);
});

test('windows-latest smoke: helper through an 8.3 %TEMP% path still prints MCP done', {
  skip: isWindows ? false : SKIP_NO_WINDOWS_RUNNER
}, async () => {
  const realTemp = await mkdtemp(join(tmpdir(), 'shiori-long-temp-'));
  const helper = await writeHelperCopy(realTemp);
  const shortTemp = windowsShortPath(realTemp);
  assert.ok(shortTemp, 'expected an 8.3 short path for the temp directory');
  const shortHelper = join(shortTemp, 'shiori-mcp.mjs');
  const detect = spawnSync(process.execPath, [shortHelper, 'detect'], {
    encoding: 'utf8',
    env: { ...process.env, TEMP: shortTemp, TMP: shortTemp }
  });
  assert.equal(detect.status, 0, detect.stderr + detect.stdout);
  assert.match(detect.stdout, /MCP done/);

  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      TEMP: shortTemp,
      TMP: shortTemp,
      SHIORI_MCP_HELPER: shortHelper,
      SHIORI_CRAFT_WSL: '0',
      SHIORI_CRAFT_PROGRAM_FILES: programFiles
    }
  });
  const result = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind: 'ps1' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.equal(config.mcpServers.figcraft.args[1], '--attach');
  assert.match(result.stdout, /cursor: MCP figcraft added/);
  assert.ok(helper);
});

test('windows-latest smoke: helper through a junction %TEMP% path still prints MCP done', {
  skip: isWindows ? false : SKIP_NO_WINDOWS_RUNNER
}, async () => {
  const realTemp = await mkdtemp(join(tmpdir(), 'shiori-junc-real-'));
  const junctionParent = await mkdtemp(join(tmpdir(), 'shiori-junc-parent-'));
  const junctionTemp = join(junctionParent, 'temp-junc');
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', junctionTemp, realTemp], { encoding: 'utf8' });
  const helper = await writeHelperCopy(realTemp);
  const junctionHelper = join(junctionTemp, 'shiori-mcp.mjs');
  const detect = spawnSync(process.execPath, [junctionHelper, 'detect'], {
    encoding: 'utf8',
    env: { ...process.env, TEMP: junctionTemp, TMP: junctionTemp }
  });
  assert.equal(detect.status, 0, detect.stderr + detect.stdout);
  assert.match(detect.stdout, /MCP done/);

  const repositoryRoot = await mkdtemp(join(tmpdir(), 'shiori-doctor-'));
  const home = await mkdtemp(join(tmpdir(), 'shiori-home-'));
  const binDir = await mkdtemp(join(tmpdir(), 'shiori-bin-'));
  const programFiles = await mkdtemp(join(tmpdir(), 'shiori-pf-'));
  const upstream = await makeUpstreamRepo({ repository: 'example/project', marketplace: 'project-knowledge' });
  const gitVars = await writeFakeGit(binDir, upstream);
  await writeDoctorTree(repositoryRoot, { repository: 'example/project', marketplace: 'project-knowledge' });
  await writeNamedCraftCli(join(programFiles, 'FigCraft'), 'figcraft-cli', 'figcraft-cli.exe');
  await mkdir(join(home, '.cursor'), { recursive: true });
  const env = baseDoctorEnv(home, {
    binDir,
    gitEnv: gitVars,
    extra: {
      TEMP: junctionTemp,
      TMP: junctionTemp,
      SHIORI_MCP_HELPER: junctionHelper,
      SHIORI_CRAFT_WSL: '0',
      SHIORI_CRAFT_PROGRAM_FILES: programFiles
    }
  });
  const result = runDoctor(repositoryRoot, { install: ['cursor'] }, { home, env, kind: 'ps1' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const config = JSON.parse(await readFile(join(home, '.cursor/mcp.json'), 'utf8'));
  assert.equal(config.mcpServers.figcraft.args[2], '7979');
  assert.match(result.stdout, /cursor: MCP figcraft added/);
  assert.ok(helper);
});
