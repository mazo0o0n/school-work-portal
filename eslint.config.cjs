const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      ".wrangler/**",
      "tmp/**",
      "report-automation/**",
      "knowledge-files/**"
    ]
  },

  js.configs.recommended,

  {
    files: ["assets/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser
      }
    },
    rules: {
      "no-console": "off",
      "no-debugger": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
      "eqeqeq": ["warn", "always"],
      "prefer-const": "warn"
    }
  },

  {
    files: [
      "src/**/*.js",
      "functions/**/*.js",
      "tools/**/*.js",
      "tests/**/*.js"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        caches: "readonly"
      }
    },
    rules: {
      "no-console": "off",
      "no-debugger": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
      "eqeqeq": ["warn", "always"],
      "prefer-const": "warn"
    }
  },

  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    }
  }
];
