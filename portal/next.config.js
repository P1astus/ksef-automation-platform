/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    // Next.js 16 no longer reads `eslint` here (it now warns "Unrecognized
    // key(s): 'eslint'" and no-ops) - ESLint is decoupled from `next build`
    // and runs only via the separate `next lint` command now.
    typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
