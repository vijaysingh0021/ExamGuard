import js from '@eslint/js';
export default [js.configs.recommended, { files: ['**/*.ts'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } }, rules: { '@typescript-eslint/no-unused-vars': 'off' } }];
