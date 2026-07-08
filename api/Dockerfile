# Sample-chaser API — runs the Express server via tsx (same entrypoint as `npm run dev`).
FROM node:20-alpine
WORKDIR /app

# Install deps (incl. tsx/typescript devDeps — the server + migrate run through tsx).
COPY package*.json ./
RUN npm ci

# App source (node_modules excluded via .dockerignore so the host copy never clobbers).
COPY . .

ENV PORT=4000
EXPOSE 4000

# Server reads DATABASE_URL / API_KEY / PORT from the environment (see docker-compose.prod.yml).
CMD ["npx", "tsx", "src/server.ts"]
