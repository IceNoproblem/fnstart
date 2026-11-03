# 纯 docker compose 安装

不需要安装脚本、不需要 `git clone`、不需要 Dockerfile。
只用一份 compose 文件和一条 `docker compose` 命令。

---

## 一、最省事：一条命令

```bash
mkdir -p /vol1/docker/fnstart && cd /vol1/docker/fnstart
curl -fsSLO https://raw.githubusercontent.com/IceNoproblem/fnstart/main/docker-compose.yml
printf 'ACCESS_TOKEN=%s\n' "$(openssl rand -hex 16)" > .env
docker compose pull && docker compose up -d
```

跑完打开 `http://你的NAS地址:3721`，令牌在 `.env` 里：

```bash
grep ACCESS_TOKEN .env
```

> 拉不动 `raw.githubusercontent.com` 的话，把 URL 换成
> `https://ghfast.top/https://raw.githubusercontent.com/...`

---

## 二、仓库访问不了：自己写一份 compose

国内机器经常连不上 GitHub。直接在 NAS 上把这坨贴进去，效果和上面完全一样。

```bash
mkdir -p /vol1/docker/fnstart && cd /vol1/docker/fnstart

cat > docker-compose.yml <<'YAML'
services:
  docker-proxy:
    image: icenoproblem/fnstart:latest
    container_name: fnstart-docker-proxy
    restart: unless-stopped
    network_mode: host
    command: ["node", "docker-proxy.mjs"]
    environment:
      PROXY_LISTEN: 127.0.0.1:2375
      DOCKER_SOCK_INNER: /var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    healthcheck:
      disable: true
    logging:
      driver: json-file
      options:
        max-size: "2m"
        max-file: "1"

  fnstart:
    image: icenoproblem/fnstart:latest
    container_name: fnstart
    restart: unless-stopped
    network_mode: host
    environment:
      PORT: 3721
      DATA_DIR: /data
      DOCKER_SOCK: http://127.0.0.1:2375
      PROBE_TIMEOUT: 2500
      ACCESS_TOKEN: ${ACCESS_TOKEN:-}
      TRUST_PROXY: "1"
    cap_drop:
      - ALL
    cap_add:
      - SYS_PTRACE
      - DAC_OVERRIDE
      - DAC_READ_SEARCH
    security_opt:
      - no-new-privileges:true
    volumes:
      - ./data:/data
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"
YAML

printf 'ACCESS_TOKEN=%s\n' "$(openssl rand -hex 16)" > .env
docker compose pull && docker compose up -d
```

---

## 三、拉不到 Docker Hub

镜像在 Docker Hub 上，国内直连大概率超时（`context deadline exceeded`）。
两种绕法，任选其一。

**办法 A：给 daemon 配镜像加速（一劳永逸）**

飞牛：「Docker → 设置 → 镜像源」，填一个能用的加速地址，回终端重跑：

```bash
docker compose pull && docker compose up -d
```

**办法 B：从别的源拉下来，打个同样的标签**

```bash
docker pull docker.m.daocloud.io/icenoproblem/fnstart:latest
docker tag  docker.m.daocloud.io/icenoproblem/fnstart:latest icenoproblem/fnstart:latest
docker compose up -d
```

镜像已在本地，compose 不会再去拉。这个镜像有 `linux/amd64` 和 `linux/arm64` 两个架构，
打个标签不影响架构信息。

---

## 四、多个存储卷（`/vol2`、`/vol3`…）

compose 不写死卷，因为每台机器不一样。要有几个就补几个，只读挂进去：

```bash
cat > docker-compose.override.yml <<'YAML'
services:
  fnstart:
    volumes:
      - /vol1:/host/vol1:ro
      - /vol2:/host/vol2:ro
YAML

docker compose up -d
```

`docker-compose.override.yml` 在默认情况下会被自动合并，不用额外带 `-f`。
按机器上真实存在的 `/volN` 写，不存在的别写——写了会凭空多出一个空目录。

---

## 五、这几个参数是什么

| 参数 | 为什么这么写 |
|---|---|
| `network_mode: host` | 只有共用宿主机网络命名空间，才能读到全部监听端口（`/proc/net/tcp`），发现没做端口映射的 host 网络容器，以及不是 Docker 装的飞牛服务（5666 / 8777） |
| `cap_drop: ALL` + 只加 3 项 | 只需要「读文件 + 读 proc/sys + 听端口」。`SYS_PTRACE` 用于反查 host 容器的端口；`DAC_OVERRIDE`/`DAC_READ_SEARCH` 是 `data/` 原子写必需的，缺了建不了临时文件 |
| `no-new-privileges` | 进程不能靠 setuid 把权限拿回来 |
| `docker-proxy` 单独一个容器 | **只有它挂 docker.sock**，且只放行三个只读 GET 端点。主容器被拿下也拿不到 Docker 写权限 |
| `/proc`、`/sys` 只读挂载 | 监控面板的 CPU、温度、风扇、功耗来自这里。不挂的话这几项显示「无数据」，CPU 使用率/内存/网络/磁盘不受影响 |
| `TRUST_PROXY: "1"` | 只在前面挂了反向代理时需要。它让登录限速按真实客户端 IP 计算，而不是把所有人算成一个 `127.0.0.1` |

---

## 六、装完自查

```bash
docker compose ps                 # 两个容器都是 running
docker logs fnstart --tail 20     # 没有报错
docker exec fnstart node /app/scripts/selftest.mjs   # 整体体检
```

---

## 附：为什么不需要 Dockerfile

默认的 `docker-compose.yml` **只拉镜像，不构建**。

要改代码自己编译的开发者，多带一个叠加层：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

把 `build:` 拆出去的原因：以前写在默认文件里，镜像拉取失败时 compose 会自动回退去
本地构建，而只下载了 yml 的机器没有 Dockerfile，于是报
`failed to read dockerfile: open Dockerfile: no such file or directory`——
看起来像文件丢了，实际只是网络问题。拆开之后，拉取失败就是拉取失败。
