# 医生预约挂号辅助程序

这是一个使用 TypeScript 编写的自动化脚本，用于监控特定医生的预约挂号页面，并在发现有可用号源时通过 Server酱 发送微信通知。

## ✨ 核心功能

- **智能调度**：能够自动解析规则中的放号时间，实现动态频率扫描。平时低频潜行，临近放号时自动进入高频“战斗模式”。
- **增量通知**：只在“第一次”发现新号源时发送通知，并记录已通知的号源，避免对同一号源重复发送，节约您的免费额度。
- **故障提醒**：当程序遇到网络错误、Cookie失效等问题时，会主动发送故障提醒。
- **智能冷却**：故障提醒具有“冷却”机制，避免在持续故障时对您进行信息轰炸。
- **格式化通知**：利用 Markdown 生成格式精美、信息丰富的通知卡片，包含医生姓名、可用时间段和一键直达的预约链接。
- **零依赖部署**：可通过 `bun` 编译为单个可执行文件，部署到服务器无需安装任何 Node.js/Bun 环境。

## 🚀 如何使用

### 1. 本地开发

1.  **安装依赖**: `bun install`
2.  **配置**: 复制 `config.yaml.example` 为 `config.yaml` 并填入您的信息。
3.  **运行**: `make run` 或 `bun run src/index.ts`

### 2. 编译 (用于部署)

使用 `make build-linux` 命令，将项目交叉编译为适用于 **Linux x86_64** 服务器的独立二进制文件。

```bash
make build-linux
```

这将生成一个名为 `appointment-checker-linux-x64` 的文件，位于项目根目录下的 `output/` 文件夹中。

## 部署到服务器 (7x24 运行)

这是将您的助手部署到 Linux 服务器并使用 `systemd` 实现稳定守护的**最终、最专业**的最佳实践。

### 1. 上传文件

您需要将 **2** 个文件上传到您的服务器的同一个目录下：
1.  本地 `output/` 目录下的 `appointment-checker-linux-x64` 二进制文件。
2.  项目根目录下的 `install.sh` 安装脚本。

### 2. 一键安装

登录到您的服务器，进入您上传文件的目录，然后执行以下命令：

```bash
# 1. 赋予安装脚本执行权限
chmod +x install.sh

# 2. 使用 sudo 运行安装脚本
sudo bash install.sh
```

脚本将会引导您完成所有操作，包括：
- 检查文件完整性。
- **引导您在服务器上安全地创建配置文件**。
- 询问用于运行服务的用户名。
- 自动完成所有文件的放置、服务创建和启动工作。

### 4. 管理与监控

安装完成后，您可以随时通过以下命令来管理您的助手：

```bash
# 查看服务当前状态（是否在运行）
sudo systemctl status appointment-checker

# 实时查看程序的日志输出（systemd journal）
sudo journalctl -u appointment-checker -f

# 查看文件日志（推荐，更详细的日志）
sudo tail -f /var/log/appointment-checker/appointment-checker.log

# 查看错误日志
sudo tail -f /var/log/appointment-checker/appointment-checker-error.log

# 停止服务
sudo systemctl stop appointment-checker

# 重启服务（例如，在您更新了 /etc/appointment-checker/config.yaml 之后）
sudo systemctl restart appointment-checker
```

至此，您的挂号助手已经通过最简单、最专业的方式，在您的服务器上 7x24 小时不间断地运行了！

---

## 未来扩展：支持多人订阅

当前版本的通知服务 (Server酱) 是一个“一对一”的个人通知网关，最适合个人使用。如果未来希望让多位朋友都能自助订阅通知，我们已经设计好了最佳的演进方案。

### 推荐方案：切换到 PushPlus 的“群组”功能

这是兼顾了易用性和实现难度的最佳方案。

- **工作原理**:
  1.  **管理员**: 在 PushPlus 网站创建一个“群组”，并获取该群组的 `topic` 编码。
  2.  **订阅者**: 您的朋友们只需用微信扫描您分享的群组二维码，即可自动加入，**无需注册、登录或付费**。
  3.  **代码改造**: 我们需要将 `config.yaml` 修改为支持 PushPlus 的 `token` 和 `topic`，并更新 `notifier.ts` 的实现。当程序发送通知到这个 `topic` 时，所有群组成员都会收到。

- **优点**:
  - **完美实现自助订阅**，管理员无需任何手动操作。
  - 安全、便捷，用户体验极佳。

### 实施步骤

当您决定启用此功能时，只需：
1.  从 PushPlus 获取您的 `token` 和新创建的群组 `topic`。
2.  将这两个凭证提供给我（或其他开发者）。
3.  我（或其他开发者）将快速完成 `notifier.ts` 和 `config.yaml` 的改造，以适配 PushPlus 的群组推送 API。
