# wy-purchase-arrival

面向采购员的 PDA H5 业务 APP：从 U8 ERP 读取已审核采购订单，查看明细并按订单数量打印到货标签。Android 移动壳内运行；业务术语见根仓 [`CONTEXT.md`](../CONTEXT.md) 与本仓 [`CONTEXT.md`](CONTEXT.md)。

## 工程关系

| 工程 | 职责 |
| --- | --- |
| `wy-portal` | 门户、统一登录、应用目录；通过同源代理 `/apps/purchase-arrival/` → 本应用 16007 |
| `wy-fastapi` | 统一身份 + U8 数据读取 + 打印操作持久化（待落地，见 [`docs/specs`](./docs/specs/)） |
| `wy-templates` | 公共 UI 与 PDA 模板参考 |
| `wy-mobile-shell` | Android 容器、蓝牙打印与扫码 |
| 公共 Mock | `wy-portal/apps/backend-mock`，开发期可通过 `PURCHASE_ARRIVAL_API_PROXY=http://localhost:5321` 切换 |

## 当前范围（骨架）

- 清单页：`PurchaseOrderList.vue`，克隆 `wy-material-print/PlanList.vue` 工程结构（滚动自动加载 / 防抖 / AbortController / 安全区 / 离门户 / 关键词 URL 同步）。
- 详情页：`PurchaseOrderDetail.vue`，克隆 `wy-material-print/MaterialList.vue` 工程结构（顶部 Heading / 搜索 / 选中 / 全选 / 底部打印预览入口 / 返回栈）。
- 预览页：`PrintPreview.vue`，克隆 `wy-material-print/PrintPreview.vue` 工程结构（Dialog + 蓝牙切换 + 进度 Popup + 模拟入口）。当前骨架只跑通"模拟打印 → 后端 TODO"路径。
- 标签页：`PurchaseOrderLabel.vue`，字段映射到 PO 明细（订单号 + 物料 + 规格 + 订单数量 + 二维码 = `PO_PODetails.ID`）。
- 通信组件：直接复用 `printer.ts / pageBack.ts / bitmap.ts / pcx.ts / calibration.ts / portal.ts`。
- 后端：当前 `wy-fastapi/portal_identity/purchase_arrival.py` 尚未落地，`api.ts` 中 `listPurchaseOrders / getPurchaseOrder` 抛 TODO。

## 协议与契约

- 业务路径：`/api/v1/purchase-arrival/*`（见 `src/api.ts`）。
- 数据来源：U8 `PO_POMain`（过滤 `cState = 1`）和 `PO_PODetails`。
- 写入边界：仅打印操作记录与打印结果入库；U8 库保持只读（沿用 ADR0010）。
- 列表 `days` 默认：90 天。

## 本地开发

需要 Node.js 22.18+ 和 pnpm 10.33.4。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

开发地址：http://localhost:16007/apps/purchase-arrival/。PDA 通过开发机局域网 IP 访问。常驻开发服务通过 tmux：

```sh
tmux new-session -d -s wy-purchase-arrival 'pnpm dev'
```

## 门户与后端

后端启动时加载本应用目录配置；已有目录时，把本应用 entry 合入现有配置。`allUsers: true` 使所有会话有效的启用账户可见。本地持续开发时，在 `wy-fastapi/.env.database.local` 中保存 `PORTAL_APPLICATIONS_FILE=$PWD/../wy-purchase-arrival/config/applications.json`，再重启统一后端。

```sh
cd ../wy-fastapi
PORTAL_APPLICATIONS_FILE="$PWD/../wy-purchase-arrival/config/applications.json" \
PORTAL_DEV_APP_ORIGINS=http://localhost:16007 \
uv run uvicorn portal_identity.app:application --factory --host 127.0.0.1 --port 16101
```

门户开发服务器把 `/apps/purchase-arrival/` 代理到 16007，复用已有 PDA 目录与壳业务页注册。复制 `.env.example` 为 `.env.local` 可调整代理；`.env.example` 默认开发模式，业务与身份均接真实后端；业务 Mock 只需设置 `PURCHASE_ARRIVAL_API_PROXY=http://localhost:5321`，身份仍接统一后端。

## 检查与构建

```sh
pnpm typecheck
pnpm build
pnpm preview
```

构建产物为 `dist/`，可部署到静态文件服务器。

## 图标

按组件深度导入：`import CloseIcon from 'tdesign-icons-vue-next/esm/components/close'`。`tdesign-icons-vue-next` 因此是直接依赖，版本钉在 `0.4.11`。

## 设备能力

与 `wy-material-print` 同壳：扫码、蓝牙连接与打印发送通过公共 Android 壳桥接接入。详细接入方式见 `wy-material-print/AGENTS.md#设备能力` 与 `wy-mobile-shell/docs/printer-settings.md`。

## 公共 Mock

业务模拟接口集中维护在 `wy-portal/apps/backend-mock`，复用已有接口及返回约定。代理配置参考 `wy-templates/apps/web-mobile/vite.config.ts`。

## 协作者分支

协作者须在自己的任务分支上开发、提交并推送，经评审后通过 Pull Request 合并；main 分支仅接收评审后的 PR 合并，禁止直接在 main 分支修改和提交。完整约定见根仓库 [`README.md`](../README.md#快速开始)。

## 共享项目约定

创建或修改 GitHub Issue、执行验收、启动或排查开发服务、连接 PDA／平板无线 ADB、排查 VPN/Wi-Fi 网络、远程启动移动壳时，先读取[根仓库共享项目约定](../AGENTS.shared.md)。