# ==========================================
# STAGE 1: Builder
# ==========================================
FROM node:22-alpine AS builder
WORKDIR /app

# Add this line so Prisma can see the variable during build/generate steps
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

COPY package*.json ./
RUN npm ci
COPY . .

RUN npx prisma generate
RUN npm run build

# ==========================================
# STAGE 2: Runner
# ==========================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Add this line here as well so the runner environment has it
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000

CMD ["npm", "run", "start:prod"]