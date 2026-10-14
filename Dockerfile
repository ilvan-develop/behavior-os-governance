# Behavior-OS Dockerfile

FROM node:22-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.4.0

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY plugins/opencode-v2/package.json plugins/opencode-v2/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build all packages
RUN pnpm build

# Set environment
ENV NODE_ENV=production

# Default command: the MCP server speaks JSON-RPC over stdio (no HTTP transport,
# so there is no port to expose).
CMD ["pnpm", "mcp:start"]
