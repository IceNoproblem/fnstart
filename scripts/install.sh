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
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  proj=$(docker inspect "$NAME" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
  if [ -z "$proj" ]; then
    say "检测到旧的 docker run 容器，换成 compose 管理（卡片数据不受影响）"
    docker rm -f "$NAME" >/dev/null
  fi
fi

if docker compose version >/dev/null 2>&1; then
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
  say "启动容器（用 docker run，因为这台机器没有 compose 插件）"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" \
    --network host --restart unless-stopped --cap-add=SYS_PTRACE \
    -v "$DIR":/app -v "$DIR/data":/data \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v /proc:/host/proc:ro \
    -w /app -e PORT=3721 -e DATA_DIR=/data \
    --env-file <(grep -E '^(ACCESS_TOKEN)=' .env) \
    node:22-alpine node server.js
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
echo "  想要右侧监控面板（可选）："
echo "    sudo bash $DIR/scripts/install-fnmonitor.sh"
echo "────────────────────────────────────────"
