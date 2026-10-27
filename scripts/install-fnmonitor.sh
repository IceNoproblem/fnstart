#!/usr/bin/env bash
#
# fnStart 的配套脚本：一键装好「飞牛监控 fnMonitor」
#
# fnMonitor 是第三方开源应用（MIT），作者 MisiteQ：https://github.com/MisiteQ/fnmonitor
# 它不是 Docker 镜像，所以不能写进 docker-compose.yml —— 这个脚本做的是
# 「查架构 → 拉最新 FPK → 调飞牛应用中心装 → 等端口就绪」这一串，省得你手动点。
#
# 用法：
#   sudo bash scripts/install-fnmonitor.sh
#
# 国内访问 GitHub 慢的话，可以挂个加速前缀：
#   sudo GH_PROXY=https://ghfast.top/ bash scripts/install-fnmonitor.sh
#
set -euo pipefail

APP=fnmonitor
REPO=MisiteQ/fnmonitor
PORT=8777
GH_PROXY="${GH_PROXY:-}"

say()  { printf '\033[36m[fnStart]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[fnStart]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[fnStart]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "需要 root 权限，请用：sudo bash $0"

probe() { curl -fsS -m 3 "http://127.0.0.1:${PORT}/api/overview" >/dev/null 2>&1; }

# ---------- 1. 已经在跑，什么都不做 ----------
if probe; then
  say "检测到 ${PORT} 端口已经有飞牛监控在跑，跳过安装。"
  exit 0
fi

# ---------- 2. 装了但没起来，试着拉起来 ----------
if [ -d "/vol1/@appcenter/${APP}" ] || [ -d "/vol2/@appcenter/${APP}" ]; then
  if command -v appcenter-cli >/dev/null 2>&1; then
    warn "fnMonitor 已安装但服务没在运行，尝试启动…"
    appcenter-cli start "${APP}" >/dev/null 2>&1 || true
    sleep 4
    if probe; then
      say "启动成功，监控已在 ${PORT} 就绪。"
      exit 0
    fi
    warn "没起来。去飞牛桌面点一下「飞牛监控」图标，或到应用中心看它的状态。"
    exit 1
  fi
fi

# ---------- 3. 判断架构 ----------
case "$(uname -m)" in
  x86_64|amd64)  ARCH=x86 ;;
  aarch64|arm64) ARCH=arm ;;
  *) die "不认识的 CPU 架构：$(uname -m)，请手动下载 FPK 安装" ;;
esac
say "CPU 架构：$(uname -m) → 安装包后缀 ${ARCH}"

command -v appcenter-cli >/dev/null 2>&1 || die "找不到 appcenter-cli，这台机器的飞牛版本可能太旧，请手动在应用中心安装"
command -v curl >/dev/null 2>&1 || die "需要 curl"

# ---------- 4. 查最新版本 ----------
say "查询最新版本…"
API="https://api.github.com/repos/${REPO}/releases/latest"
JSON="$(curl -fsSL -m 25 "${GH_PROXY}${API}")" || die "连不上 GitHub，可以改用 FnDepot 应用源安装，或加 GH_PROXY 重试"

TAG="$(printf '%s' "$JSON" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
URL="$(printf '%s' "$JSON" | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | sed 's/.*"\(https[^"]*\)"$/\1/' | grep -- "-${ARCH}\.fpk$" | head -1)"

[ -n "${TAG}" ] || die "没能解析最新版本号，请手动下载安装"
[ -n "${URL}" ] || die "最新版 ${TAG} 里没找到 ${ARCH} 架构的安装包"

say "最新版：${TAG}"
say "下载：${URL}"

# ---------- 5. 下载并安装 ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fL --progress-bar -m 180 -o "${TMP}/${APP}-${TAG}-${ARCH}.fpk" "${GH_PROXY}${URL}" \
  || die "下载失败。网络问题可以加 GH_PROXY，或手动下载后到应用中心「手动安装」"

say "安装中（会调飞牛应用中心，几秒钟）…"
appcenter-cli install-fpk "${TMP}/${APP}-${TAG}-${ARCH}.fpk" --volume 1 \
  || die "安装失败。手动安装入口可能是关的，先执行：appcenter-cli manual-install enable"

# ---------- 6. 等端口起来 ----------
say "等待服务就绪…"
for _ in $(seq 1 25); do
  if probe; then
    say "装好了，飞牛监控已在 ${PORT} 就绪。"
    say "现在可以去部署 fnStart 了。"
    exit 0
  fi
  sleep 1
done

warn "安装完成，但 ${PORT} 端口还没起来。"
warn "去飞牛桌面点一下「飞牛监控」图标，或到应用中心确认它已启动。"
warn "起来之后 fnStart 会自动连上，不用改配置。"
