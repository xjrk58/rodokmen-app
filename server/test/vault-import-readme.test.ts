import { BatchList, LeadList } from '@rodokmen/shared';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { vaultImportCommand } from '../src/vault-import/command.js';
import { libreOfficeConvert } from '../src/vault-import/run.js';
import { createAgentWithToken, ensureOwner, signIn } from './helpers.js';
import { fixtureVault, FIXTURE_VAULT } from './fixture-vault.js';
import { startLiveServer, type LiveServer } from './live-server.js';

/**
 * The import procedure as server/src/vault-import/README.md tells it (add-vault-import task 3.7):
 * a fresh run of the invented fixture Vault, through the command and its environment only: the
 * dry run, the import, the Owner accepting the batch, and the run that creates the leads. Also
 * the DOC conversion with LibreOffice where it is installed, and the fixture against the guard.
 */
const REPO = new URL('../../', import.meta.url).pathname;
const hasSoffice = await promisify(execFile)('soffice', ['--version'])
  .then(() => true)
  .catch(() => false);

describe('importing the fixture Vault as the README says', () => {
  let s: LiveServer;
  let owner: Account;
  let env: NodeJS.ProcessEnv;
  let dir: string;
  /** The fixture Vault in its layout, as the Owner's checkout would be. */
  let vault: Awaited<ReturnType<typeof fixtureVault>>;
  const lines: string[] = [];
  const command = (args: string[]) => vaultImportCommand([...args, '--municipalities', join(dir, 'municipalities.json')], env, (l) => lines.push(l));

  beforeAll(async () => {
    s = await startLiveServer();
    owner = await ensureOwner(s.t.db);
    // Step 1: the Owner creates the importing Agent and issues its token.
    const { token } = await createAgentWithToken(s.t.db, s.clock, 'Vault importer');
    env = { RODOKMEN_URL: s.origin, RODOKMEN_TOKEN: token };
    dir = await mkdtemp(join(tmpdir(), 'rodokmen-readme-'));
    vault = await fixtureVault();
    await writeFile(join(dir, 'municipalities.json'), '[]');
  }, 60_000);
  afterAll(async () => {
    await s?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
    await vault?.remove();
  });

  it('without RODOKMEN_URL and an Agent token it says what to set; without --vault it shows the usage', async () => {
    expect(await vaultImportCommand(['--vault', vault.path], {}, (l) => lines.push(l))).toBe(2);
    expect(lines.pop()).toMatch(/Set RODOKMEN_URL/);
    expect(await vaultImportCommand([], env)).toBeNull();
  });

  it('steps 3 to 6: dry run, import, accept the batch, and the run that creates the leads', async () => {
    const report = join(dir, 'report.md');
    expect(await command(['--vault', vault.path, '--dry-run', '--report', report])).toBe(0);
    expect(lines.some((l) => l.startsWith('Dry run: nothing was submitted.'))).toBe(true);
    expect(await readFile(report, 'utf8')).toContain('## Links to missing notes');
    expect((await s.t.db.selectFrom('proposal').select('id').execute()).length).toBe(0);

    expect(await command(['--vault', vault.path, '--report', report, '--given-by', 'Owner Example'])).toBe(0);
    const cookie = await signIn(s.t.db, s.clock, owner);
    const [batch] = BatchList.parse((await s.app.inject({ method: 'GET', url: '/api/batches', headers: { cookie } })).json()).items;
    expect(batch!.name).toMatch(/^Vault import \d{4}-\d{2}-\d{2}$/);
    const accepted = await s.app.inject({
      method: 'POST',
      url: `/api/batches/${batch!.id}/accept`,
      headers: { cookie, origin: s.origin },
      payload: { proposals: batch!.counts.pending },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    expect(await command(['--vault', vault.path, '--report', report])).toBe(0);
    expect(lines.at(-1)).toBe('Research leads: 2 (0 wait for the batch to be accepted).');
    expect(LeadList.parse((await s.app.inject({ method: 'GET', url: '/api/leads', headers: { cookie } })).json()).items).toHaveLength(2);
  });

  it.skipIf(!hasSoffice)('converts a DOC to PDF with LibreOffice', async () => {
    const pdf = await libreOfficeConvert(join(FIXTURE_VAULT, 'attachments/documents/rod-novaku.doc'), dir);
    expect((await readFile(pdf)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('the fixture Vault holds only invented names: the repository guard finds none of the denylist in it', async () => {
    const guard = join(REPO, 'scripts/vault-guard.mjs');
    await access(guard);
    const { stdout } = await promisify(execFile)('git', ['ls-files', '--others', '--cached', '--exclude-standard', 'server/test/fixtures/vault'], {
      cwd: REPO,
    });
    const files = stdout.split('\n').filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(10);
    const text = (await Promise.all(files.map((f) => readFile(join(REPO, f), 'utf8')))).join('\n');
    const child = execFile('node', [guard, '--text', '-'], { cwd: REPO });
    child.stdin!.end(text);
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
  });
});
