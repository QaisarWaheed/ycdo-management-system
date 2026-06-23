FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache \
  chromium nss freetype harfbuzz ca-certificates ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

COPY apps/api/package*.json ./
COPY apps/api/tsconfig*.json ./

RUN npm install

COPY apps/api/prisma ./prisma
COPY apps/api/src ./src

RUN npx prisma generate
RUN npm run build
RUN ls -la dist/

RUN mkdir -p uploads/documents uploads/letters

EXPOSE 3000
CMD ["node", "dist/main"]