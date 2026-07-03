FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache \
  chromium nss freetype harfbuzz ca-certificates ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]