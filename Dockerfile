# Build officially on a stable Node 22 (Satisfies Vite 6.4+ requirements)
FROM node:22.14.0-bookworm AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY public-menu/package.json ./public-menu/

# IMPORTANT: Resolve "at once" by installing standard packages
# No --include=optional here because we want standard Vite deps
RUN npm install

# Copy the rest
COPY . .

# Accept Railway build arguments
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

# Expose them to the Vite build process
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Build both applications
RUN npm run build

# Final Stage: Production Environment
FROM node:22.14.0-bookworm-slim

WORKDIR /app

# Copy built assets and server code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public-menu/dist ./public-menu/dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
# Copy .env file
COPY --from=builder /app/.env* ./

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start 
CMD ["node", "server/server.js"]
