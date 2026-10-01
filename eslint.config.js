export default [
  {
    ignores: ["public/**", "dist/**", "node_modules/**"]
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        Promise: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        indexedDB: "readonly",
        firebase: "readonly"
      }
    },
    rules: {
      "no-undef": "warn",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-unreachable": "warn",
      "no-dupe-keys": "warn",
      "no-constant-condition": "warn"
    }
  }
];
