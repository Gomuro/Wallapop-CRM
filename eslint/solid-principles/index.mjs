import singleResponsibility from "./single-responsibility.mjs"
import openClosed from "./open-closed.mjs"
import liskovSubstitution from "./liskov-substitution.mjs"
import interfaceSegregation from "./interface-segregation.mjs"
import dependencyInversion from "./dependency-inversion.mjs"

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: {
    name: "eslint-plugin-solid-principles",
    version: "1.0.0",
  },
  rules: {
    "single-responsibility": singleResponsibility,
    "open-closed": openClosed,
    "liskov-substitution": liskovSubstitution,
    "interface-segregation": interfaceSegregation,
    "dependency-inversion": dependencyInversion,
  },
}

export default plugin
