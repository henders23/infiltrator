import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Determinism guard: the sim must be reproducible from (seed, orders).
  // Ban wall-clock time and unseeded randomness inside src/sim/**.
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'sim must use the seeded RNG (sim/rng.ts)' },
        { object: 'Date', property: 'now', message: 'sim must not read wall-clock time' },
        { object: 'performance', property: 'now', message: 'sim must not read wall-clock time' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'sim must not read wall-clock time' },
      ],
    },
  },
);
