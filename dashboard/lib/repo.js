// Local repo connect: clone an existing GitHub repo onto this machine and list
// its branches. Independent of the Claude bridge — the dashboard runs on the host,
// so it can drive git directly. Branches are read from the local clone when present,
// otherwise from the GitHub API (so they show even before cloning).
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { config } = require('./env');
const { gh } = require('./github');

const WORKSPACE_DEFAULT = path.join(os.homedir(), '.business-generator', 'workspaces');
function workspaceRoot() {
  // Read from live config (updated by Settings panel) then fall back to env var then default.
  let d = (config.workspaceDir || process.env.WORKSPACE_DIR || '').trim() || WORKSPACE_DEFAULT;
  if (d === '~' || d.startsWith('~/')) d = path.join(os.homedir(), d.slice(1));
  return d;
}

const normRepo = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(s)) return s;
  return s.replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');
};

function repoDir(repo) {
  const slug = normRepo(repo);
  if (/^([a-zA-Z]:[/\\]|\\\\|\/)/.test(slug)) return slug;
  if (slug.startsWith('~/')) return path.join(os.homedir(), slug.slice(2));
  return path.join(workspaceRoot(), slug.replace(/\//g, '__'));
}

// Embed the token into an https clone URL (only for github.com refs).
function buildAuthUrl(repo, token) {
  const slug = normRepo(repo);
  if (token) return 'https://' + token + '@github.com/' + slug + '.git';
  return 'https://github.com/' + slug + '.git';
}

function redact(s, token) {
  let r = String(s == null ? '' : s);
  if (token) r = r.split(token).join('***');
  return r;
}

// Spawn a git subcommand; resolves { code, out, err } (never rejects).
function git(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: -1, out, err: String(err) + e.message }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

// Branches + default branch from the GitHub API (no clone needed).
async function remoteBranches(repo) {
  const slug = normRepo(repo);
  const [o, r] = slug.split('/');
  if (!o || !r) throw new Error('repo باید owner/name باشد');
  const info = await gh('GET', '/repos/' + o + '/' + r).catch(() => ({}));
  const list = await gh('GET', '/repos/' + o + '/' + r + '/branches?per_page=100');
  return {
    defaultBranch: info.default_branch || '',
    branches: (Array.isArray(list) ? list : []).map((b) => b.name),
  };
}

// Branch names from a local clone (includes remote-tracking branches).
async function localBranches(dir) {
  const cur = await git(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const br = await git(['-C', dir, 'branch', '-a', '--format=%(refname:short)']);
  const branches = br.out.split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((s) => !s.includes('HEAD') && !s.includes('->')) // drop the origin/HEAD symref
    .map((s) => s.replace(/^origin\//, ''))
    .filter((s) => s && s !== 'origin')
    .filter((s, i, a) => a.indexOf(s) === i);
  return { current: cur.out.trim(), branches };
}

// Extract GitHub owner/repo from a git remote URL (https or ssh).
function parseRemoteSlug(remoteUrl) {
  if (!remoteUrl) return '';
  let s = remoteUrl.trim().replace(/\.git$/, '');
  // ssh: git@github.com:owner/repo
  const ssh = s.match(/github\.com[:/](.+\/[^/]+)$/i);
  if (ssh) return ssh[1];
  // https: https://github.com/owner/repo
  const https = s.match(/github\.com\/(.+\/[^/]+)$/i);
  if (https) return https[1];
  return '';
}

// Read remote.origin.url from a local .git/config
function readGitRemote(dir) {
  try {
    const cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
    const m = cfg.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

// Full status for a project's repo: is it cloned, where, and its branches.
async function status(repo) {
  const slug = normRepo(repo);
  const isLocalPath = /^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(slug);
  if (!slug) {
    return { ok: false, error: 'no-repo', errorType: 'empty' };
  }
  if (!isLocalPath && slug.indexOf('/') < 0) {
    return { ok: false, error: `"${slug}" یک مسیر معتبر نیست. برای پروژه محلی مسیر کامل را وارد کنید (مثلاً /Users/... یا ~/...) و برای گیت‌هاب فرمت owner/repo را استفاده کنید.`, errorType: 'invalid-path', stored: slug };
  }
  const dir = repoDir(slug);
  const dirExists = fs.existsSync(dir);
  const cloned = fs.existsSync(path.join(dir, '.git'));

  // Detect the case where the folder was deleted manually by the user
  // (dir doesn't exist but we still want to inform the caller)
  const out = { ok: true, repo: slug, dir, cloned, folderMissing: !dirExists && !cloned, isLocalPath };

  // For local paths, detect whether git and a remote are present
  if (isLocalPath && dirExists) {
    out.hasGit = cloned;
    const remoteRaw = cloned ? readGitRemote(dir) : '';
    out.hasRemote = !!remoteRaw;
    out.needsGitConnect = !cloned || !remoteRaw;
  }

  try {
    if (cloned) {
      const lb = await localBranches(dir);
      out.current = lb.current;
      out.branches = lb.branches;
      // auto-detect GitHub slug from .git/config remote.origin.url
      const remoteUrl = readGitRemote(dir);
      const detectedSlug = parseRemoteSlug(remoteUrl);
      if (detectedSlug) out.githubRepo = detectedSlug;
      // still surface the default branch from the API when available (skip for local)
      const ghSlug = detectedSlug || (!isLocalPath ? slug : '');
      if (ghSlug) {
        out.defaultBranch = await remoteBranches(ghSlug).then((r) => r.defaultBranch).catch(() => '');
      }
    } else if (!isLocalPath) {
      const rb = await remoteBranches(slug);
      out.defaultBranch = rb.defaultBranch;
      out.branches = rb.branches;
    }
  } catch (e) {
    out.branchesError = e.message;
    out.branches = out.branches || [];
  }
  return out;
}

// Make sure a project is backed by a git checkout so the agent flow (which works
// inside a git working tree) can run. Remote repos go through clone() elsewhere;
// here we only auto-init a *local* folder that exists but isn't versioned yet —
// `git init` + an initial commit — then return fresh status. Best-effort: on a
// remote ref or a missing folder it just returns the plain status.
async function ensureGit(repo) {
  const slug = normRepo(repo);
  const isLocalPath = /^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(slug);
  const dir = repoDir(slug);
  if (isLocalPath && fs.existsSync(dir) && !fs.existsSync(path.join(dir, '.git'))) {
    const init = await git(['-C', dir, 'init']);
    if (init.code === 0) {
      await git(['-C', dir, 'config', 'user.email', 'bot@business-generator.local']);
      await git(['-C', dir, 'config', 'user.name', 'Startup Bot']);
      await git(['-C', dir, 'add', '-A']);
      const staged = await git(['-C', dir, 'diff', '--cached', '--name-only']);
      if (staged.out.trim()) await git(['-C', dir, 'commit', '-m', 'initial commit']);
    }
  }
  return status(slug);
}

// Checkout a branch in a local clone. Returns fresh status.
async function checkout(repo, branch) {
  const slug = normRepo(repo);
  const dir = repoDir(slug);
  if (!fs.existsSync(path.join(dir, '.git'))) throw new Error('مخزن git وجود ندارد');
  // fetch to refresh remote refs (best-effort)
  await git(['-C', dir, 'fetch', '--prune', 'origin']);
  // try local branch first, then track remote
  const localCo = await git(['-C', dir, 'checkout', branch]);
  if (localCo.code !== 0) {
    const remoteCo = await git(['-C', dir, 'checkout', '-B', branch, 'origin/' + branch]);
    if (remoteCo.code !== 0) throw new Error('checkout ناموفق: ' + (remoteCo.err || remoteCo.out).slice(0, 200));
  }
  return status(slug);
}

// Init git + add remote + push for a local folder that lacks a GitHub remote.
async function connectGit(localPath, remoteUrl) {
  const token = config.github.token;
  const slug = parseRemoteSlug(remoteUrl) || normRepo(remoteUrl);
  if (!slug || slug.indexOf('/') < 0) throw new Error('آدرس گیت‌هاب معتبر نیست (owner/repo)');
  const authUrl = buildAuthUrl(slug, token);
  const dir = localPath;
  if (!fs.existsSync(dir)) throw new Error('مسیر لوکال وجود ندارد');

  const hasGit = fs.existsSync(path.join(dir, '.git'));
  if (!hasGit) {
    const init = await git(['-C', dir, 'init']);
    if (init.code !== 0) throw new Error('git init ناموفق');
    await git(['-C', dir, 'config', 'user.email', 'bot@business-generator.local']);
    await git(['-C', dir, 'config', 'user.name', 'Startup Bot']);
    await git(['-C', dir, 'add', '-A']);
    const staged = await git(['-C', dir, 'diff', '--cached', '--name-only']);
    if (staged.out.trim()) {
      const com = await git(['-C', dir, 'commit', '-m', 'initial commit']);
      if (com.code !== 0) throw new Error('commit اولیه ناموفق: ' + redact(com.err, token).slice(0, 200));
    }
  }

  // set or update remote origin
  const existingRemote = readGitRemote(dir);
  if (existingRemote) {
    await git(['-C', dir, 'remote', 'set-url', 'origin', authUrl]);
  } else {
    const addR = await git(['-C', dir, 'remote', 'add', 'origin', authUrl]);
    if (addR.code !== 0) throw new Error('remote add ناموفق: ' + redact(addR.err, token).slice(0, 200));
  }

  const push = await git(['-C', dir, 'push', '-u', 'origin', 'HEAD']);
  if (push.code !== 0) throw new Error('push ناموفق: ' + redact(push.err || push.out, token).slice(0, 300));
}

// Remove the local clone directory for a repo (used when a project is deleted).
function deleteClone(repo) {
  const slug = normRepo(repo);
  if (!slug) return;
  const isLocalPath = /^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(slug);
  if (isLocalPath) {
    // Never delete a folder that the user provided as a local path!
    return;
  }
  const dir = repoDir(slug);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // non-fatal: the folder may already be gone
    console.warn('[repo] deleteClone failed:', e.message);
  }
}

// Clone if missing, else fetch + prune. Returns the fresh status.
async function clone(repo) {
  const slug = normRepo(repo);
  const isLocalPath = /^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(slug);
  if (!slug || (!isLocalPath && slug.indexOf('/') < 0)) {
    return { ok: false, error: 'این پروژه ریپوی معتبر (owner/name) یا مسیر محلی ندارد' };
  }
  if (isLocalPath) {
    return { ok: false, error: 'این مسیر یک فولدر لوکال است، کلون معنی ندارد' };
  }
  const token = config.github.token;
  const authUrl = buildAuthUrl(slug, token);
  const dir = repoDir(slug);
  try {
    if (fs.existsSync(path.join(dir, '.git'))) {
      await git(['-C', dir, 'remote', 'set-url', 'origin', authUrl]);
      const f = await git(['-C', dir, 'fetch', '--prune', 'origin']);
      if (f.code !== 0) throw new Error(redact(f.err || f.out, token).slice(0, 300));
    } else {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const c = await git(['clone', authUrl, dir]);
      if (c.code !== 0) throw new Error(redact(c.err || c.out, token).slice(0, 300));
      await git(['-C', dir, 'config', 'user.email', 'bot@business-generator.local']);
      await git(['-C', dir, 'config', 'user.name', 'Startup Bot']);
    }
  } catch (e) {
    return { ok: false, error: redact(e.message, token) };
  }
  return status(slug);
}

module.exports = { status, clone, checkout, connectGit, repoDir, workspaceRoot, deleteClone, ensureGit };
