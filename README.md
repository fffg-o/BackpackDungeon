# BackpackDungeon

BackpackDungeon is a pnpm monorepo for the Packrun game foundation.

## Workspaces

- `apps/web` - Next.js + TypeScript app
- `packages/shared` - shared Packrun types, constants, PDA helpers, canonical JSON helpers, and hash helpers
- `packages/game-core` - deterministic game logic package shell
- `programs/packrun` - Anchor Solana program

## Commands

```bash
pnpm install
pnpm build
pnpm --filter @backpack-dungeon/shared test
pnpm --filter @backpack-dungeon/web dev
NO_DNA=1 anchor test
```
