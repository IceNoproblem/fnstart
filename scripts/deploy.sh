#!/usr/bin/env bash
# fnStart 一键部署 —— 拉现成镜像，不构建、不需要源码。
#
#   curl -fsSL https://raw.githubusercontent.com/IceNoproblem/fnstart/main/scripts/deploy.sh | sudo bash
#
# 国内拉不到 raw.githubusercontent.com 就用镜像站：
#   curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/IceNoproblem/fnstart/main/scripts/deploy.sh | sudo bash
#
# 可重复跑：已经装好的机器不会重新生成令牌，也不动 data/。
# 环境变量：
#   FNSTART_DIR    安装目录，默认 /vol1/docker/fnstart
#   FNSTART_IMAGE  镜像，默认 icenoproblem/fnstart:latest
#   PORT           监听端口，默认 3721
set -euo pipefail

DIR=${FNSTART_DIR:-/vol1/docker/fnstart}
IMAGE=${FNSTART_IMAGE:-icenoproblem/fnstart:latest}
PORT=${PORT:-3721}
NAME=fnstart
PROXY=fnstart-docker-proxy
RAW=https://raw.githubusercontent.com/IceNoproblem/fnstart/main/docker-compose.yml

say()  { printf '\033[36m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "没装 Docker。先在飞牛「应用中心」装 Docker。"
docker compose version >/dev/null 2>&1 || die "这台机器的 Docker 没有 compose 插件，升级 Docker 再试。"
command -v curl >/dev/null 2>&1 || die "需要 curl。"

mkdir -p "$DIR"
cd "$DIR"

# ---------- 1. compose 文件 ----------
if [ -f docker-compose.yml ] && grep -q 'container_name: fnstart' docker-compose.yml 2>/dev/null; then
  ok "已有 docker-compose.yml，保持不动"
else
  say "下载 docker-compose.yml"
  # 先直连，失败再走镜像站（国内直连 raw.githubusercontent.com 常被掐）
  curl -fsSL --connect-timeout 10 --max-time 60 "$RAW" -o docker-compose.yml 2>/dev/null \
    || curl -fsSL --connect-timeout 10 --max-time 60 "https://ghfast.top/$RAW" -o docker-compose.yml 2>/dev/null \
    || die "下载 compose 文件失败。手动下载后放到 $DIR 再跑一次：
  https://github.com/IceNoproblem/fnstart/blob/main/docker-compose.yml"
fi

# ---------- 2. 访问令牌 + 镜像 ----------
NEW_TOKEN=0
TOKEN=$(sed -n 's/^ACCESS_TOKEN=//p' .env 2>/dev/null | tail -1 || true)
if [ -z "$TOKEN" ]; then
  TOKEN=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  NEW_TOKEN=1
fi

touch .env
grep -q '^ACCESS_TOKEN=' .env || echo "ACCESS_TOKEN=$TOKEN" >> .env
if grep -q '^FNSTART_IMAGE=' .env; then
  sed -i "s|^FNSTART_IMAGE=.*|FNSTART_IMAGE=$IMAGE|" .env
else
  echo "FNSTART_IMAGE=$IMAGE" >> .env
fi
grep -q '^PORT=' .env || echo "PORT=$PORT" >> .env
chmod 600 .env
[ "$NEW_TOKEN" = 1 ] && ok "已生成访问令牌" || ok "沿用已有访问令牌"

# ---------- 3. 清掉同名的手工容器 ----------
# 老版本可能是 docker run 起的，没有 compose 标签，compose 会报「容器名被占用」。
for c in "$NAME" "$PROXY"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    proj=$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
    if [ -z "$proj" ]; then
      say "检测到旧的 docker run 容器 ${c}，重建（卡片数据在 ${DIR}/data，不受影响）"
      docker rm -f "$c" >/dev/null
    fi
  fi
done

# ---------- 4. 拉镜像并启动 ----------
say "拉取镜像 $IMAGE（约 170 MB，第一次会慢）"
docker compose pull || die "拉取失败。国内直连 Docker Hub 不通的话，先给 daemon 配镜像加速器再跑。"

say "启动容器"
docker compose up -d || die "启动失败。看 docker logs $NAME --tail 20"

# ---------- 5. 自检 ----------
sleep 3
CODE=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)
IP=$(hostname -I 2>/dev/null | awk '{print $1}') || true
[ -n "${IP:-}" ] || IP="你的NAS地址"

echo
echo "────────────────────────────────────────"
if [ "$CODE" = 200 ]; then
  ok "装好了"
else
  warn "容器起来了但健康检查没通过（HTTP ${CODE}），看日志：docker logs $NAME --tail 30"
fi
echo
echo "  打开：  http://${IP}:${PORT}"
if [ "$NEW_TOKEN" = 1 ]; then
  echo "  令牌：  $TOKEN"
  echo "          ↑ 只显示这一次，记进密码管理器；忘了用 grep ACCESS_TOKEN ${DIR}/.env 再查"
else
  echo "  令牌：  沿用原来的（grep ACCESS_TOKEN ${DIR}/.env）"
fi
echo
echo "  升级：  重跑同一条命令即可，data/ 不动"
echo "  换版本：FNSTART_IMAGE=icenoproblem/fnstart:1.7.1 sudo -E bash deploy.sh"
echo "────────────────────────────────────────"
