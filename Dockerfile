FROM node:22-bookworm-slim

WORKDIR /app

# Puppeteer's pinned Chromium (141) hangs navigation when used with
# --proxy-server, so skip it and install current stable Chrome instead.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_CACHE_DIR=/opt/puppeteer \
    NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --install-deps pulls the system libraries Chrome needs. The fonts cover
# Cyrillic/Latin text and emoji so pages and screenshots render properly.
RUN apt-get update \
    && npx puppeteer browsers install chrome@stable --install-deps \
    && apt-get install -y --no-install-recommends fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s "$(ls -d /opt/puppeteer/chrome/linux-*/chrome-linux64 | head -n 1)/chrome" /usr/local/bin/chrome \
    && chrome --version

ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chrome \
    PORT=5000 \
    DEFAULT_HEADLESS=true

COPY --chown=node:node . .
RUN mkdir -p sessions profiles && chown -R node:node /app

USER node

EXPOSE 5000

CMD ["node", "index.js"]
