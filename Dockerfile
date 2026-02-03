# RAF NET CCTV - Multi-stage Docker Build
FROM node:20-alpine AS base

# Install FFmpeg for recording
RUN apk add --no-cache ffmpeg

# Backend build stage
FROM base AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --production

# Frontend build stage
FROM base AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# MediaMTX download stage
FROM alpine:latest AS mediamtx-downloader
RUN apk add --no-cache wget tar
WORKDIR /tmp
RUN wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.0/mediamtx_v1.9.0_linux_amd64.tar.gz && \
    tar -xzf mediamtx_v1.9.0_linux_amd64.tar.gz && \
    chmod +x mediamtx

# Final production image
FROM base
WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy backend
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/

# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy MediaMTX
COPY --from=mediamtx-downloader /tmp/mediamtx ./mediamtx/mediamtx
COPY mediamtx/mediamtx.yml ./mediamtx/

# Create necessary directories
RUN mkdir -p backend/data recordings logs && \
    chmod 755 recordings

# Expose ports
EXPOSE 3000 8888 8889 9997

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start services with PM2
CMD ["pm2-runtime", "deployment/ecosystem.config.cjs"]
