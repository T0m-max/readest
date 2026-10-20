# Readest 服务器部署

本目录用于部署网页端、认证、数据库和书籍存储。对外只开放 `80/tcp`、`443/tcp`，由 Caddy 管理 HTTPS 证书。网页端和客户端的服务器地址都是 `https://你的域名`。

## 部署前提

- Linux 服务器，安装 Docker Engine 和 Docker Compose v2 插件，以及 Python 3.9 或更新版本。
- 一个解析到服务器公网 IP 的域名。服务器防火墙和云安全组允许访问 TCP 端口 80、443；这两个端口应由本部署独占。
- 构建网页镜像建议预留 4 核 CPU、8 GiB 内存和 20 GiB 可用磁盘空间，书籍数据另计。这是构建资源建议，不是运行最低配置。
- 镜像包含 Linux amd64、arm64 版本，网页镜像在服务器本机架构下构建。本次运行验证使用 arm64。

如果使用完整源码部署包，解压后进入其中的 `docker/server`。部署包已包含网页构建所需的子模块源码，无须再次下载子模块。

如果使用 Git 仓库，从仓库根目录准备构建依赖：

```sh
git submodule update --init packages/foliate-js packages/simplecc-wasm packages/js-mdict packages/qcms apps/readest-app/src-tauri/plugins/tauri-plugin-turso
cd docker/server
```

本目录依赖仓库根目录的 `Dockerfile` 和 `docker/volumes` 中的初始化、迁移文件。不要只复制 `compose.yaml`。

## 首次部署

以下命令均在 `docker/server` 中执行。将示例域名替换为自己的域名：

```sh
python3 init-env.py readest.example.com
./compose.sh config --quiet
sh pull-images.sh
./compose.sh build client
./compose.sh up -d --no-build --pull never
./compose.sh ps
```

`init-env.py` 生成 `.env.server.local`，权限为 `0600`。数据库密码、JWT 签名密钥、匿名密钥、服务端密钥和对象存储密码均随机生成。脚本拒绝覆盖已有文件；该文件被 Git 和 Docker 构建上下文忽略。请单独保管备份。

`pull-images.sh` 优先使用国内可访问的镜像源，拉取后恢复为 Compose 使用的原始镜像名；镜像源失败时尝试上游。MinIO 的上游拉取在本次验证中返回 401，脚本使用已核验版本的南京大学 Quay 镜像源。若两者均不可用，脚本报错停止，应先解决镜像拉取问题再启动。

网页镜像从当前源码构建为 `readest-selfhost:server`，没有依赖尚未发布的个人 GHCR 镜像。首次构建需要下载 Node.js 基础镜像和前端依赖，耗时较长；后续构建可复用本机 Docker 缓存。日常重启只需执行 `./compose.sh up -d --no-build --pull never`。

启动后访问 `https://你的域名`。首次申请证书要求域名解析正确，公网 80、443 端口可达。查看启动日志：

```sh
./compose.sh logs --tail 100 proxy client auth db
```

服务依次等待数据库初始化、认证就绪、网关就绪和存储桶创建完成。首次数据库初始化可能需要几分钟。

## 创建账号及连接客户端

默认关闭公开注册。服务启动且 HTTPS 正常后，创建个人账号：

```sh
python3 create-user.py you@example.com
```

脚本交互式读取密码，通过管理员接口创建已确认邮箱的账号，不依赖 SMTP。密码不会写入配置文件或命令历史。每次创建一个账号；已有账号不会被覆盖。

网页端直接登录。macOS、Windows、Linux 和 Android 客户端在“设置 → 服务器”中填写 `https://你的域名`，测试连接后保存，再登录新建账号。桌面登录回调使用 `readest-selfhost://`。

如需开放邮箱注册，将 `.env.server.local` 中的 `DISABLE_SIGNUP` 改为 `false`，并配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_ADMIN_EMAIL`，保留 `ENABLE_EMAIL_AUTOCONFIRM=false`。然后重建认证容器：

```sh
./compose.sh up -d --no-build --pull never auth
```

SMTP 密码包含 `$`、`#` 或空格时，用单引号包围整个值，例如 `SMTP_PASS='your$password'`。Compose 的 `config` 命令若不加 `--quiet`，会展开并输出密钥，请勿公开其输出。

## 可调整配置

| 配置项 | 说明 |
| --- | --- |
| `DOMAIN` | 公开域名，不含协议、端口或路径。 |
| `PUBLIC_URL` | 完整的公开地址，例如 `https://readest.example.com`，不带末尾斜线。修改域名时与 `DOMAIN` 一起修改。 |
| `STORAGE_FIXED_QUOTA` | 每个用户的存储配额，单位为字节，默认 1 GiB。 |
| `TRANSLATION_FIXED_QUOTA` | 默认翻译配额，不代表已配置翻译服务。 |
| `FONT_BASE_URL` | 可选的字体资源镜像地址。官方字体 CDN 对第三方域名可能有 CORS 限制。 |
| `READEST_IMAGE` | 本地网页镜像名称；使用预构建镜像时应显式指定版本并提前拉取。 |
| `NODE_IMAGE` | 构建用 Node.js 基础镜像。默认使用代理源并固定为与上游相同的 SHA-256；也可改为 `docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e`。 |

