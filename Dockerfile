FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js store.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=18090
ENV MAILHUB_DATA_DIR=/data

EXPOSE 18090

VOLUME ["/data"]

CMD ["node", "server.js"]
