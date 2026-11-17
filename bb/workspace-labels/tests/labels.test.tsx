import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { workspaceLabels, parseLayout, layouts, type Environment } from '../labels';
import { WorkspaceMetadata } from '../metadata';
import { fitsInline } from '../adaptive';

test('inline requires full width including a margin; never fits zero or missing measurements', () => {
  assert.equal(fitsInline(300, 298), true);
  assert.equal(fitsInline(300, 299), false);
  assert.equal(fitsInline(300, 320), false);
  assert.equal(fitsInline(0, 200), false);
  assert.equal(fitsInline(300, 0), false);
});

const environment: Environment = { path: '/repos/worktrees/title', name: 'Title', branchName: 'stale', isWorktree: true };
const status = { outcome: 'available', workspace: { branch: { currentBranch: 'feature/title' }, checkout: { kind: 'branch' } } };

test('all three layouts, with live branch taking precedence over saved BB branch', () => {
  for (const layout of layouts) {
    const model = workspaceLabels(environment, status, layout)!;
    assert.deepEqual(model.labels, layout === 'details'
      ? [{ kind: 'worktree', text: 'title' }, { kind: 'branch', text: 'feature/title' }]
      : [{ kind: 'worktree', text: 'title' }]);
    assert.match(model.tooltip, /feature\/title/);
    assert.doesNotMatch(model.tooltip, /stale/);
  }
});
test('plain checkout shows branch; no worktree inference from its path', () => {
  assert.deepEqual(workspaceLabels({ ...environment, isWorktree: false }, status, 'details')?.labels,
    [{ kind: 'branch', text: 'feature/title' }]);
});
test('detached HEAD clears the saved branch, including in a worktree', () => {
  const detached = { outcome: 'available', workspace: { branch: { currentBranch: null }, checkout: { kind: 'detached', headSha: '1234567890abc' } } };
  const model = workspaceLabels(environment, detached, 'details')!;
  assert.deepEqual(model.labels[1], { kind: 'branch', text: 'detached 1234567' });
  assert.doesNotMatch(model.tooltip, /stale/);
});
test('non-git / no environment draw nothing; offline branch is explicitly unconfirmed', () => {
  assert.equal(workspaceLabels(null, undefined, 'subtitle'), null);
  assert.equal(workspaceLabels(environment, { outcome: 'not_applicable' }, 'details'), null);
  assert.equal(workspaceLabels({ ...environment, isWorktree: false, branchName: null }, undefined, 'subtitle'), null);
  assert.match(workspaceLabels(environment, { outcome: 'unavailable' }, 'details')!.tooltip, /не подтверждён/);
});
test('portable folder names and invalid layout fallback', () => {
  assert.equal(workspaceLabels({ ...environment, path: 'C:\\worktrees\\title\\' }, status, 'subtitle')!.labels[0].text, 'title');
  assert.equal(workspaceLabels({ ...environment, path: null }, status, 'subtitle')!.labels[0].text, 'Title');
  assert.equal(workspaceLabels({ ...environment, path: '/workspaces/task-a/catalog' }, status, 'subtitle')!.labels[0].text, 'task-a/catalog');
  assert.equal(parseLayout('invalid'), 'subtitle');
  assert.equal(parseLayout(undefined), 'subtitle');
});
test('renders only owned metadata, escapes branch and leaves task links alone across layouts', () => {
  const doc = new JSDOM('<div><span class="bb-thread-title">Title</span><a href="https://jira.example/A-1">A-1</a><a href="https://jira.example/A-2">A-2</a><div data-thread-row-metadata></div></div>').window.document;
  const links = [...doc.querySelectorAll('a')];
  const metadata = doc.querySelector('[data-thread-row-metadata]')!;
  for (const layout of layouts) {
    metadata.innerHTML = renderToStaticMarkup(<WorkspaceMetadata environment={environment} layout={layout} status={status}/>);
    assert.equal(metadata.querySelectorAll('a,button').length, 0);
    assert.equal(metadata.querySelectorAll('[data-workspace-kind]').length, layout === 'details' ? 2 : 1);
    assert.deepEqual([...doc.querySelectorAll('a')], links);
  }
  const unsafe = { ...status, workspace: { ...status.workspace, branch: { currentBranch: '<img src=x onerror=alert(1)>' } } };
  metadata.innerHTML = renderToStaticMarkup(<WorkspaceMetadata environment={environment} layout="details" status={unsafe}/>);
  assert.equal(metadata.querySelector('img'), null);
  assert.match(metadata.textContent!, /<img/);
});
