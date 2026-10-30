FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --include=dev

COPY . .
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npx vite build

# SQLite (node:sqlite, Node 22.5+) and outputs live on the Fly volume mounted at /data
RUN mkdir -p /data
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
