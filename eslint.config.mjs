import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

// Keep the checks reported by the community scanner reproducible locally.
export default [{
  files: ['src/**/*.ts'],
  languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
  plugins: { '@typescript-eslint': tseslint.plugin, obsidianmd },
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    'no-useless-escape': 'error',
    'obsidianmd/no-global-this': 'error',
    'obsidianmd/prefer-window-timers': 'error',
    'obsidianmd/no-unsupported-api': 'error',
    'obsidianmd/settings-tab/prefer-setting-definitions': 'error',
    'obsidianmd/settings-tab/no-manual-html-headings': 'error',
    'obsidianmd/settings-tab/no-problematic-settings-headings': 'error',
  },
}];
