# BackpackDungeon

BackpackDungeon 是一个基于 Solana 的 pnpm monorepo 项目，用于 Packrun 游戏基础架构。包含链上 Anchor 程序、确定性游戏逻辑引擎、共享类型库和 Web 前端。

## 项目结构

```
BackpackDungeon/
├── apps/
│   └── web/                          # Next.js + TypeScript Web 前端
│       ├── app/
│       │   ├── dungeon/
│       │   │   ├── battle-sim.ts     # 战斗模拟器
│       │   │   └── page.tsx          # 地牢页面
│       │   ├── layout.tsx
│       │   └── page.tsx
│       └── lib/solana/               # Solana 客户端库
│           ├── anchorClient.ts
│           ├── constants.ts
│           ├── converters.ts
│           ├── dungeonQueries.ts
│           ├── dungeonTxs.ts
│           ├── pdas.ts
│           └── shopMath.ts
├── packages/
│   ├── game-core/                    # 确定性游戏逻辑引擎
│   │   ├── src/
│   │   │   ├── boss-shards.ts       # BOSS 碎片逻辑
│   │   │   ├── daily-config.ts      # 每日地图默认参数和数字随机种子配置
│   │   │   ├── daily-map.ts         # 每日地图生成
│   │   │   ├── enemy-scaling.ts     # 敌人属性缩放
│   │   │   ├── location-merkle.ts   # 位置 Merkle 树
│   │   │   ├── rng.ts              # 确定性 RNG
│   │   │   └── shop-logic.ts       # 商店逻辑
│   │   └── test/                    # 单元测试
│   ├── shared/                       # 共享类型和工具
│   │   ├── src/
│   │   │   ├── index.ts            # 类型定义、SHA-256、PDA 种子
│   │   │   └── nft-metadata.ts     # NFT 元数据构建器
│   │   └── test/
│   └── cnft-adapter/                # cNFT 适配器（含 Mock）
├── programs/
│   └── packrun/                     # Anchor Solana 程序
│       └── src/lib.rs
├── tests/
│   ├── packrun.test.mjs             # 测试入口（由 Anchor.toml 引用）
│   ├── packrun.gameplay.test.mjs    # 游戏逻辑集成测试（68 项）
│   └── packrun.anchor.test.mjs      # Anchor 本地网集成测试
├── Anchor.toml
└── start.sh                         # 一键启动脚本
```

## 快速开始

### 前置要求

- Node.js >= 18
- pnpm >= 10
- Solana CLI
- Anchor CLI >= 0.32.1

### 初始化 & 构建

```bash
# 1. 安装依赖（monorepo 所有包）
pnpm install

# 2. 构建所有包（shared → game-core）
pnpm build

# 3. 运行游戏逻辑单元测试
pnpm --filter @backpack-dungeon/game-core test
pnpm --filter @backpack-dungeon/shared test
```

### 运行测试

```bash
# 运行游戏逻辑集成测试（无需本地网）
node --experimental-strip-types --test tests/packrun.gameplay.test.mjs

# 使用一键脚本运行测试
./start.sh --test

# 运行 Anchor 集成测试（需要本地网）
NO_DNA=1 anchor test
```

### 启动开发环境

```bash
# 方式一：一键启动（构建 → 验证器 → 部署 → Web）
./start.sh

# 方式二：跳过 Anchor 构建
./start.sh --skip-build

# 方式三：仅启动 Web 前端（假设验证器已运行）
./start.sh --web-only

# 清理构建产物
./start.sh --clean
```

每日地图的所有随机结果都从一个数字种子派生。默认值在 `packages/game-core/src/daily-config.ts` 中维护，也可以启动时覆盖：

```bash
PACKRUN_RANDOM_SEED=123456 ./start.sh
PACKRUN_DAY_ID=2026-04-26 PACKRUN_RANDOM_SEED=123456 ./start.sh
```

`start.sh` 会用同一组配置初始化链上账户并启动 Web 前端，避免地图和 Merkle root 不一致。

地图现在每天只生成 1 个 Boss；该规则会改变 `mapRoot`，本地已经用旧 dayId 初始化过的 localnet 需要 reset ledger，或换一个新的 `PACKRUN_DAY_ID`。

PlayerRun 现在包含链上金币余额 `gold_balance`，账户空间比旧版本增加 8 bytes。升级后如果本地已有旧 `PlayerRun` 账户，前端会把金币显示为 0 并提示迁移；本地开发请 reset localnet ledger，或换一个新的 `PACKRUN_DAY_ID` / `NEXT_PUBLIC_PACKRUN_DAY_ID` 重新进入地牢。

### 启动 Web 前端（单独）

```bash
pnpm --filter @backpack-dungeon/web dev
```

## 可用 Scripts

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建所有包 |
| `pnpm test` | 运行所有包测试 |
| `pnpm dev:web` | 启动 Next.js 开发服务器 |
| `pnpm test:gameplay` | 运行游戏逻辑集成测试 |
| `pnpm test:anchor` | 运行 Anchor 集成测试 |
| `NO_DNA=1 anchor test` | 运行 Anchor 测试（跳过 DNA） |

## 技术栈

- **链上**: Solana + Anchor 0.32.1
- **前端**: Next.js 15 + React 19 + TypeScript
- **钱包**: Solana Wallet Adapter（Phantom, Solflare）
- **游戏引擎**: 纯 TypeScript 确定性逻辑
- **包管理**: pnpm monorepo
- **测试**: Node.js 原生测试运行器
