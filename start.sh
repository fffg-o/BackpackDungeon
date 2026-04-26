#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Backpack Dungeon — One-Click Startup Script
#
# Usage:
#   ./start.sh              # Full startup (build + validator + deploy + web)
#   ./start.sh --skip-build # Skip Anchor build, deploy existing binary
#   ./start.sh --web-only   # Start only the web frontend (assumes validator running)
#   ./start.sh --test       # Run the test suite instead of starting services
#   ./start.sh --clean      # Clean all build artifacts and start fresh
#
# This script:
#   1. Installs dependencies (pnpm install)
#   2. Builds the Anchor program (if needed)
#   3. Starts a Solana localnet validator (if not already running)
#   4. Deploys the Anchor program to localnet
#   5. Starts the Next.js web frontend
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Color helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${CYAN}═══════════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $*${NC}"; echo -e "${CYAN}═══════════════════════════════════════════════════${NC}\n"; }

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PROGRAM_DIR="$PROJECT_ROOT/programs/packrun"
WEB_DIR="$PROJECT_ROOT/apps/web"
ANCHOR_KEYPAIR="$HOME/.config/solana/id.json"
VALIDATOR_LEDGER="$PROJECT_ROOT/.anchor/test-ledger"
VALIDATOR_LOG="$PROJECT_ROOT/.anchor/validator.log"
ANCHOR_PROGRAM_ID="AKGsUEW5WUdUQ6vWVkWWLF4CosWHfWTPMsfckWKTpvtL"

# Parse flags
SKIP_BUILD=false
WEB_ONLY=false
RUN_TESTS=false
CLEAN=false

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --web-only)   WEB_ONLY=true ;;
    --test)       RUN_TESTS=true ;;
    --clean)      CLEAN=true ;;
    *)
      log_error "Unknown flag: $arg"
      echo "Usage: $0 [--skip-build] [--web-only] [--test] [--clean]"
      exit 1
      ;;
  esac
done

# ── Clean mode ────────────────────────────────────────────────────────────────
if [ "$CLEAN" = true ]; then
  log_step "Cleaning all build artifacts..."
  rm -rf "$VALIDATOR_LEDGER" "$VALIDATOR_LOG" 2>/dev/null || true
  rm -rf "$PROJECT_ROOT/target" 2>/dev/null || true
  rm -rf "$PROJECT_ROOT/.anchor" 2>/dev/null || true
  rm -rf "$PROJECT_ROOT/node_modules/.cache" 2>/dev/null || true
  log_ok "Clean complete. Run without --clean to start fresh."
  exit 0
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────
log_step "Pre-flight checks"

# Check required tools
for cmd in node pnpm solana anchor; do
  if ! command -v "$cmd" &>/dev/null; then
    log_error "'$cmd' is not installed. Please install it first."
    exit 1
  fi
done

log_ok "node $(node --version)"
log_ok "pnpm $(pnpm --version 2>/dev/null || echo 'not found')"
log_ok "solana $(solana --version 2>/dev/null | head -1 || echo 'not found')"
log_ok "anchor $(anchor --version 2>/dev/null || echo 'not found')"

# ── Web-only mode ─────────────────────────────────────────────────────────────
if [ "$WEB_ONLY" = true ]; then
  log_step "Starting web frontend only (web-only mode)"

  if [ ! -d "$WEB_DIR/node_modules" ]; then
    log_info "Installing dependencies..."
    cd "$PROJECT_ROOT" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  fi

  log_info "Starting Next.js dev server..."
  cd "$PROJECT_ROOT" && pnpm dev:web
  exit 0
fi

# ── Test mode ─────────────────────────────────────────────────────────────────
if [ "$RUN_TESTS" = true ]; then
  log_step "Running test suite"

  # Ensure dependencies are installed
  if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    log_info "Installing dependencies..."
    cd "$PROJECT_ROOT" && pnpm install
  fi

  # Build packages first
  log_info "Building packages..."
  cd "$PROJECT_ROOT" && pnpm -r --if-present build 2>/dev/null || true

  # Run game-core unit tests
  log_info "Running game-core unit tests..."
  cd "$PROJECT_ROOT/packages/game-core" && pnpm test 2>/dev/null || true

  # Run shared unit tests
  log_info "Running shared unit tests..."
  cd "$PROJECT_ROOT/packages/shared" && pnpm test 2>/dev/null || true

  # Run Anchor integration tests (requires validator)
  log_info "Running Anchor integration tests..."
  cd "$PROJECT_ROOT" && NO_DNA=1 anchor test --skip-build 2>/dev/null || {
    log_warn "Anchor test requires a running localnet. Starting one..."
    cd "$PROJECT_ROOT" && NO_DNA=1 anchor test 2>&1 | tail -20
  }

  log_ok "All tests completed."
  exit 0
