#!/usr/bin/env sh
# 生成一个 fnStart 访问令牌。
#
#   ./scripts/new-token.sh              只打印，不动任何文件
#   ./scripts/new-token.sh --write      写进当前目录的 .env（已存在则只替换 ACCESS_TOKEN 那一行）
#   ./scripts/new-token.sh --write 32   同上，但是 32 字节（64 个十六进制字符）
#
# 为什么不用「首次启动自动生成」：隐式生成的密码最容易丢。
# 它躺在某个日志或容器环境变量里，谁也没记住，换机器就找不回来。
# 一条命令显式生成、当场抄进密码管理器，反而最不容易丢。
set -eu

BYTES=16
WRITE=0

for arg in "$@"; do
  case "$arg" in
    --write) WRITE=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *[!0-9]*) echo "看不懂这个参数：$arg" >&2; exit 2 ;;
    *) BYTES="$arg" ;;
  esac
done

if [ "$BYTES" -lt 8 ]; then
  echo "至少 8 字节（16 个十六进制字符），不然太短了" >&2
  exit 2
fi

gen() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  elif [ -r /dev/urandom ]; then
    od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'
  elif command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"
  else
    echo "找不到 openssl / /dev/urandom / node，没法生成随机数" >&2
    exit 1
  fi
}

TOKEN=$(gen "$BYTES")

if [ "$WRITE" -eq 0 ]; then
  echo
  echo "  访问令牌：$TOKEN"
  echo
  echo "  写进 .env："
  echo "    ACCESS_TOKEN=$TOKEN"
  echo
  echo "  或者直接运行：./scripts/new-token.sh --write"
  exit 0
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "已从 .env.example 复制出 .env"
  else
    : > .env
    echo "已新建 .env"
  fi
fi

# 已经有 ACCESS_TOKEN 这一行就整行替换，没有就追加。用临时文件避免改坏原文件。
TMP=$(mktemp)
if grep -q '^ACCESS_TOKEN=' .env; then
  awk -v t="$TOKEN" '
    /^ACCESS_TOKEN=/ { print "ACCESS_TOKEN=" t; next }
    { print }
  ' .env >"$TMP"
  echo "已更新 .env 里的 ACCESS_TOKEN"
else
  cat .env >"$TMP"
  printf '\nACCESS_TOKEN=%s\n' "$TOKEN" >>"$TMP"
  echo "已在 .env 末尾追加 ACCESS_TOKEN"
fi
mv "$TMP" .env
chmod 600 .env

echo
echo "  新令牌：$TOKEN"
echo "  已写入 .env（权限 600）。现在跑：docker compose up -d"
echo
echo "  换令牌会让所有已登录设备立刻掉线 —— 这也是唯一的「远程踢人」手段。"
