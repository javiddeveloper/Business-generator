// Thin GitHub REST client (server-side).
const { config } = require('./env');

async function gh(method, path, body, raw = false) {
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + config.github.token,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'User-Agent': 'startup-dashboard',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res.text();
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = text;
  }
  if (!res.ok) {
    const msg = (parsed && parsed.message) || ('HTTP ' + res.status);
    throw new Error('GitHub ' + method + ' ' + path + ' → ' + msg);
  }
  return parsed;
}

// PRs targeting develop, each enriched with a CI summary from check-runs.
// state: 'open' | 'closed' | 'all'. CI enrichment is capped to keep it fast.
async function listPRs(owner, repo, state = 'open') {
  const st = ['open', 'closed', 'all'].includes(state) ? state : 'open';
  const prs = await gh(
    'GET',
    '/repos/' + owner + '/' + repo + '/pulls?state=' + st + '&base=develop&per_page=50&sort=updated&direction=desc',
  );
  const out = [];
  for (const pr of (prs || []).slice(0, 25)) {
    let ci = { state: 'none', runs: [] };
    try {
      const data = await gh('GET', '/repos/' + owner + '/' + repo + '/commits/' + pr.head.sha + '/check-runs');
      const runs = (data && data.check_runs) || [];
      ci.runs = runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
      if (!runs.length) ci.state = 'none';
      else if (runs.some((r) => r.status !== 'completed')) ci.state = 'running';
      else if (runs.some((r) => r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion)))
        ci.state = 'failure';
      else ci.state = 'success';
    } catch (e) {
      ci.state = 'unknown';
    }
    out.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      head: pr.head.ref,
      created_at: pr.created_at,
      state: pr.state, // open | closed
      merged: !!pr.merged_at,
      mergeable_state: pr.mergeable_state,
      ci,
    });
  }
  return out;
}

async function getPRDetail(owner, repo, number) {
  const [pr, comments, reviews, files] = await Promise.all([
    gh('GET', `/repos/${owner}/${repo}/pulls/${number}`),
    gh('GET', `/repos/${owner}/${repo}/issues/${number}/comments?per_page=30`).catch(() => []),
    gh('GET', `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=20`).catch(() => []),
    gh('GET', `/repos/${owner}/${repo}/pulls/${number}/files?per_page=30`).catch(() => []),
  ]);
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body || '',
    url: pr.html_url,
    head: pr.head.ref,
    base: pr.base.ref,
    state: pr.state,
    merged: !!pr.merged_at,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    author: pr.user && pr.user.login,
    comments: (comments || []).map((c) => ({ author: c.user && c.user.login, body: c.body, ts: c.created_at })),
    reviews: (reviews || []).map((r) => ({ author: r.user && r.user.login, state: r.state, body: r.body })),
    files: (files || []).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
  };
}

module.exports = { gh, listPRs, getPRDetail };
