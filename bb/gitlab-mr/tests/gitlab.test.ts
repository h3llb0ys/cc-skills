import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { details, discover } from '../gitlab';

const project = 'group/repo';
const hostname = 'gitlab.example.com';

test('uses the selected push remote and per-host glab authentication without forwarding process-wide overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-gitlab-test-'));
  const env = {
    PATH: `${directory}:${process.env.PATH}`,
    GITLAB_HOST: 'old.example.com',
    GITLAB_TOKEN: 'fixture-token',
    GITLAB_ACCESS_TOKEN: 'fixture-token',
    OAUTH_TOKEN: 'fixture-token',
    CI_JOB_TOKEN: 'fixture-token',
    GLAB_ENABLE_CI_AUTOLOGIN: 'true',
    GITLAB_API_HOST: 'old.example.com',
    GLAB_API_PROTOCOL: 'http',
    GLAB_DEBUG_HTTP: 'true',
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
    git('init', '-q', '-b', 'feature/one');
    git('remote', 'add', 'origin', 'https://gitlab.com/another/repo.git');
    git('remote', 'add', 'publish', 'https://gitlab.com/another/repo.git');
    git('remote', 'set-url', '--push', 'publish', `git@${hostname}:${project}.git`);
    git('config', 'branch.feature/one.remote', 'origin');
    git('config', 'branch.feature/one.pushRemote', 'publish');
    git('config', 'branch.feature/one.merge', 'refs/heads/main');

    const glab = join(directory, 'glab');
    await writeFile(glab, `#!/usr/bin/env node
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 5), ['api', '--method', 'GET', '--hostname', 'gitlab.example.com']);
assert.equal(process.env.GITLAB_HOST, 'gitlab.example.com');
for (const key of ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'CI_JOB_TOKEN',
  'GLAB_ENABLE_CI_AUTOLOGIN', 'GITLAB_API_HOST', 'GLAB_API_PROTOCOL', 'GLAB_DEBUG_HTTP']) {
  assert.equal(process.env[key], undefined);
}
const mr = {
  iid: 27, title: 'New MR', source_branch: 'feature/one', target_branch: 'main',
  state: 'opened', source_project_id: 42, target_project_id: 42,
  web_url: 'https://gitlab.example.com/group/repo/-/merge_requests/27',
};
if (args.includes('--paginate')) {
  assert.match(args.at(-1), /^projects\\/group%2Frepo\\/merge_requests\\?.*source_branch=feature%2Fone/);
  console.log(JSON.stringify([mr]));
} else {
  assert.equal(args.at(-1), 'projects/42/merge_requests/27');
  console.log(JSON.stringify({ ...mr, head_pipeline: {
    status: 'success', detailed_status: { group: 'success-with-warnings' },
  } }));
}
`);
    await chmod(glab, 0o700);
    Object.assign(process.env, env);
    const signal = AbortSignal.timeout(10_000);
    const found = await discover({ path: directory, hosts: [hostname] }, signal);
    assert.deepEqual(found.active, { hostname, project, branch: 'feature/one' });
    assert.deepEqual(found.candidates.map(mr => mr.iid), [27]);
    const mr = await details(found.candidates[0], signal);
    assert.equal(mr.pipeline, 'warning');

    git('config', '--unset', 'branch.feature/one.pushRemote');
    git('config', 'branch.feature/one.remote', '.');
    git('remote', 'set-url', 'origin', `https://${hostname}/${project}.git`);
    const fromLocalUpstream = await discover({ path: directory, hosts: [hostname] }, signal);
    assert.deepEqual(fromLocalUpstream.candidates.map(mr => mr.iid), [27]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
