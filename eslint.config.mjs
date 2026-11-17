import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'build/**',
      '.plasmo/**',
      // Generated unpacked build mirror
      'ai-chat-exporter/**',
      'coverage/**',
      'node_modules/**'
    ]
  },
  {
    files: [
      'src/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx,js,mjs}',
      'scripts/**/*.{js,mjs,ts}',
      'services/**/*.{js,mjs,ts}'
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: 'readonly' }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // TODO(lint-debt): 2 existing violations, both false positives from a
      // `useSidebarFallback` helper called in a class (src/contents/claude-parser.ts:474, :540).
      // Promote back to 'error' once the helper is renamed.
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',

      // Recommended rules that currently report errors in existing code. Downgraded so the
      // gate exits 0; promote each back to 'error' once its debt is paid down.
      // TODO(lint-debt): 41 existing violations
      '@typescript-eslint/no-unused-vars': 'warn',
      // TODO(lint-debt): 7 existing violations
      '@typescript-eslint/no-require-imports': 'warn',
      // TODO(lint-debt): 7 existing violations
      'no-useless-escape': 'warn',
      // TODO(lint-debt): 2 existing violations
      'no-unsafe-finally': 'warn',
      // TODO(lint-debt): 6 existing violations
      'no-control-regex': 'warn',
      // TODO(lint-debt): 15 existing violations
      'no-empty': 'warn',
      // TODO(lint-debt): 1 existing violation
      'prefer-const': 'warn',
      // TODO(lint-debt): 1 existing violation
      'no-misleading-character-class': 'warn',
      // TODO(lint-debt): 1 existing violation
      '@typescript-eslint/ban-ts-comment': 'warn'
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-console': 'warn' }
  },
  // Layer boundaries (see src/README.md). core is platform-independent, so it may
  // not touch the `chrome` global or import any layer above it.
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message:
            'src/core must stay platform-independent. Put chrome.* code in src/platform or inject the dependency.'
        }
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/platform',
                '**/platform/**',
                '**/providers',
                '**/providers/**',
                '**/components',
                '**/components/**',
                '**/hooks',
                '**/hooks/**',
                '**/background',
                '**/background/**'
              ],
              message:
                'src/core may only import from src/core. Move the code down into core or inject it.'
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportExpression[source.value=/(^|\\/)(platform|providers|components|hooks|background)(\\/|$)/]',
          message: 'src/core may not dynamically import from platform, providers, components, hooks or background.'
        }
      ]
    }
  },
  {
    files: ['src/providers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/components',
                '**/components/**',
                '**/hooks',
                '**/hooks/**',
                '**/background',
                '**/background/**'
              ],
              message: 'src/providers may not import UI (components, hooks) or background code.'
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/(^|\\/)(components|hooks|background)(\\/|$)/]',
          message: 'src/providers may not dynamically import components, hooks or background code.'
        }
      ]
    }
  },
  {
    files: ['scripts/**', 'services/**', 'tests/**'],
    rules: { 'no-console': 'off' }
  },
  // Must stay last so it turns off formatting rules that conflict with Prettier.
  prettier
)
