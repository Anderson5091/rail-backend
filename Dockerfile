FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 quicksend
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

USER quicksend
EXPOSE 3001

ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
