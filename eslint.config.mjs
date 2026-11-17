import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'build/**',
      '.wxt/**',
      // Generated unpacked build mirror
      'ai-chat-exporter/**',
      'coverage/**',
      'node_modules/**',
      // Local agent worktrees (each is a full checkout of this repository)
      '.claude/**',
      // Generated i18n chunks (scripts/generate-i18n-chunks.mjs)
      'src/core/i18n/generated/**'
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
    }
  },
  // Production code is held to the recommended severities. The WXT entrypoints,
  // extension pages and release scripts have no outstanding violations.
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs,ts}', 'services/**/*.{js,mjs,ts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // A leading underscore marks an intentionally unused binding: omitted keys in
      // `const { secret: _secret, ...rest } = value` and parameters kept for a stable signature.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      '@typescript-eslint/no-require-imports': 'error',
      'no-useless-escape': 'error',
      'no-unsafe-finally': 'error',
      'no-control-regex': 'error',
      'no-empty': 'error',
      'prefer-const': 'error',
      'no-misleading-character-class': 'error',
      '@typescript-eslint/ban-ts-comment': 'error'
    }
  },
  // These release scripts are CommonJS .js files (package.json has no "type": "module").
  // They are spawned by name from scripts/build-all.sh and tests load them with
  // require(), so converting them to ESM would break those entry points.
  // require() is the correct module syntax for them.
  {
    files: ['scripts/**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-console': 'error' }
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
          message:
            'src/core may not dynamically import from platform, providers, components, hooks or background.'
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
  // Tests are held to the same bar as production code for type-safety and dead-code
  // rules. Use real types or `unknown` plus narrowing instead of `any`, and a leading
  // underscore for deliberately unused bindings.
  {
    files: ['tests/**/*.{ts,tsx,js,mjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      'no-empty': 'error',
      'no-unsafe-finally': 'error'
    }
  },
  {
    files: ['scripts/**', 'services/**', 'tests/**'],
    rules: { 'no-console': 'off' }
  },
  // Must stay last so it turns off formatting rules that conflict with Prettier.
  prettier
)
