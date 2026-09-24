FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY nexus-bot.js hash-password.js ./
USER node
ENV DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3000
EXPOSE 3000

# A protected endpoint returning 401 proves the HTTP server is responding.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/status',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "nexus-bot.js"]
