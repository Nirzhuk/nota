# Nota's landing site (apps/landing) as a static image.
# Coolify: build pack Dockerfile, base directory "/", Dockerfile "/Dockerfile", port 80.
# Only the landing workspace is installed so the desktop toolchain never enters the build.
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/landing/package.json apps/landing/
COPY apps/desktop/package.json apps/desktop/
COPY apps/extension/package.json apps/extension/
RUN bun install --frozen-lockfile --filter @nota/landing
COPY apps/landing apps/landing
WORKDIR /app/apps/landing
RUN bun run web:build

FROM nginx:alpine
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
