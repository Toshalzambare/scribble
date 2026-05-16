# Stage 1: Build client
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY client/package.json* client/
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server/ server/
COPY --from=builder /app/client/dist client/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
