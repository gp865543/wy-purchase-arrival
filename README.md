# wy-purchase-arrival

> 面向采购员的 PDA H5：从 U8 ERP 读取已审核采购订单，查看订单明细，按订单数量打印到货标签。

## 技术栈

Vue 3、TypeScript、Vite、[TDesign Mobile Vue](https://github.com/Tencent/tdesign-mobile-vue)，使用 pnpm 管理依赖。

工程基线沿用 [`wy-material-print`](../wy-material-print/) 的工程结构（滚动加载 / 防抖 / AbortController / 安全区 / 离门户 / 壳通信复用）。

## 本地开发

需要 Node.js 22.18+（Vite 支持的版本）和 pnpm 10.33.4。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

开发地址：http://localhost:16007/apps/purchase-arrival/。PDA 可通过开发机局域网 IP 访问。常驻开发服务通过 tmux 管理：

```sh
tmux new-session -d -s wy-purchase-arrival 'pnpm dev'
```

## 检查与构建

```sh
pnpm typecheck
pnpm build
pnpm preview
```

构建产物为 `dist/`，可部署到静态文件服务器。

## 当前范围

骨架已建：

- 清单页 `PurchaseOrderList.vue` — 已审核 PO 列表、关键词搜索、滚动自动加载。
- 详情页 `PurchaseOrderDetail.vue` — PO 明细卡片、勾选与打印份数、底部打印预览入口。
- 预览页 `PrintPreview.vue` — 蓝牙连接、批量滚动、进度 Popup、模拟打印入口。
- 标签页 `PurchaseOrderLabel.vue` — 订单号 + 物料 + 订单数量 + 二维码（PO 明细 ID）。
- 通信组件：`src/printer.ts` / `src/pageBack.ts` / `src/bitmap.ts` / `src/pcx.ts` / `src/calibration.ts` / `src/portal.ts` 直接复用自 `wy-material-print`。

待落地：

- 后端 `wy-fastapi/portal_identity/purchase_arrival.py` + 路由 + 测试。
- 真实打印链路（`PrintPreview.vue` 当前只跑通模拟路径）。
- 数据范围授权（按 ADR0010 + 计划中 ADR0011）。

详见 [`docs/specs/`](./docs/specs/) 与根仓 `docs/adr/`。

## 门户与后端

后端启动时加载本应用目录配置；已有目录时，把本应用 entry 合入现有配置。`allUsers: true` 使所有会话有效的启用账户可见。本地持续开发时，在 `wy-fastapi/.env.database.local` 中保存 `PORTAL_APPLICATIONS_FILE=/root/projects/wuying3/wy-purchase-arrival/config/applications.json`（按实际检出路径调整），再重启统一后端；门户 16001 与业务入口共用该目录。

```sh
cd ../wy-fastapi
PORTAL_APPLICATIONS_FILE="$PWD/../wy-purchase-arrival/config/applications.json" \
PORTAL_DEV_APP_ORIGINS=http://localhost:16007 \
uv run uvicorn portal_identity.app:application --factory --host 127.0.0.1 --port 16101
```

门户开发服务器把 `/apps/purchase-arrival/` 代理到 16007，复用已有 PDA 目录与壳业务页注册。通过门户地址进入时复用同源 Cookie；直接访问 16007 时，未登录会跳到当前主机 16001 的统一登录页，返回目标由统一后端校验。局域网调试时需将后端的门户来源和开发 APP 来源配置为实际访问地址。

复制 `.env.example` 为 `.env.local` 可调整代理。默认业务与身份均接真实后端；业务 Mock 只需设置 `PURCHASE_ARRIVAL_API_PROXY=http://localhost:5321`，身份仍接统一后端。构建到 `/wuying3/` 下时，按示例配置 `VITE_BASE`、`VITE_API_BASE` 和 `VITE_PORTAL_LOGIN`，静态路径与代理部署独立验证。

## 协议与契约

- 业务路径：`/api/v1/purchase-arrival/*`，定义见 `src/api.ts`。
- 数据来源：U8 `PO_POMain` 与 `PO_PODetails`（通过 `wy-fastapi/portal_identity/u8_reader.py`，沿用 ADR0010）。
- 写入边界：仅打印操作与打印结果入库（`purchase_arrival_print_operations` / `purchase_arrival_print_results`）；U8 库保持只读。

## 自动化与联调

骨架阶段暂未提供 Playwright 联调脚本；接入 `wy-material-print/scripts/` 同款 `print-check.mjs` 与 `simulate-print-check.mjs` 作为下一步工作。

## 文档

- [`AGENTS.md`](./AGENTS.md) — 工程关系与协作者约定。
- [`CONTEXT.md`](./CONTEXT.md) — 业务术语。
- [`docs/specs/`](./docs/specs/) — 规格占位（后端落地时补齐）。
- 根仓 [`CONTEXT.md`](../CONTEXT.md) 与 [`docs/adr/`](../docs/adr/) — 业务术语与架构决策。