FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
ENV NEXT_TELEMETRY_DISABLED 1

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# OCR/email/tokened-upload source documents (see lib/file-storage.ts) live
# on the ocr_uploads named volume mounted here in docker-compose.yml. Docker
# only initializes a named volume's ownership from what's already in the
# image at that path the first time it's created - create it owned by the
# nextjs user (not root, which `RUN mkdir` alone would produce) now so that
# initialization doesn't leave the app unable to write to its own volume.
RUN mkdir -p uploads && chown nextjs:nodejs uploads

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# pdf-parse and tesseract.js both load part of their real functionality
# dynamically at runtime (pdf-parse: a try/catch require of @napi-rs/canvas;
# tesseract.js: a worker-script file path built at runtime, not a static
# import) - standalone output's file tracing can't see either and never
# copied them into .next/standalone/node_modules, so every real OCR call
# (ocr/route.ts, email/sync/route.ts) threw at runtime ("DOMMatrix is not
# defined" / "Cannot find module .../worker-script/node/index.js") despite
# both packages being real dependencies present in the full build. Found
# live, not by the test suite - copying them explicitly from the deps
# stage's full node_modules (before standalone pruning removes them) is
# more reliable than fighting the tracer's heuristics further.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@napi-rs ./node_modules/@napi-rs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/tesseract.js ./node_modules/tesseract.js
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/tesseract.js-core ./node_modules/tesseract.js-core
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pdf-parse ./node_modules/pdf-parse
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist

USER nextjs

EXPOSE 3000

ENV PORT 3000
# set hostname to localhost
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
