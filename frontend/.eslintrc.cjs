module.exports = {
    env: { browser: true, es2020: true },
    extends: [
        'eslint:recommended',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        'plugin:react-hooks/recommended',
    ],
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    settings: { react: { version: '18.3' } },
    plugins: ['react-refresh'],
    rules: {
        'react-refresh/only-export-components': [
            'warn',
            { allowConstantExport: true },
        ],
        'react/prop-types': 'off',
        // Prevent usage of Object.hasOwn() which is not supported in older browsers (ES2022+)
        // Use Object.prototype.hasOwnProperty.call(obj, key) instead
        'no-restricted-properties': [
            'error',
            {
                object: 'Object',
                property: 'hasOwn',
                message:
                    'Object.hasOwn() is not supported in older browsers. Use Object.prototype.hasOwnProperty.call(obj, key) instead.',
            },
        ],
    },
};
