#!/usr/bin/env bash
# fnStart 一键安装 / 升级。
#
#   sudo bash scripts/install.sh
#
# 干四件事：拉源码 → 生成访问令牌 → 起容器 → 打印地址和令牌。
# 可以重复跑：已经装好的机器不会重复生成令牌，也不会丢数据（数据在 data/，跟容器分开）。
set -euo pipefail

DIR=${FNSTART_DIR:-/vol1/docker/fnstart}
REPO=${FNSTART_REPO:-https://github.com/IceNoproblem/fnstart.git}
NAME=fnstart
PROXY=fnstart-docker-proxy
# auto = 有 compose 就用 compose；也可以强制 compose / run
ENGINE=${FNSTART_ENGINE:-auto}

say() { printf '\033[36m›\033[0m %s\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "没装 Docker。先在飞牛「应用中心」装 Docker。"
command -v git >/dev/null 2>&1 || die "没装 git。飞牛自带 git，没有就先装。"

# ---------- 1. 源码 ----------
if [ -d "$DIR/.git" ]; then
  say "已有源码，尝试更新到最新"
  git -C "$DIR" pull --ff-only >/dev/null 2>&1 || warn "更新失败（网络或本地改动），用现有代码继续"
elif [ -n "$(ls -A "$DIR" 2>/dev/null || true)" ]; then
  # 有人是下载 zip 传上来的，不是 git 仓库 —— 直接拿现有文件跑，别再 clone 覆盖他
  say "目录里已有源码（不是 git 仓库），直接使用"
else
  say "下载源码到 $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 "$REPO" "$DIR" || die "下载失败。国内网络可换镜像：sudo FNSTART_REPO=https://ghfast.top/$REPO bash scripts/install.sh"
fi
cd "$DIR"

# ---------- 2. 访问令牌 ----------
NEW_TOKEN=0
if [ -f .env ] && grep -qE '^ACCESS_TOKEN=.+' .env; then
  ok "已有访问令牌，保持不动"
else
  say "生成访问令牌"
  [ -x scripts/new-token.sh ] || chmod +x scripts/new-token.sh
  ./scripts/new-token.sh --write >/dev/null
  NEW_TOKEN=1
fi

# ---------- 3. 起容器 ----------
# 老版本可能是用 docker run 起的，没有 compose 标签。compose 会说容器名被占用，
# 所以先把它拆掉 —— 卡片数据在 $DIR/data 里，容器只是壳子，删了不影响。
for c in "$NAME" "$PROXY"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    proj=$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
    if [ -z "$proj" ]; then
      say "检测到旧的 docker run 容器 $c，重建（卡片数据不受影响）"
      docker rm -f "$c" >/dev/null
    fi
  fi
done

# ---------- 3.1 存储空间：探测宿主机实际有哪些 /volN，生成挂载覆盖 ----------
# 面板要显示每个存储空间的容量，容器就得看得见它们。写死在 compose 里会让
# 没有该卷的机器上凭空出现空目录，所以按机器实际情况生成 override。
VOLS=""
for v in /vol1 /vol2 /vol3 /vol4 /vol5 /vol6 /vol7 /vol8; do
  [ -d "$v" ] && VOLS="$VOLS $v"
done
if [ -n "$VOLS" ]; then
  OVR="$DIR/docker-compose.override.yml"
  {
    echo "# 由 install.sh 自动生成：把宿主机上存在的存储空间只读挂进容器，"
    echo "# 供监控面板读取各卷容量。换机器/加卷后重新跑一次 install.sh 即可。"
    echo "# 手改会被下次安装覆盖。"
    echo "services:"
    echo "  fnstart:"
    echo "    volumes:"
    for v in $VOLS; do
      echo "      - $v:/host$v:ro"
    done
  } > "$OVR"
  say "检测到存储空间：$VOLS"
else
  rm -f "$DIR/docker-compose.override.yml" 2>/dev/null || true
fi

use_compose=0
if [ "$ENGINE" = compose ]; then
  docker compose version >/dev/null 2>&1 || die "指定了 compose 但这台机器没有 compose 插件"
  use_compose=1
elif [ "$ENGINE" = run ]; then
  use_compose=0
elif docker compose version >/dev/null 2>&1; then
  use_compose=1
fi

if [ "$use_compose" = 1 ]; then
  say "启动容器（第一次要构建镜像，一两分钟）"
  # 构建日志太吵，只在失败时把最后几行甩出来 —— 成功就安静
  LOG=$(mktemp)
  if ! docker compose up -d --build >"$LOG" 2>&1; then
    echo
    tail -20 "$LOG"
    echo
    die "启动失败。完整日志：$LOG（也可以换成 README 里的 docker run 方式）"
  fi
  rm -f "$LOG"
else
  say "没有 compose 插件，用 docker run 起两个容器（应用 + socket 代理）"
  # 1) socket 代理：只有它挂 docker.sock，只放行只读端点
  docker rm -f "$PROXY" >/dev/null 2>&1 || true
  docker run -d --name "$PROXY" \
    --network host --restart unless-stopped \
    -v "$DIR":/app:ro \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -w /app -e PROXY_LISTEN=127.0.0.1:2375 \
    node:22-alpine node docker-proxy.mjs >/dev/null

  # 2) 主应用：**不挂** socket，通过代理读容器列表
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" \
    --network host --restart unless-stopped --cap-add=SYS_PTRACE \
    -v "$DIR":/app -v "$DIR/data":/data \
    -v /proc:/host/proc:ro -v /sys:/host/sys:ro \
    $(for v in $VOLS; do printf -- "-v %s:/host%s:ro " "$v" "$v"; done) \
    -w /app -e PORT=3721 -e DATA_DIR=/data \
    -e DOCKER_SOCK=http://127.0.0.1:2375 \
    --env-file <(grep -E '^(ACCESS_TOKEN)=' .env) \
    node:22-alpine node server.js >/dev/null
fi

# ---------- 4. 结果 ----------
sleep 2
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "${IP:-}" ] || IP="你的NAS地址"

echo
echo "────────────────────────────────────────"
ok "装好了"
echo
echo "  打开：  http://$IP:3721"
if [ "$NEW_TOKEN" = 1 ]; then
  echo "  令牌：  $(grep -E '^ACCESS_TOKEN=' .env | cut -d= -f2)"
  echo "          ↑ 只显示这一次，记进密码管理器；忘了可以用"
  echo "            grep ACCESS_TOKEN $DIR/.env 再查"
else
  echo "  令牌：  沿用原来的（grep ACCESS_TOKEN $DIR/.env）"
fi
echo
echo "  安全：  Docker socket 已收进只读代理（$PROXY），主容器碰不到 socket"
echo "  想要右侧监控面板（可选）："
echo "    sudo bash $DIR/scripts/install-fnmonitor.sh"
echo "────────────────────────────────────────"
