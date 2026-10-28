# fnStart · 飞牛开始页

[![bilibili](https://img.shields.io/badge/Bilibili-主页-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/2250922)

> 一个飞牛nas用户专属的浏览器开始页。
> 打开浏览器，NAS 上跑的东西全在一屏：能点、能拖、能改，右边挂着飞牛监控那块面板。

![fnStart 界面](docs/screenshot.png)

<p align="center"><sub>↑ 界面展示</sub></p>

## 功能和亮点

**打开浏览器，NAS 在干什么全在眼前。** 不用翻收藏夹、不用记端口、不用在几个后台之间来回切。

### 服务自动发现

装上就有一屏，不用一个个手动加。

- 读宿主机 `/proc/net/tcp`，把所有监听端口过一遍，再逐个探活、从页面标题认服务
- **host 网络的容器也认得出**——这类容器没有端口映射，大多数工具直接漏掉，而 NAS 上大部分容器恰好都是这个模式
- 端口反查回容器名：bridge 容器读 Docker API 的端口映射，host 容器顺着 socket inode 找到持有它的进程
- 404、报错页、目录列表页会被过滤掉，不会给你堆一堆「Error」卡片
- 图标运行时去各服务页面抓 favicon，抓不到就用名字首字母配个颜色

### 一屏掌控

- 卡片能拖、能改、能分组，收藏书签单独一格，用虚线隔开
- **分组可以自己建**：新建、改名、删除、拖着标题调顺序。卡片右键能「移动到」或「复制到」别的组
- **右键取代了悬停小按钮**：编辑、新标签页打开、复制地址、移动到分组、删除，都在右键里；输入框里仍然是系统原生菜单（不然没法复制粘贴）
- 顶部一条：天气、搜索（百度 / 必应 / 谷歌…）、时间日期，这四项的顺序可以在设置里调
- **点天气看未来一周**，点日期弹出带农历和节日的日历，点时间开计时器（到点有提示音，可以先试听）
- 搜索框打字时卡片自己亮起来，告诉你命中几张；回车才是真去搜
- 手机端是重新排过的，不是把桌面版等比缩小

### 自带监控面板

不用装第三方监控应用，数据全部自己采。

- 六张卡：CPU、内存、存储、网络、温度、功耗。温度、风扇、盘温、功耗都来自硬件传感器
- **每个容器的 CPU 和内存占用**，按占用从高到低排，谁在吃资源一眼看到
- 温度那条是 20~100℃ 的标尺，左蓝右红，60℃ 正好在中间
- 功耗按部件拼算（CPU + 主板 + 硬盘），参数可以按自己的硬件调
- 存储有几个卷就显示几条，换台机器自动适配
- **三种形态**：折叠成一条胶囊、并排在右侧、或者全屏——全屏时页面上只剩监控，卡片和顶栏都收起来
- **全屏会多一块「媒体库」**：扫一遍媒体目录，数出视频/图片/音频各多少、按目录分类、最近入库哪几个文件（学习资料和下载池不算在内）

### 一些我在意的细节

- **零依赖**：没有前端框架、没有 `npm install`、没有构建步骤。`node server.js` 就跑起来了
- **点阵数字是增量的**：改一个数字只切几十个圆点的显示状态，不重建整棵 SVG——实测 500 次刷新省掉 7.4 万个 DOM 节点
- **温度做了平滑**：这颗 U 空闲 27℃、一个请求就窜到 50℃，硬显示会像传感器坏了，所以上升跟得快、下降拖得慢
- **拿不到数据不清空面板**：监控断连时保留上次的数字并变暗，而不是把整块换成一行错误字
- **一份 JSON 就是全部数据**：`data/` 拷走就等于搬家，也能 `GET /api/export` 导一份
- **界面字号四档**：小屏、远看、电视上都调得动
- **想上公网有底子**：访问令牌 + Docker socket 收进只读代理，不是「裸奔着就上线了」

## 装它

前提是能 SSH 进 NAS。飞牛里「设置 → 系统设置 → SSH」打开就行。

### 1 · 粘这一块

```bash
git clone https://github.com/IceNoproblem/fnstart.git /vol1/docker/fnstart
cd /vol1/docker/fnstart
sudo bash scripts/install.sh
```

看到 `✓ 装好了` 就成了。脚本会打印**访问地址**和**访问令牌**——令牌只显示这一次，马上抄进密码管理器。

<sub>第一行拉不动（国内常见）：把 `https://github.com/` 换成 `https://ghfast.top/https://github.com/`。</sub>

### 2 · 打开

浏览器输入 `http://你的NAS地址:3721`，贴令牌，进去。

想设成首页：Chrome / Edge → 设置 → 启动时 → 打开特定网页。

### 3 · 监控面板不用装东西了

从 1.4 起，右边那块面板的数据是**自己采的**：读宿主机的 `/proc` 和 `/sys`，CPU、内存、温度、功耗、风扇、盘温、网络、每个容器的占用都是直读，不需要任何外部应用。

采不到的只有几样：硬盘 SMART 详细属性（重映射扇区、通电小时）、RAID 阵列卡状态、IPMI/BMC、GPU 利用率。想要这些，可以另外装 **飞牛监控 fnMonitor**（[MisiteQ](https://github.com/MisiteQ) 写的第三方开源应用，MIT，[仓库](https://github.com/MisiteQ/fnmonitor)），装上后面板会自动改用它的数据；不装也**不影响任何核心指标**。

```bash
sudo bash /vol1/docker/fnstart/scripts/install-fnmonitor.sh
```

<sub>有几个存储卷就显示几个。安装脚本会自动探测宿主机的 `/vol1`…`/vol8`，存在哪些挂哪些，不用手动配。</sub>

### 装不上

| 卡在哪 | 怎么办 |
|---|---|
| 页面打不开 | `docker logs fnstart --tail 20`，看最后一行 |
| 卡在构建镜像 | NAS 拉不到 `node:22-alpine`，改用下面「其它装法 → docker run」 |
| 忘了令牌 | `grep ACCESS_TOKEN /vol1/docker/fnstart/.env` |
| 右边读不到监控 | 看容器有没有挂到宿主 sysfs：`docker exec fnstart ls /host/sys/class/hwmon`，有输出就有数据 |
| 监控里没有温度/风扇/功耗 | 同上，说明 `/sys` 没挂。CPU、内存、网络、磁盘不受影响 |
| 卡片没有容器名 | `docker logs fnstart-docker-proxy`，看它起来没有 |
| 想整体体检 | `docker exec fnstart node /app/scripts/selftest.mjs` |

<details>
<summary><b>其它装法</b> — 手动 compose / docker run / 不用 Docker / 飞牛图形界面</summary>

**手动 compose**（不想用安装脚本）

```bash
cd /vol1/docker/fnstart
./scripts/new-token.sh --write
docker compose up -d --build
```

**docker run 两行流**（没有 compose 插件，或镜像拉不到时用）

先起 socket 代理，只有它挂 socket：

```bash
docker run -d --name fnstart-docker-proxy --network host --restart unless-stopped \
  -v /vol1/docker/fnstart:/app:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -w /app -e PROXY_LISTEN=127.0.0.1:2375 \
  node:22-alpine node docker-proxy.mjs
```

再起主应用，**不挂** socket：

```bash
docker run -d --name fnstart --network host --restart unless-stopped \
  --cap-add=SYS_PTRACE \
  -v /vol1/docker/fnstart:/app -v /vol1/docker/fnstart/data:/data \
  -v /proc:/host/proc:ro \
  -w /app -e PORT=3721 -e DATA_DIR=/data \
  -e DOCKER_SOCK=http://127.0.0.1:2375 \
  -e ACCESS_TOKEN=你的令牌 \
  node:22-alpine node server.js
```

**不用 Docker**（有 Node 22 就行）

```bash
git clone https://github.com/IceNoproblem/fnstart.git && cd fnstart
PORT=3721 DATA_DIR=./data node server.js
```

**飞牛图形界面** — 把 `docker-compose.yml` 贴进「Docker → 项目 → 新建」，项目路径填 `/vol1/docker/fnstart`。目录里得有源码，镜像是从源码构建的。

</details>

## 怎么用

**扫服务** — 顶栏「扫描服务」。第一次打开页面时也会自动跑一次，所以通常你什么都不用点。

**导入书签** — 把浏览器导出的 `bookmarks.html` 拖进去，收藏夹链接归到下面「收藏书签」分组，跟服务卡用一条虚线隔开。

**改卡片** — 鼠标移上去右上角出现编辑/删除。名字、地址、图标、颜色、备注都能改，图标也能自己传。

**拖排序** — 按住拖，实时让位，松手落位。分组之间也能拖。

**搜索顺手找卡** — 搜索框打字，卡片名字/描述对得上就直接亮起来，下面告诉你命中几张。回车才是真去搜。

**看右侧面板** — 六张卡（CPU / 内存 / 存储 / 网络 / 温度 / 功耗），下面接存储明细、容器占用和系统信息。几个细节：

- 存储卡上是**所有卷的平均占用**，不是最满的那一个；想看每卷单独的数字，看下面的明细区
- 容器按资源占用从高到低排、两列，每行带 CPU% 和内存。25 个容器也就十几行
- 温度卡底下那条是 **20~100℃ 的标尺**，左蓝右红，60℃ 正好落在中间
- 卡片右上角的词（平稳 / 宽裕 / 传输中 / 偏热…）是跟着数值走的，不是写死的

**设置** — 右上角：标题、副标题、**界面字号（四档）**、背景（极光 / 纯色 / 图片）、每行列数、天气城市、时区，还有**每张卡单独的开关**（不想让家里人看到某些入口时有用）。「飞牛监控」那页底下还有三个功耗参数，见[功耗是怎么算的](#功耗是怎么算的)。

**手机端是重排过的**，不是等比缩小：搜索独占一行，天气时间落第二行；卡片单列更紧凑；没有悬停所以编辑/删除直接常显；不能拖拽（手指一滑就得滚页面，两者必然打架），改成**长按弹面板**上移/下移/编辑/删除；输入框字号锁 16px，免得 iOS 一点就放大整页。

### 它是怎么扫出来的

这部分有点技术含量，简单说：

1. 读宿主机 `/proc/net/tcp`，拿所有 LISTEN 端口——所以 host 网络的容器也能发现
2. 每个端口先 TCP 探活，再发一次轻量 HTTP 请求，从 `<title>` 猜服务名；404/报错页会过滤掉，不给你生成 "Error" 卡片
3. **认容器名**：bridge 容器直接读 Docker API 的端口映射；host 容器没有映射，就反查——端口 → socket inode → 持有它的进程 → 属于哪个容器。这一步要容器能看见宿主机进程表：

```yaml
cap_add: [SYS_PTRACE]        # 读 /proc/<pid>/fd 需要
volumes:
  - /proc:/host/proc:ro      # 看见宿主机的进程
```

`SYS_PTRACE` 听着吓人，它只用来"读进程开了哪些 socket"，没有写操作、不 attach、不注入。**不给也能跑**，只是 host 容器认不出名字，卡片退回用网页标题命名。

4. 图标是运行时去各服务页面抓 favicon，存到 `data/icons/`；抓不到就用名字首字母配个颜色，所以离线也能看。

## 配置项

全是环境变量，改 `.env` 或 `docker-compose.yml`。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3721` | 监听端口 |
| `DATA_DIR` | `/data` | 数据目录（卡片、图标、背景、快照）|
| `MONITOR_URL` | 空 | 监控地址。**留空 = 自动用「访问本页的主机名:8777」**，换 IP 不用改 |
| `MONITOR_PORT` | `8777` | 上面那个自动地址用的端口 |
| `WEATHER_CITY` | `北京` | 天气默认城市，页面上也能改 |
| `PUBLIC_HOST` | 空 | 强制卡片地址用这个主机名（反代/域名场景）|
| `DOCKER_SOCK` | `http://127.0.0.1:2375` | 走 socket 代理。改成 `/var/run/docker.sock` 就是直连（不建议，见下文）|
| `PROC_ROOT` | 自动 | 宿主机 procfs 挂载点，默认探测 `/host/proc` |
| `PROBE_TIMEOUT` | `2500` | 单端口探测超时（毫秒），服务多可调 3000 |
| `PROBE_PORTS` | 空 | 额外扫的端口，逗号分隔（拿不到 `/proc` 时兜底）|
| `ACCESS_TOKEN` | 空 | **访问令牌**。留空 = 不校验；要暴露到公网就必须设。用 `./scripts/new-token.sh --write` 生成，写 `.env` |
| `BLOCK_PRIVATE_FETCH` | 跟随令牌 | 禁止服务端抓内网图标（防 SSRF）。设了令牌会自动开，纯内网想关就显式设 `0`。**注意：自动扫描自己发现的服务不受这条限制** |
| `POWER_BASE_W` | `8` | 功耗估算里的主板基础开销（主板 + 网卡 + 风扇）。**一般不用改这个，去设置里调** |
| `POWER_DISK_W` | `8` | 功耗估算里的单块硬盘功耗。同上，设置里有对应的输入框 |

数据全在 `DATA_DIR`：`data.json`（卡片与设置）、`icons/`、`backgrounds/`、`last-monitor.json` / `last-weather.json`（网络抖一下时的兜底快照）。**备份这个目录就等于备份了整个站**，或者 `GET /api/export` 导一份 JSON。

接口想接自动化？都在 `server.js` 的 `handleApi` 里，一眼能看完，我没单独写文档。

## 功耗是怎么算的

面板上那个功耗数字不是电表读数，是按部件拼出来的：

```
整机功耗 = CPU + 主板基础 + 硬盘数 × 单盘
```

**CPU 那部分有两条路**，在设置 → 飞牛监控里选：

| `CPU 最大功耗` 填什么 | 怎么算 | 适合谁 |
|---|---|---|
| 留 `0`（默认） | RAPL 实测——CPU 自己报的封装能耗 + 内存 | 想贴近真实 |
| 填 TDP（比如 `91`） | `TDP × CPU 占用率` | 想数字稳定、能手算核对 |

剩下两项同理可改：**主板基础功耗**（默认 8W，给主板、网卡、风扇留的）、**单块硬盘**（默认 8W，机械盘；全闪可以调到 4~5）。改完下一轮刷新就生效。

**为什么填了 TDP 反而可能更不准？** 因为「TDP × 占用率」是线性假设。实际上 CPU 在不同频率、不同核心数下效率差很多——50% 的占用往往只花 30% 的功耗，不是一半。所以默认用 RAPL。

**和飞牛监控的数字对不上？** 正常。它也是这么估的（RAPL 打底 + 经验值补），但两边采样时刻不同、温度测点不同、基础功耗取值也不一样，差个 5~10W 属于正常范围，不是谁算错了。

## 要上公网？先看完这节

我不建议你把 3721 直接怼到公网。这不是吓唬人。

### 令牌

**一、怎么生成。** 一条命令，写进 `.env`（权限 600，`.gitignore` 挡住了不会进仓库）：

```bash
./scripts/new-token.sh --write
docker compose up -d
```

生成完立刻抄进密码管理器。我也没做「首次启动自动生成」——隐式生成的密码最容易丢，躺在日志或容器环境变量里，换台机器就找不回来。

**二、它不会变。** 令牌是你自己设的死值，程序不会自动生成也不会自动换。**会过期的是登录 cookie（30 天），不是令牌。** cookie 还是滑动续期：每次打开主页就把 30 天重新算起，天天用就永远不会掉；真闲置超过 30 天才需要重登，而重登也只是把同一串再贴一次。

手机上懒得手打那一长串，用一次性链接 `http://你的地址:3721/?token=那串令牌`，打开后立刻换发 cookie 并跳回干净地址。但**链接本身带着令牌**，会留在浏览器历史、聊天记录、反代日志里，只在自己的设备之间传。

**三、忘了怎么办。** 没后门、没有找回邮件，但它就写在 `.env` 里：

```bash
grep ACCESS_TOKEN .env
```

`.env` 也丢了就从容器读（这是它唯一还会留下的地方）：`docker inspect fnstart --format '{{range .Config.Env}}{{println .}}{{end}}' | grep ACCESS_TOKEN`。两处都没有就换一把新的，卡片数据在 `data/` 里，跟令牌无关。

顺带说一句：启动日志只报「已开启（令牌 N 位）」，**永远不打印令牌本身**。因为 `docker logs` 是很多人会随手贴到群里求助的东西。

**四、怎么把设备踢下线。** 没有单独吊销功能。手机丢了就换一把令牌——重建容器后所有已登录设备的 cookie 立刻失效，包括你自己的。一个令牌一个开关，就这个思路。

要让家里人用，别把令牌给他们（那等于管理员权限，能删你的卡、导你的备份）。把认证放到反代层：Caddy 的 `basic_auth`、Nginx 的 `auth_basic`、或者雷池 WAF 的「身份认证」，每个账号由那一层管，fnStart 的令牌只属于你自己。

### Docker socket 我收进了只读代理

要把端口反查成容器名，就得读 Docker API。但直接挂 `/var/run/docker.sock` 有个坑：**`:ro` 不等于只读**——我在容器里实测过，`POST /containers/create` 照样打到 API。也就是说主进程一旦被攻破，攻击者就拿得到宿主机 root。

所以现在是两个容器：

```
fnstart               ← 主应用，完全不挂 socket
fnstart-docker-proxy  ← 只有它挂 socket，只放行三个 GET，其余一律 403
                        绑 127.0.0.1:2375，局域网和公网都碰不到
```

放行的只有 `/version`、`/containers/json`、`/containers/<id>/json`，正好是它需要的全部。实测 `POST /containers/create` → 405，`/secrets`、`/images/json`、`/containers/x/export` → 403。于是「被攻破」的后果从**宿主机 root** 降到**只能读容器列表**。

想退回单容器（省 10MB 内存），把 `DOCKER_SOCK` 改回 `/var/run/docker.sock` 并把 socket 挂回来。不建议。

### 再套一层 HTTPS

令牌走明文 HTTP 等于没设。Caddy 两条就够：

```
start.example.com {
  basic_auth {
    you <用 caddy hash-password 生成的 bcrypt 串>
  }
  reverse_proxy 127.0.0.1:3721
}
```

<details>
<summary>Nginx 版本</summary>

```nginx
location / {
  auth_basic "fnStart";
  auth_basic_user_file /etc/nginx/.htpasswd;
  proxy_pass http://127.0.0.1:3721;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  # 监控面板要转 WebSocket
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 300s;
}
```
</details>

### 说句实在话：能不暴露就别暴露

Tailscale / WireGuard 组网之后，出门直接开 `http://100.x.x.x:3721`，端口根本不出公网——上面所有问题一次性消失，还自带加密和身份认证。代价只是每台设备装个客户端。我现在就是这么用的。

### 还剩一条我没解决的

容器以 root 运行。这条是架构性的：读宿主 `/proc/<pid>/fd`（把端口反查到进程）要权限，非 root 会让这个功能退化。只在「已经被拿下」之后才有意义，但我不想藏着，写在明处。

## 常见问题

**fnMonitor 现在还要不要装？**

不要也能用。1.4 起面板数据是自己采的（读 `/proc` 和 `/sys`），核心指标一个不缺。它只补三样我确实采不到的：硬盘 SMART 详细属性、RAID 阵列卡、IPMI/BMC。

为什么从来没把它写进 compose：它不是容器型应用，是个宿主机监控代理，工作就是摸硬件——`smartctl` 读 SMART、`sensors` 读温度、`ipmitool` 读 BMC，还要读 `/sys/class/hwmon`、`/proc/*`、`/dev/sd*`，甚至 `/dev/port`（直接读 I/O 端口，兼容 NEC/联想商用机那种走私有 EC 邮箱的风扇）。要塞进容器就得 `privileged: true`、挂一堆 `/sys` `/dev` `/proc` `/vol1/@appcenter`，再装齐那堆工具——**等于把整台 NAS 交给一个容器**，比装 FPK 危险得多，还会丢掉应用中心的升级管理。

所以分工是：fnMonitor 用它自己的方式装，fnStart 用容器跑，两边只通过 `:8777/api/overview` 说话。谁升级都不影响谁。

**右边一直是"读不到监控数据"？**
第 3 步没做，或者 8777 不通。`curl http://你的NAS:8777/api/overview` 试一下。用反代/HTTPS 的话把 `MONITOR_URL` 写死。

**只扫出来一半服务？**
先看端口数对不对——大概率是 host 容器没认领到名字（不是没发现），加 `SYS_PTRACE` 和 `/proc` 挂载即可。另外 `PROBE_TIMEOUT` 太小会漏掉慢服务，调到 3000 试试。

**卡片地址变成了 `127.0.0.1`？**
说明你是从 NAS 本机用 `127.0.0.1` 打开的。程序会自动换成局域网 IP，但多网卡时可能挑错，这种时候设 `PUBLIC_HOST=192.168.x.x`。

**天气显示 `--`？**
天气走 open-meteo，需要外网。墙内偶尔抽风，失败会退回上次成功的快照（6 小时内有效），一般只短暂显示旧数据。

**改了代码为什么没生效？**
`docker restart` 只重启进程，不换代码——`/app` 里的文件是构建进镜像的，不是挂载的。改完源码必须 `docker compose up -d --build`。判断方法：`docker exec fnstart grep 新函数名 /app/lib/xxx.js`，搜不到就是没重建。（这个坑我自己踩过。）

**改了设置为什么不生效？**
设置在 `data/data.json` 里，本来就存着。如果你是直接改这个文件，需要重启容器——进程里有一份缓存。

**会往外发我的数据吗？**
不会。唯一的对外请求是天气（open-meteo，只发城市名和坐标）。没有统计、没有遥测、没有回连。

## 用了谁的东西

**飞牛监控 fnMonitor** — 右边那块面板的**视觉语言**参考了它（深色底、点阵数字、细计量条）。1.4 起数据改为自己采，它变成可选增强。作者 **Misite齊**（[@MisiteQ](https://github.com/MisiteQ)），MIT 许可，仓库 <https://github.com/MisiteQ/fnmonitor>。纯 Python 标准库 + 单文件前端，零依赖，数据只留在本机 SQLite，确实下了功夫，推荐去点个 star。

需要说明的是：**本仓库不包含 fnMonitor 的任何代码或样式表**，我们只是消费者，通过 HTTP 读它的 `/api/overview`。早期原型为了对照效果引用过它的 CSS，开源前已整份删除，重写成 `public/css/fn-theme.css`（约 4KB，全是我自己写的规则），点阵字模也是自己写的 5×7 位图表。本项目与 fnMonitor 作者、与飞牛官方**都没有隶属或背书关系**。

**飞牛 fnOS** — 运行平台。依赖它提供的 `/proc/net/tcp`、Docker，以及应用中心装出来的 fnMonitor。与飞牛官方无隶属关系。

**open-meteo** — 天气数据，免费免密钥，数据以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 提供。感谢他们不收费也不要求注册。<https://open-meteo.com/>

**Node.js** — 运行时，MIT。

**图标** — 界面上所有 SVG（搜索、编辑、扫描、全屏…）都是我手写的 path；卡片图标是运行时从各服务页面抓的 favicon，版权归各服务方。

**没用到的** — React / Vue / Tailwind / 任何 npm 包。`package.json` 的 `dependencies` 是空的，你 `npm install` 会得到 "up to date" 然后无事发生。

## 许可

[MIT](LICENSE) © 2026 IceNoproblem

随便用、随便改、随便商用，出事了别找我（MIT 的原话比这长一点，意思一样）。

## 最后

这是个自己用着顺手、顺手做完整的小工具。如果你也是飞牛用户，希望它能让你每天少点几下鼠标。

有问题、有想法、发现它在你机器上认不出某些服务，欢迎开 issue 把端口和现象贴上来——尤其是扫描漏掉的服务，给我端口号和那个页面的 `curl -I` 结果，基本能定位。
