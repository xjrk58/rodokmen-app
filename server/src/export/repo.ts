import { execFile } from 'node:child_process';
import { copyFile, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { messageOf, stringField } from '../errors.js';

const run = promisify(execFile);

/**
 * Pushing the Export to its repository (exports spec, "Nightly Export to rodokmen-export", "The
 * Export is one-way"; erasure spec, "Erasure reaches Exports"). Every run starts from an empty
 * work tree: it fetches the branch's last commit, writes every file of the Export, and commits
 * only when the tree differs from that commit. So a hand edit in the repository is overwritten
 * by the next run, and a night without changes makes no commit.
 *
 * After an erasure the run commits the tree with no parent and force-pushes it (with a lease on
 * the commit it read), so the branch has a single commit and no earlier one stays reachable from
 * it. GitHub may keep unreachable commits in its caches until it collects them (design, "Git access").
 *
 * The server pushes with a deploy key that may write to that one repository; the key is copied
 * into the run's temporary folder with mode 600, and SSH checks the host against a known_hosts file.
 */

export interface ExportRepoConfig {
  /** The remote: `git@github.com:<owner>/rodokmen-export.git`, or a local path (tests use a bare repository). */
  url: string;
  branch: string;
  /** The deploy key (a private key file); null for a local path. */
  sshKey: string | null;
  /** The known_hosts file SSH checks the host against; required with a key. */
  knownHosts: string | null;
  /** Who the commits are by. */
  author: { name: string; email: string };
}

export interface PublishResult {
  committed: boolean;
  replacedHistory: boolean;
  commit: string | null;
}

/** Runs git in a folder, with no user or system configuration and no prompts. */
function gitIn(dir: string, env: NodeJS.ProcessEnv) {
  return async (args: string[]): Promise<{ out: string }> => {
    try {
      const { stdout } = await run('git', args, { cwd: dir, env, maxBuffer: 64 * 1024 * 1024 });
      return { out: stdout.trim() };
    } catch (error) {
      throw new Error(`git ${args[0]} failed: ${stringField(error, 'stderr')?.trim() || messageOf(error)}`, { cause: error });
    }
  };
}

/**
 * Writes the files as the whole content of the branch, committing only when something changed,
 * or always, with no parent, when the history must be replaced.
 */
export async function publish(
  cfg: ExportRepoConfig,
  files: ReadonlyMap<string, string>,
  options: { replaceHistory: boolean; message: string; at: Date },
): Promise<PublishResult> {
  const tmp = await mkdtemp(join(tmpdir(), 'rodokmen-export-'));
  try {
    const work = join(tmp, 'work');
    await mkdir(work);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: tmp,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: cfg.author.name,
      GIT_AUTHOR_EMAIL: cfg.author.email,
      GIT_COMMITTER_NAME: cfg.author.name,
      GIT_COMMITTER_EMAIL: cfg.author.email,
      GIT_AUTHOR_DATE: options.at.toISOString(),
      GIT_COMMITTER_DATE: options.at.toISOString(),
    };
    if (cfg.sshKey) {
      if (!cfg.knownHosts) throw new Error('the Export needs a known_hosts file to check the host it pushes to');
      const key = join(tmp, 'deploy_key');
      await copyFile(cfg.sshKey, key);
      await chmod(key, 0o600);
      env.GIT_SSH_COMMAND = `ssh -i ${key} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${cfg.knownHosts}`;
    }
    const git = gitIn(work, env);
    await git(['init', '-q', '-b', cfg.branch]);
    await git(['remote', 'add', 'origin', cfg.url]);

    // The branch's last commit, if it has one yet.
    const listed = await git(['ls-remote', 'origin', `refs/heads/${cfg.branch}`]);
    let head: string | null = null;
    if (listed.out) {
      await git(['fetch', '-q', '--depth', '1', 'origin', `refs/heads/${cfg.branch}`]);
      head = (await git(['rev-parse', 'FETCH_HEAD'])).out;
    }

    for (const [path, text] of files) {
      const target = join(work, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    await git(['add', '-A']);
    const tree = (await git(['write-tree'])).out;
    if (head && !options.replaceHistory) {
      const current = (await git(['rev-parse', `${head}^{tree}`])).out;
      if (current === tree) return { committed: false, replacedHistory: false, commit: null };
    }
    const parent = head && !options.replaceHistory ? ['-p', head] : [];
    const commit = (await git(['commit-tree', tree, ...parent, '-m', options.message])).out;
    const lease = head ? [`--force-with-lease=refs/heads/${cfg.branch}:${head}`] : [];
    await git(['push', '-q', ...lease, 'origin', `${commit}:refs/heads/${cfg.branch}`]);
    return { committed: true, replacedHistory: options.replaceHistory, commit };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
