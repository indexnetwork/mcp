# Multi-stage Dockerfile for Bun-based ChatGPT App

# Build stage
FROM oven/bun:1 as builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install all dependencies (including dev dependencies for building)
RUN bun install --frozen-lockfile --dev

# Copy source code
COPY . .

# Build everything (client, widgets, server)
RUN bun run build

# Production stage
FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install all dependencies (vite-express is imported even though only used in dev)
RUN bun install --frozen-lockfile

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy any other necessary files
COPY --from=builder /app/README.md ./README.md

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3002

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run -e "fetch('http://localhost:3002/mcp/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run the server
CMD ["bun", "run", "dist/server/index.js"]
