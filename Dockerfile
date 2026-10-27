# fnStart · 飞牛开始页 —— 零依赖运行，镜像里只有 Node 和源码
FROM node:22-alpine

LABEL org.opencontainers.image.title="fnstart" \
      org.opencontainers.image.description="飞牛开始页：飞牛 NAS 专属的浏览器主页，自动发现服务 + 融合飞牛监控" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/IceNoproblem/fnstart"

WORKDIR /app

# 不需要 npm install：项目没有任何第三方依赖
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=3721 \
    DATA_DIR=/data

RUN mkdir -p /data/icons /data/backgrounds
VOLUME ["/data"]
EXPOSE 3721

# 容器里没有 curl，用 node 自己探活。
# 探的是免鉴权的 /api/health —— 探 /api/state 会因为要令牌而永远 401，容器一直 unhealthy。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3721)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