修改配置后执行 `./compose.sh up -d --no-build --pull never`，Compose 会重建受影响的容器。

Caddy 保留 `/readest-files/*` 的完整路径和 `Host`，供 S3 签名上传、下载使用。不要将该路径改写为去掉存储桶名的地址。若修改 `S3_BUCKET_NAME`，应使用合法的 S3 存储桶名称，并自行迁移已有书籍对象。

已有 Nginx、宝塔或其他反向代理占用 80、443 时，需要先调整入口配置。本配置默认由 Caddy 直接终止 HTTPS，不适合直接叠加到已占用的端口上。

## 数据持久化与备份

默认 Compose 项目名为 `readest-server`。数据库和书籍分别存储在 `readest-server_db-data`、`readest-server_minio-data` 命名卷；证书在 `readest-server_caddy-data` 中。普通 `down` 保留这些卷，`down -v` 会删除数据，不用于更新。

以下命令暂停外部访问和书籍写入，备份数据库、对象文件及环境配置。备份文件包含密钥和账号数据，应保存在私有目录：

```sh
set -e
umask 077
mkdir -p backups
./compose.sh stop proxy client minio
./compose.sh exec -T db pg_dump -U supabase_admin -d postgres \
  --clean --if-exists --schema=public --schema=auth --schema=storage --schema=readest_meta > backups/database.sql
docker run --rm --user 0:0 --entrypoint tar \
  -v readest-server_minio-data:/source:ro \
  -v "$PWD/backups:/backup" \
  supabase/postgres:15.8.1.085 -czf /backup/minio-data.tgz -C /source .
cp .env.server.local backups/env.server.local
chmod 600 backups/*
./compose.sh up -d --no-build --pull never
```

数据库备份包含 `public`、`auth`、`storage`、`readest_meta` 四个模式，覆盖 Readest 数据、账号、存储外键及迁移记录，并保留对象所有者。Supabase 扩展由相同版本的数据库镜像初始化，避免全库重建扩展时产生冲突。

备份中途出错时，先检查错误并补全备份，再执行最后一条命令恢复访问。将备份复制到服务器之外保存。上述备份不保存镜像；若镜像来源不稳定，应另用 `docker save` 保留当前运行镜像。

恢复到新服务器时，使用匹配版本的源码和镜像，将备份环境文件恢复为 `.env.server.local`，权限设为 `0600`，先只启动数据库：

```sh
set -e
cp backups/env.server.local .env.server.local
chmod 600 .env.server.local
sh pull-images.sh
./compose.sh build client
./compose.sh up -d --no-build --pull never --wait db
./compose.sh exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < backups/database.sql
./compose.sh create minio
docker run --rm --user 0:0 --entrypoint tar \
  -v readest-server_minio-data:/destination \
  -v "$PWD/backups:/backup:ro" \
  supabase/postgres:15.8.1.085 -xzf /backup/minio-data.tgz -C /destination
./compose.sh up -d --no-build --pull never
```

恢复命令针对新建的空环境；不要直接覆盖另一套正在使用的数据。域名未变时，Caddy 会重新申请证书；新服务器需满足同样的 DNS 和端口条件。

## 更新

先按上一节备份。更新源码或替换完整源码部署包时，保留原来的 `.env.server.local` 和 Docker 命名卷，然后执行：

```sh
set -e
docker tag readest-selfhost:server readest-selfhost:before-update
sh pull-images.sh
./compose.sh build client
./compose.sh stop proxy client
./compose.sh up -d --no-build --pull never --wait db
./compose.sh exec -T db sh /docker-entrypoint-initdb.d/zz-readest-migrations.sh
./compose.sh up -d --no-build --pull never
./compose.sh ps
```

已有数据库不会重新运行首次初始化脚本，因此更新必须显式运行增量迁移。迁移记录保存在 `readest_meta.migrations` 中，已应用的文件会跳过。若要回退，数据库与书籍恢复到同一次备份，网页镜像可切换为更新前保留的标签。

## 验证范围

部署包附带独立验证记录。公网 DNS、自动签发证书和目标服务器的 amd64 运行情况需要在实际部署时验证；本地验证不能代替这些环境检查。

参考：[Compose 启动依赖](https://docs.docker.com/compose/how-tos/startup-order/)、[Caddy HTTPS](https://caddyserver.com/docs/automatic-https)、[保留路径的 handle 路由](https://caddyserver.com/docs/caddyfile/directives/handle)。
