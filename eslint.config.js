// Flat config with no plugin imports, so it runs with any ESLint 9+ install.
const shared = {
  ecmaVersion: 2024,
  sourceType: 'module',
};

const rules = {
  'constructor-super': 'error',
  'no-const-assign': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-fallthrough': 'error',
  'no-redeclare': 'error',
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-unsafe-finally': 'error',
  'no-self-compare': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always'],
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

const browserGlobals = Object.fromEntries(
  [
    'window',
    'document',
    'localStorage',
    'navigator',
    'console',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'devicePixelRatio',
    'ResizeObserver',
    'performance',
    'HTMLElement',
    'getComputedStyle',
    'matchMedia',
    'URL',
    'Event',
    'KeyboardEvent',
  ].map((g) => [g, 'readonly']),
);

const nodeGlobals = Object.fromEntries(
  ['process', 'console', 'Buffer', 'URL', 'setTimeout', 'clearTimeout'].map((g) => [g, 'readonly']),
);

export default [
  { ignores: ['node_modules/', 'test/.tmp/'] },
  { files: ['public/**/*.js'], languageOptions: { ...shared, globals: browserGlobals }, rules },
  {
    files: ['*.js', 'test/**/*.js'],
    languageOptions: { ...shared, globals: nodeGlobals },
    rules,
  },
];
