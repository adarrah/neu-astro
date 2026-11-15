import eslintPluginAstro from 'eslint-plugin-astro';

export default [
    // Base Astro recommended rules
    ...eslintPluginAstro.configs.recommended,

    // Accessibility rules for .astro files (use 'jsx-a11y-strict' for stricter checks)
    ...eslintPluginAstro.configs['jsx-a11y-recommended'],
];