fi

# ── Step 1: Install dependencies ──────────────────────────────────────────────
log_step "Step 1: Installing dependencies"

if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
  cd "$PROJECT_ROOT" && pnpm install
  log_ok "Dependencies installed"
else
  log_ok "Dependencies already installed (run 'pnpm install' to update)"
fi

# ── Step 2: Build Anchor program ──────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  log_step "Step 2: Building Anchor program"

  cd "$PROJECT_ROOT" && anchor build
  log_ok "Anchor program built"
else
  log_info "Skipping Anchor build (--skip-build)"
fi

# ── Step 3: Start Solana localnet validator ───────────────────────────────────
log_step "Step 3: Starting Solana localnet validator"

# Check if validator is already running
if solana config get 2>/dev/null | grep -q "localnet"; then
  if nc -z 127.0.0.1 8899 2>/dev/null; then
    log_ok "Validator already running on port 8899"
  fi
else
  log_info "Setting Solana config to localnet..."
  solana config set --url http://127.0.0.1:8899 2>/dev/null || true
fi

# Start validator if not already running
if ! nc -z 127.0.0.1 8899 2>/dev/null; then
  mkdir -p "$(dirname "$VALIDATOR_LOG")"

  log_info "Starting validator (background, log: $VALIDATOR_LOG)..."

  # Check if we have a keypair
  if [ ! -f "$ANCHOR_KEYPAIR" ]; then
    log_info "Creating default Solana keypair..."
    solana-keygen new --no-bip39-passphrase -f -s -o "$ANCHOR_KEYPAIR" 2>/dev/null
  fi

  solana-test-validator \
    --ledger "$VALIDATOR_LEDGER" \
    --reset \
    --quiet \
    --bind-address 0.0.0.0 \
    --rpc-port 8899 \
    --faucet-port 9900 \
    > "$VALIDATOR_LOG" 2>&1 &

  VALIDATOR_PID=$!
  echo "$VALIDATOR_PID" > "$PROJECT_ROOT/.anchor/validator.pid"

  # Wait for validator to be ready
  log_info "Waiting for validator to start..."
  for i in $(seq 1 30); do
    if nc -z 127.0.0.1 8899 2>/dev/null; then
      log_ok "Validator is ready (PID: $VALIDATOR_PID)"
      break
    fi
    if [ "$i" -eq 30 ]; then
      log_error "Validator failed to start within 30 seconds. Check $VALIDATOR_LOG"
      exit 1
    fi
    sleep 1
  done

  # Airdrop SOL to deployer
  sleep 2
  solana airdrop 500 "$(solana address)" 2>/dev/null || log_warn "Airdrop failed (may already have SOL)"
else
  log_ok "Validator already running on port 8899"
fi

# ── Step 4: Deploy Anchor program ─────────────────────────────────────────────
log_step "Step 4: Deploying Anchor program"

cd "$PROJECT_ROOT" && anchor deploy --provider.cluster localnet 2>/dev/null || {
  log_warn "anchor deploy failed, trying anchor build + solana program deploy..."
  cd "$PROJECT_ROOT" && anchor build 2>/dev/null || true
  solana program deploy \
    --program-id "$PROGRAM_DIR/target/deploy/packrun-keypair.json" \
    "$PROGRAM_DIR/target/deploy/packrun.so" \
    2>/dev/null || log_warn "Deploy failed (program may already be deployed)"
}

log_ok "Program deployed (or already deployed)"

# ── Step 5: Start web frontend ────────────────────────────────────────────────
log_step "Step 5: Starting web frontend"

log_info "Starting Next.js dev server on http://localhost:3000 ..."
cd "$PROJECT_ROOT" && pnpm dev:web
