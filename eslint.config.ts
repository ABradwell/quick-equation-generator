import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'test/.tmp/', 'public/'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-fallthrough': 'error',
      'no-unsafe-finally': 'error',
      'no-self-compare': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
