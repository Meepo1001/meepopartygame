# 阿里云 + Cloudflare Tunnel 部署说明

本项目当前是单房间、内存态联机测试版。服务器重启后对局状态会丢失，但 PM2 会保证 Node 进程异常退出后自动拉起。

## 1. 登录服务器

在阿里云控制台复制公网 IP，本机 PowerShell 执行：

```powershell
ssh root@你的服务器公网IP
```

第一次连接输入 `yes`，然后输入服务器密码。

## 2. 安装 Node.js 20、Git、PM2

```bash
apt update
apt install -y git curl ca-certificates

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

node -v
npm -v

npm install -g pm2
```

## 3. 拉取项目并安装依赖

```bash
cd /opt
git clone https://github.com/Meepo1001/meepopartygame.git
cd /opt/meepopartygame
npm install
```

如果目录已经存在，用下面的方式更新：

```bash
cd /opt/meepopartygame
git pull origin main
npm install
```

## 4. 用 PM2 启动游戏服务

如果需要启用腾讯云 TRTC 自由麦，先在服务器设置环境变量。`SecretKey` 只能保存在服务器，不能写入 GitHub：

```bash
export TRTC_SDK_APP_ID="你的SDKAppID"
export TRTC_SECRET_KEY="你的SecretKey"
export TRTC_ROOM_ID="1001"
export TRTC_USER_SIG_TTL="7200"
export ROOM_PASSWORD="建议使用6到32位字母和数字"
```

```bash
cd /opt/meepopartygame
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` 会输出一行 `sudo env ... pm2 startup ...` 命令，把它复制执行一次。

检查：

```bash
pm2 status
pm2 logs meepopartygame
```

日志中出现 `TRTC voice: configured` 表示语音凭证服务已启用；出现 `Room password: enabled` 表示好友房间密码已启用。修改语音或房间密码环境变量后执行：

```bash
pm2 restart ecosystem.config.cjs --only meepopartygame --update-env
pm2 save
```

房间密码只保存在服务器环境变量中，不要写入代码或提交到 GitHub。修改密码不会踢出现有玩家，但之后的新加入和昵称重连会立即使用新密码；持有有效重连 Token 的原玩家仍可直接恢复座位。

看到 `meepopartygame` 为 `online` 即可。

## 5. 安装 Cloudflare Tunnel

```bash
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | tee /etc/apt/sources.list.d/cloudflared.list
apt update
apt install -y cloudflared
```

登录 Cloudflare：

```bash
cloudflared tunnel login
```

复制终端给出的链接到浏览器，选择 `meepopartygame.xyz` 授权。

创建隧道：

```bash
cloudflared tunnel create meepopartygame
```

查看凭证文件：

```bash
ls /root/.cloudflared
```

## 6. 配置 Tunnel

创建配置：

```bash
mkdir -p /etc/cloudflared
nano /etc/cloudflared/config.yml
```

写入下面内容，把 `你的隧道ID.json` 替换为上一步看到的真实文件名：

```yaml
tunnel: meepopartygame
credentials-file: /root/.cloudflared/你的隧道ID.json

ingress:
  - hostname: meepopartygame.xyz
    service: http://localhost:4174
  - hostname: www.meepopartygame.xyz
    service: http://localhost:4174
  - service: http_status:404
```

绑定 DNS：

```bash
cloudflared tunnel route dns meepopartygame meepopartygame.xyz
cloudflared tunnel route dns meepopartygame www.meepopartygame.xyz
```

安装并启动服务：

```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
systemctl status cloudflared
```

## 7. 验证

浏览器访问：

```text
https://meepopartygame.xyz
```

服务器上检查：

```bash
pm2 status
systemctl status cloudflared
```

通过标准：

- `pm2 status` 中 `meepopartygame` 是 `online`。
- `systemctl status cloudflared` 是 `active (running)`。
- 手机和电脑可以同时进入 `https://meepopartygame.xyz`。
- 多个玩家加入同一个房间，聊天和操作可以同步。
- 玩家入座后顶部“麦”按钮可用，允许麦克风权限后可以加入自由麦。

## 8. 常用维护命令

更新代码：

```bash
cd /opt/meepopartygame
git pull origin main
npm install
pm2 restart meepopartygame
```

查看日志：

```bash
pm2 logs meepopartygame
journalctl -u cloudflared -f
```

重启服务：

```bash
pm2 restart meepopartygame
systemctl restart cloudflared
```

## 注意事项

- 使用 Cloudflare Tunnel 时，不需要在阿里云安全组开放 `4174`。
- 建议只保留 SSH `22`，后续可以把 SSH 来源限制为自己的 IP。
- 当前版本没有数据库；服务器重启、PM2 重启、部署更新都会清空当前房间状态。
- TRTC 音频直接在浏览器和腾讯云之间传输，不经过本机 Node 服务；游戏 WebSocket 与语音连接彼此独立。
- 不要把 `TRTC_SECRET_KEY` 写进 `ecosystem.config.cjs`、前端文件、日志或 Git 仓库。
- 如果未来要正式运营，需要补持久化、多房间、房间码、恢复码或账号系统。
