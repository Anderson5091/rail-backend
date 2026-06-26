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

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# 👇 ADD THIS LINE HERE TO COPY THE GENERATED CLIENT
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000

CMD ["npm", "run", "start:prod"]