import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Snapshot } from '../contract';
import { decorateSidebar } from '../sidebar-rows';

const first: Snapshot['links'][number] = {
  hostname: 'gitlab.example.com', project: 'group/repo', projectId: 42, iid: 627,
  title: 'Example <script>', branch: 'feature/one', target: 'main', state: 'opened',
  pipeline: 'warning', hostId: 'host_test', stale: false,
};
const second: Snapshot['links'][number] = { ...first, iid: 628, branch: 'feature/two', state: 'merged' };

function fixture() {
  const dom = new JSDOM(`
    <div data-sidebar-rename-row>
      <span id="content">
        <a data-sidebar-thread-id="thr_a"></a>
        <span id="title"><span class="bb-thread-title">Example</span></span>
      </span>
    </div>
  `, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const keys: string[][] = [];
  const decorator = decorateSidebar(doc, ids => keys.push(ids));
  return {
    doc, dom, keys,
    title: doc.getElementById('title')!,
    content: doc.getElementById('content')!,
    update(links: Snapshot['links'], active: Snapshot['active'] = null) {
      decorator.update({ thr_a: { links, active, candidates: [], notice: null } });
    },
    dispose() {
      decorator.dispose();
      dom.window.close();
    },
  };
}

test('places one MR after a Jira badge and the link click does not select the thread', async () => {
  const env = fixture();
  try {
    env.update([first]);
    const badge = env.title.querySelector<HTMLAnchorElement>('[data-gitlab-mr-badges="inline"] a')!;
    assert.equal(badge.textContent, '!627');
    assert.equal(badge.href, 'https://gitlab.example.com/group/repo/-/merge_requests/627');
    assert.equal(badge.target, '_blank');
    assert.ok(badge.classList.contains('gitlab-mr-orange'));
    assert.match(badge.title, /Пайплайн прошёл с предупреждениями/);
    assert.equal(env.doc.querySelector('script'), null);

    const jira = env.doc.createElement('span');
    jira.dataset.jiraTaskLinks = '';
    env.title.append(jira);
    await new Promise<void>(resolve => env.dom.window.requestAnimationFrame(() => {
      env.dom.window.requestAnimationFrame(() => resolve());
    }));
    assert.equal(jira.nextElementSibling, badge.parentElement);

    let rowClicks = 0;
    env.content.addEventListener('click', () => rowClicks++);
    badge.addEventListener('click', event => event.preventDefault());
    badge.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(rowClicks, 0);
  } finally {
    env.dispose();
  }
});

test('puts multiple links on the second line, current branch first, and cleans up a recycled row', async () => {
  const env = fixture();
  try {
    env.update([first, second], { hostname: second.hostname, project: second.project, branch: second.branch });
    const below = env.content.querySelector('[data-gitlab-mr-badges="stacked"]')!;
    assert.equal(below.parentElement, env.content);
    assert.deepEqual([...below.querySelectorAll('a')].map(link => link.textContent), ['!628', '!627']);
    assert.ok(below.firstElementChild?.classList.contains('gitlab-mr-purple'));
    assert.deepEqual(env.keys, [['thr_a']]);

    env.content.querySelector<HTMLElement>('[data-sidebar-thread-id]')!.dataset.sidebarThreadId = 'thr_b';
    await new Promise<void>(resolve => env.dom.window.requestAnimationFrame(() => {
      env.dom.window.requestAnimationFrame(() => resolve());
    }));
    assert.equal(env.doc.querySelector('[data-gitlab-mr-badges]'), null);
    assert.deepEqual(env.keys, [['thr_a'], ['thr_b']]);
  } finally {
    env.dispose();
  }
});

test('disabling sidebar badges removes only the MR links', () => {
  const env = fixture();
  const jira = env.doc.createElement('span');
  jira.dataset.jiraTaskLinks = '';
  env.title.append(jira);
  env.update([first]);
  assert.ok(env.doc.querySelector('[data-gitlab-mr-badges]'));
  env.dispose();
  assert.equal(env.title.querySelector('[data-gitlab-mr-badges]'), null);
  assert.equal(env.title.querySelector('[data-jira-task-links]'), jira);
});
