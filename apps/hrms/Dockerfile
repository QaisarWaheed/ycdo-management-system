FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./

# Install ALL deps including devDependencies (PostCSS, Tailwind, etc.)
RUN npm install

COPY vite.config.ts ./
COPY tsconfig*.json ./
COPY index.html ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY src ./src
COPY public ./public

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npx vite build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]