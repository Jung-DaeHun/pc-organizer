import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * 네트워크로 나가는 코드는 src/main/lib/anthropic.ts 한 곳뿐이다.
 * 무엇을 보내는지 한 파일만 보면 알 수 있어야 하고, 서비스는 SDK 를 몰라야 가짜 호출로 테스트할 수 있다.
 *
 * ESLint 는 같은 규칙이 여러 블록에 있으면 마지막 블록 값으로 통째로 덮는다.
 * 그래서 no-restricted-imports 를 가진 블록마다 이 패턴을 함께 넣어야 한다.
 */
const SDK_IMPORT_PATTERN = {
  group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*'],
  message: 'Anthropic SDK 는 src/main/lib/anthropic.ts 에서만 import 한다'
}

export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'dist/**', 'node_modules/**', 'docs/**']
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------------------------------------------------------------- 공통
  {
    files: ['**/*.{ts,tsx,mts,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module'
    },
    rules: {
      // 안 쓰는 값은 지운다. 다만 의도적으로 버리는 인자는 _ 로 표시할 수 있게 둔다
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      // any 로 도망가면 타입 계약이 무의미해진다
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error'
    }
  },

  // ------------------------------------------------- main / preload (Node)
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      // main 은 화면이 없다. DOM 전역을 쓰고 있다면 잘못된 곳에 코드를 둔 것이다
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'main 프로세스에는 window가 없다' },
        { name: 'document', message: 'main 프로세스에는 document가 없다' }
      ]
    }
  },

  // ---------------------------------------------------------- 네트워크 경계
  {
    // src 전체에 SDK import 를 막는다. 아래 서비스·renderer 블록이 이 규칙을 덮어쓰므로
    // 그 블록들도 SDK_IMPORT_PATTERN 을 다시 넣는다.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/main/lib/anthropic.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [SDK_IMPORT_PATTERN] }]
    }
  },

  // ---------------------------------------------------------------- 서비스
  {
    // 스캐너와 집계 로직은 Electron에 의존하지 않아야 Vitest에서 그대로 돌고,
    // 나중에 worker_threads로 옮길 수 있다. store/temp 는 userData 경로 때문에 예외.
    files: ['src/main/services/**/*.ts'],
    ignores: ['src/main/services/store.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                '서비스 로직은 electron에 의존하지 않는다. 앱 경로 같은 값은 인자로 받아라.'
            }
          ],
          patterns: [SDK_IMPORT_PATTERN]
        }
      ]
    }
  },

  // ---------------------------------------------------------------- renderer
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // renderer 는 Node 에 닿을 수 없다. 파일시스템은 preload 가 열어준 창구로만 간다.
      // 이 규칙이 걸린다면 그 코드는 main 으로 옮겨야 한다.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'renderer 에서는 Node 모듈을 쓸 수 없다' },
            {
              group: ['electron'],
              message: 'renderer 는 window.api 로만 main 과 통신한다'
            },
            SDK_IMPORT_PATTERN
          ]
        }
      ]
    }
  },

  // ---------------------------------------------------------------- 테스트
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // -------------------------------------------------- 설정 파일 · 훅 스크립트
  {
    files: [
      '*.config.{ts,mjs,js}',
      'electron.vite.config.ts',
      'vitest.config.ts',
      '.claude/hooks/**/*.{mjs,js}'
    ],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      // Vite 설정은 CJS 로 번들되어 __dirname 을 쓴다
      'no-undef': 'off'
    }
  }
)
