import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { registerCleanup } from './cleanup/server';
import { colorsRpc, colorsSchema, colorsTag, defaultColors } from './sidebar/colors';

export default function plugin(bb: BbPluginApi) {
  registerCleanup(bb);
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
