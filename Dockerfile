FROM node:20-bookworm-slim

# Install lightweight build essentials (git, python, make, g++, ca-certificates) for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Configure git to use HTTPS instead of SSH (fixes git clone exit code 128 in Docker)
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
    && git config --global url."https://github.com/".insteadOf git://github.com/

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Copy only package.json (ignores stale local lockfile)
COPY package.json ./
RUN npm install --omit=dev --no-audit

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
