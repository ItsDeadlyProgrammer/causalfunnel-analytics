# Stage 1: build the React dashboard
FROM node:22-alpine AS dashboard
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# Stage 2: API server that also serves the dashboard, tracker and demo site
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/public ./public
COPY tracker /app/tracker
COPY --from=dashboard /app/dashboard/dist /app/dashboard/dist
EXPOSE 4000
USER node
CMD ["node", "src/server.js"]
