# ==========================================
# STAGE 1: Builder
# ==========================================
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package configuration files first to leverage caching
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Generate Prisma Client (crucial step before building)
RUN npx prisma generate

# Build the application
RUN npm run build

# ==========================================
# STAGE 2: Runner
# ==========================================
FROM node:22-alpine AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package configurations and install production-only dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist

# Copy absolute requirements for Prisma migrations/db push
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Expose your application port (adjust if your backend uses a different port, e.g., 8080)
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:prod"]