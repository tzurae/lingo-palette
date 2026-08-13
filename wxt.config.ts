import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Lingo Palette',
    description: 'Understand selected English without leaving the reading flow.',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'commands', 'scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Open Lingo Palette',
    },
    commands: {
      'focus-selection-toolbar': {
        suggested_key: {
          default:
            process.env.WXT_TEST_BROWSER === 'true'
              ? 'Ctrl+Shift+Y'
              : 'Ctrl+Shift+L',
          mac: 'Command+Shift+L',
        },
        description: 'Focus the selection toolbar',
      },
    },
  },
});
