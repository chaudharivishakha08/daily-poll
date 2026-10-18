FROM node:20-bookworm-slim

# Install lightweight build essentials (git, python, make, g++) for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Copy only package.json (ignores stale local lockfile)
COPY package.json ./
RUN npm install --omit=dev --no-audit

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
