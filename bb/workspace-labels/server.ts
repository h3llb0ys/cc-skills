import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { registerCleanup } from './cleanup/server';
import { colorsRpc, colorsSchema, colorsTag, defaultColors } from './sidebar/colors';

export default function plugin(bb: BbPluginApi) {
  registerCleanup(bb);
  bb.agents.contributeInstructions(() => [
    'When the user asks you to create a Git worktree, use the repository’s worktree creation workflow and verify the new checkout.',
    'For work continuing in this thread, including a request like “создай новый worktree от актуального main”, switch the thread to the verified absolute path using update_environment_directory.',
    'Call that tool before continuing the task in the new checkout. After it succeeds, end the turn so BB can resume in the new directory. If the tool is unavailable or the switch fails, tell the user which directory the thread still uses.',
    'Keep the current directory when the worktree is for parallel work or the user asks to keep working here. To record a verified worktree for this thread when the repository helper does not already do so, use bb workspace-tools link <absolute-repo> <absolute-worktree> <base> --branch <branch>.',
    'The Workspace Tools link command records a worktree for display and cleanup. A successful link alone does not change the thread’s working directory.',
  ].join(' '));

  const readColors = async () => colorsSchema.safeParse(await bb.storage.kv.get(colorsTag)).data ?? defaultColors;
  let lastSave = Promise.resolve();
  bb.rpc.register(colorsRpc, {
    labelColors: readColors,
    saveLabelColors(patch) {
      const save = lastSave.then(async () => {
        const current = await readColors();
        const colors = {
          worktree: patch.worktree === undefined ? current.worktree : patch.worktree,
          branch: patch.branch === undefined ? current.branch : patch.branch,
        };
        await bb.storage.kv.set(colorsTag, colors);
        bb.rpc.experimental_invalidate([colorsTag]);
        return colors;
      });
      lastSave = save.then(() => undefined, () => undefined);
      return save;
    },
  });
  bb.settings.define({
    showWorktreeWidget: {
      type: 'boolean', label: 'Показывать Worktrees в правой панели', default: true,
    },
    worktreeWidgetMode: {
      type: 'select', label: 'Какие worktree показывать',
      options: ['all', 'latest'],
      experimental_optionLabels: { all: 'Все связанные', latest: 'Последний активный' },
      default: 'all',
    },
    hideMain: {
      type: 'boolean', label: 'Скрывать main', default: false,
    },
    autoInline: {
      type: 'boolean', label: 'Собирать в одну строку, когда хватает места', default: true,
    },
    layout: {
      type: 'select', label: 'Вид подписи окружения',
      options: ['subtitle', 'badges', 'details'],
      experimental_optionLabels: {
        subtitle: 'А · Простая подпись', badges: 'Б · Бейджи', details: 'В · Worktree + ветка',
      },
      default: 'subtitle',
    },
  });
}
