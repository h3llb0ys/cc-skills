import type { BbPluginApi } from '@get-bb/plugin-sdk';

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
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
