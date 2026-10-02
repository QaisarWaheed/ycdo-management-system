FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache \
  tini chromium nss freetype harfbuzz ca-certificates ttf-freefont ttf-liberation font-noto fontconfig

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Alpine chromium package installs /usr/bin/chromium (not chromium-browser)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY apps/api/package*.json ./
COPY apps/api/tsconfig*.json ./

# Install ALL deps including devDependencies (needed for nest CLI)
RUN npm install --include=dev

COPY apps/api/prisma ./prisma
COPY apps/api/src ./src

RUN npx prisma generate
RUN npm run build
RUN ls -la dist/

# Remove devDependencies after build
RUN npm prune --production

RUN mkdir -p uploads/documents uploads/letters

ENV NODE_ENV=production
EXPOSE 3000
# tini runs as PID 1 and reaps the zombie processes every Puppeteer/Chromium
# launch leaves behind. Without it Node is PID 1, zombies pile up until the
# container hits its process limit and Chromium fails with "can't fork".
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/src/main"]