import js from '@eslint/js'
import react from '@eslint-react/eslint-plugin'
import prettier from 'eslint-config-prettier/flat'
import hooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const browserPersistence = [
  'indexedDB',
  'IDBKeyRange',
  'localStorage',
  'sessionStorage',
  'document',
  'window',
  'self',
]

const disallowDynamicImports = {
  selector: 'ImportExpression',
  message: 'Use static imports so layer dependencies are checked.',
}
const restrictPersistence = [
  'error',
  ...browserPersistence.map((property) => ({ object: 'globalThis', property })),
]

function restrictImports(regex, message) {
  return ['error', { patterns: [{ regex, message }] }]
}

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'playwright-report/', 'test-results/', '.claude/']),
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [react.configs['recommended-typescript'], hooks.configs.flat.recommended],
    rules: {
      // Use the Hooks plugin for rules both plugins provide.
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/rules-of-hooks': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/set-state-in-render': 'off',
      // ESLint's bulk baseline can track errors only.
      'react-hooks/exhaustive-deps': 'error',
      '@eslint-react/no-array-index-key': 'error',
      '@eslint-react/no-forward-ref': 'error',
      '@eslint-react/naming-convention-ref-name': 'error',
      '@eslint-react/naming-convention-id-name': 'error',
      '@eslint-react/no-unnecessary-use-prefix': 'error',
      '@eslint-react/use-state': 'error',
    },
  },
  {
    files: ['src/bom.ts', 'src/crafting-types.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        '^(?!\\./crafting-types(?:\\.ts)?$).+',
        'The standalone crafting domain may only import crafting types.',
      ),
      'no-restricted-globals': ['error', ...browserPersistence],
      'no-restricted-properties': restrictPersistence,
      'no-restricted-syntax': ['error', disallowDynamicImports],
    },
  },
  {
    files: ['src/crops/{calendar,economics,growth,optimizer,types}.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        '^(?!\\./(?:calendar|economics|growth|optimizer|types)(?:\\.ts)?$).+',
        'Crop calculations may only import other crop calculation modules.',
      ),
      'no-restricted-globals': ['error', ...browserPersistence],
      'no-restricted-properties': restrictPersistence,
      'no-restricted-syntax': ['error', disallowDynamicImports],
    },
  },
  {
    files: ['src/{storage,workspace-db,workspace-state,backup}.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        '(?:^|/)(?:react(?:-dom)?|lucide-react|games|coral-island)(?:/|$)|\\.tsx$',
        'Storage depends on generic game data and domain types.',
      ),
      'no-restricted-syntax': [
        'error',
        disallowDynamicImports,
        { selector: 'Literal[value="coral-island"]', message: 'Resolve the game ID from game data.' },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  prettier,
)
