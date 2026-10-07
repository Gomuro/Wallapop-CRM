import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import solidPrinciples from "./eslint/solid-principles/index.mjs";

const solidPlugin = {
  plugins: {
    "solid-principles": solidPrinciples,
  },
};

const solidRules = {
  "solid-principles/single-responsibility": "warn",
  "solid-principles/open-closed": "warn",
  "solid-principles/liskov-substitution": "warn",
  "solid-principles/interface-segregation": "warn",
  "solid-principles/dependency-inversion": "warn",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ...solidPlugin,
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
      "middleware.ts",
      "server/src/**/*.ts",
    ],
    ignores: ["**/*.{test,spec}.ts", "components/ui/**"],
    rules: solidRules,
  },
  {
    ...solidPlugin,
    files: ["**/*.tsx"],
    rules: {
      "solid-principles/single-responsibility": [
        "warn",
        {
          maxFunctionLines: 120,
          maxFileLines: 400,
          maxComplexity: 15,
          maxClassMethods: 10,
          maxDepth: 4,
        },
      ],
      "solid-principles/interface-segregation": [
        "warn",
        {
          maxParams: 4,
          maxInterfaceMembers: 12,
          maxPropsMembers: 16,
        },
      ],
    },
  },
  {
    ...solidPlugin,
    files: ["server/src/**/*.ts"],
    rules: {
      "solid-principles/single-responsibility": [
        "warn",
        {
          maxFunctionLines: 40,
          maxFileLines: 300,
          maxComplexity: 12,
          maxClassMethods: 10,
          maxDepth: 3,
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".history/**",
    "server/generated/**",
    "components/ui/**",
    "**/node_modules/**",
  ]),
]);

export default eslintConfig;
