/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    // Next.js 16 no longer reads `eslint` here (it now warns "Unrecognized
    // key(s): 'eslint'" and no-ops) - ESLint is decoupled from `next build`
    // and runs only via the separate `next lint` command now.

    // pdf-parse's runtime require('@napi-rs/canvas') and tesseract.js's
    // worker-script loading both get compiled into Turbopack's own bundled
    // module-resolution runtime rather than a real Node.js require() - so
    // even with the actual files present on disk (portal/Dockerfile copies
    // them explicitly from the pre-pruning node_modules), Turbopack's
    // runtime still can't resolve them, since it's resolving against its
    // own bundle graph, not the filesystem. serverExternalPackages tells
    // Next.js not to bundle these at all and let real Node.js require()
    // handle them at runtime instead - the documented fix for exactly this
    // class of dynamic-require/native-binary dependency.
    serverExternalPackages: ['pdf-parse', '@napi-rs/canvas', 'tesseract.js', 'tesseract.js-core'],
};

module.exports = nextConfig;
