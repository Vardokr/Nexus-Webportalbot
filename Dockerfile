FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

RUN mkdir /data && chown node:node /data
COPY nexus-bot.js security.js hash-password.js bootstrap.js setup.js setup.html setup.css setup-client.js ./
USER node
ENV DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3000 CONFIG_DIR=/data
EXPOSE 3000

# Health probes do not consume a visitor's login budget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(4000)}).then(async r=>process.exit(r.ok&&(await r.json()).service==='nexus-watchdog'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "bootstrap.js"]
