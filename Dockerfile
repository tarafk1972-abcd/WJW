# syntax=docker/dockerfile:1
# Build PWA dan API TypeScript secara terpisah, lalu kirim hanya runtime
# dependencies + artefak ke image produksi.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 kadang tidak memiliki prebuilt binary untuk patch Node yang
# sedang dipakai Depot. Siapkan toolchain agar node-gyp dapat membangunnya.
# Header Node di image dipakai langsung agar tidak bergantung pada unduhan
# header dari jaringan build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
ENV npm_config_nodedir=/usr/local \
    PYTHON=/usr/bin/python3

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build && npm run build:server
# better-sqlite3 dibangun pada image Debian yang sama dengan runtime di bawah.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# Fly host memakai UTC; jadwal operasional WJW saat ini memakai WIB.
ENV NODE_ENV=production \
    PORT=8080 \
    WJW_DB=/data/wjw.sqlite \
    TZ=Asia/Jakarta

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# build:server sudah menyalin schema.sql di samping db.js.
COPY --from=build /app/build/server ./build/server

# Proses berjalan sebagai root hanya agar volume Fly yang baru dipasang (milik
# root) dapat dibuatkan SQLite. Aplikasi tidak menerima shell/unggah berkas.
EXPOSE 8080

# Tidak membutuhkan curl/wget tambahan; Node 22 mempunyai fetch bawaan.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build/server/index.js"]
