use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

declare_id!("AKGsUEW5WUdUQ6vWVkWWLF4CosWHfWTPMsfckWKTpvtL");

pub const DAILY_DUNGEON_SEED: &[u8] = b"dungeon";
pub const LOCATION_SEED: &[u8] = b"location";
pub const PLAYER_RUN_SEED: &[u8] = b"run";
pub const BOSS_SHARD_SEED: &[u8] = b"boss_shard";
pub const BOSS_CONTRIBUTION_SEED: &[u8] = b"boss_contribution";
pub const SHOP_ITEM_SLOT_SEED: &[u8] = b"shop_slot";
pub const DAILY_REWARD_CLAIM_SEED: &[u8] = b"daily_claim";

pub const DAY_ID_MAX_LEN: usize = 16;
pub const POI_ID_MAX_LEN: usize = 64;
pub const RUN_ID_MAX_LEN: usize = 64;
pub const ENEMY_ID_MAX_LEN: usize = 64;
pub const ENEMY_NAME_MAX_LEN: usize = 64;
pub const SHOP_KEEPER_MAX_LEN: usize = 32;
pub const ITEM_ID_MAX_LEN: usize = 64;
pub const DEFAULT_PLAYER_RUN_ENERGY: u16 = 100;
pub const DEFAULT_ENEMY_CLEAR_ENERGY_COST: u16 = 5;
pub const DEFAULT_ENEMY_BASE_COOLDOWN_SECONDS: i64 = 60;
pub const DEFAULT_DAILY_ENEMY_CLEAR_LIMIT: u32 = 100;
pub const DEFAULT_VALUABLE_CLEAR_CAP: u16 = 5;
pub const MAX_MERKLE_PROOF_LEN: usize = 32;

pub const DAILY_DUNGEON_SPACE: usize = 8 + DailyDungeon::INIT_SPACE;
pub const LOCATION_ACCOUNT_SPACE: usize = 8 + LocationAccount::INIT_SPACE;
pub const ENEMY_LOCATION_SPACE: usize = 8 + EnemyLocation::INIT_SPACE;
pub const SHOP_ACCOUNT_SPACE: usize = 8 + ShopAccount::INIT_SPACE;
pub const SHOP_ITEM_SLOT_ACCOUNT_SPACE: usize = 8 + ShopItemSlotAccount::INIT_SPACE;
pub const PLAYER_RUN_SPACE: usize = 8 + PlayerRun::INIT_SPACE;
pub const BOSS_DAMAGE_SHARD_SPACE: usize = 8 + BossDamageShard::INIT_SPACE;
pub const PLAYER_BOSS_CONTRIBUTION_SPACE: usize = 8 + PlayerBossContribution::INIT_SPACE;
pub const REWARD_POOL_SPACE: usize = 8 + RewardPool::INIT_SPACE;
pub const DAILY_REWARD_CLAIM_SPACE: usize = 8 + DailyRewardClaim::INIT_SPACE;

#[program]
pub mod packrun {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    pub fn init_daily_dungeon(
        ctx: Context<InitDailyDungeon>,
        day_id: String,
        map_root: [u8; 32],
        ruleset_hash: [u8; 32],
        width: u32,
        height: u32,
        start_ts: i64,
        end_ts: i64,
        boss_hp: u64,
        boss_shard_count: u16,
    ) -> Result<()> {
        validate_init_daily_dungeon_input(
            &day_id,
            width,
            height,
            start_ts,
            end_ts,
            boss_hp,
            boss_shard_count,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let dungeon = &mut ctx.accounts.daily_dungeon;
        dungeon.day_id = day_id;
        dungeon.authority = ctx.accounts.authority.key();
        dungeon.status = DungeonStatus::Open;
        dungeon.map_root = map_root;
        dungeon.ruleset_hash = ruleset_hash;
        dungeon.width = width;
        dungeon.height = height;
        dungeon.location_count = 0;
        dungeon.enemy_count = 0;
        dungeon.shop_count = 0;
        dungeon.treasure_count = 0;
        dungeon.boss_count = 0;
        dungeon.start_ts = start_ts;
        dungeon.end_ts = end_ts;
        dungeon.boss_hp = boss_hp;
        dungeon.boss_shard_count = boss_shard_count;
        dungeon.created_at = now;
        dungeon.updated_at = now;
        dungeon.bump = ctx.bumps.daily_dungeon;

        Ok(())
    }

    pub fn enter_dungeon(ctx: Context<EnterDungeon>, day_id: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_enter_dungeon(&ctx.accounts.daily_dungeon, &day_id, now)?;

        let player_run = &mut ctx.accounts.player_run;
        player_run.day_id = day_id;
        player_run.player = ctx.accounts.player.key();
        player_run.daily_dungeon = ctx.accounts.daily_dungeon.key();
        player_run.energy = DEFAULT_PLAYER_RUN_ENERGY;
        player_run.cleared_locations = 0;
        player_run.boss_damage = 0;
        player_run.common_loot_count = 0;
        player_run.rare_eligibility_points = 0;
        player_run.entered_at = now;
        player_run.active = true;
        player_run.bump = ctx.bumps.player_run;

        Ok(())
    }

    pub fn init_location_from_merkle(
        ctx: Context<InitLocationFromMerkle>,
        spec: LocationSpecInput,
        proof: Vec<LocationMerkleProofStep>,
    ) -> Result<()> {
        validate_location_spec_input(&spec)?;
        require!(
            verify_location_merkle_proof(ctx.accounts.daily_dungeon.map_root, &spec, &proof)?,
            PackrunError::InvalidLocationMerkleProof
        );

        let location = &mut ctx.accounts.location_account;
        location.daily_dungeon = ctx.accounts.daily_dungeon.key();
        location.day_id = spec.day_id.clone();
        location.poi_id = spec.poi_id.clone();
        location.kind = spec.kind;
        location.status = LocationStatus::Available;
        location.x = spec.x;
        location.y = spec.y;
        location.base_config_hash = spec.base_config_hash;
        location.bump = ctx.bumps.location_account;

        match spec.kind {
            LocationKind::Enemy => {
                let enemy = spec
                    .enemy
                    .as_ref()
                    .ok_or(error!(PackrunError::MissingLocationDetail))?;
                let enemy_location = ctx
                    .accounts
                    .enemy_location
                    .as_mut()
                    .ok_or(error!(PackrunError::MissingLocationDetail))?;
                require!(
                    ctx.accounts.shop_account.is_none(),
                    PackrunError::UnexpectedLocationDetail
                );

                enemy_location.location = location.key();
                enemy_location.day_id = spec.day_id.clone();
                enemy_location.poi_id = spec.poi_id.clone();
                enemy_location.enemy_id = enemy.id.clone();
                enemy_location.name = enemy.name.clone();
                enemy_location.level = enemy.level;
                enemy_location.base_hp = enemy.max_health;
                enemy_location.base_damage = enemy.attack;
                enemy_location.difficulty_level = enemy.level;
                enemy_location.max_reward_tier = enemy.reward_tier;
                enemy_location.valuable_clear_cap = DEFAULT_VALUABLE_CLEAR_CAP;
                enemy_location.clear_count = 0;
                enemy_location.base_cooldown_seconds = DEFAULT_ENEMY_BASE_COOLDOWN_SECONDS;
                enemy_location.next_available_at = 0;
                ctx.accounts.daily_dungeon.enemy_count =
                    ctx.accounts.daily_dungeon.enemy_count.saturating_add(1);
            }
            LocationKind::Shop => {
                let shop = spec
                    .shop
                    .as_ref()
                    .ok_or(error!(PackrunError::MissingLocationDetail))?;
                let shop_account = ctx
                    .accounts
                    .shop_account
                    .as_mut()
                    .ok_or(error!(PackrunError::MissingLocationDetail))?;
                require!(
                    ctx.accounts.enemy_location.is_none(),
                    PackrunError::UnexpectedLocationDetail
                );

                shop_account.location = location.key();
                shop_account.day_id = spec.day_id.clone();
                shop_account.poi_id = spec.poi_id.clone();
                shop_account.keeper_name = shop.keeper_name.clone().unwrap_or_default();
                shop_account.slot_count = shop.item_slots.len() as u16;
                shop_account.opened_at = Clock::get()?.unix_timestamp;
                ctx.accounts.daily_dungeon.shop_count =
                    ctx.accounts.daily_dungeon.shop_count.saturating_add(1);
            }
            LocationKind::Boss => {
                require!(
                    ctx.accounts.enemy_location.is_none() && ctx.accounts.shop_account.is_none(),
                    PackrunError::UnexpectedLocationDetail
                );
                ctx.accounts.daily_dungeon.boss_count =
                    ctx.accounts.daily_dungeon.boss_count.saturating_add(1);
            }
            LocationKind::Treasure => {
                require!(
                    ctx.accounts.enemy_location.is_none() && ctx.accounts.shop_account.is_none(),
                    PackrunError::UnexpectedLocationDetail
                );
                ctx.accounts.daily_dungeon.treasure_count =
                    ctx.accounts.daily_dungeon.treasure_count.saturating_add(1);
            }
            LocationKind::Event => {
                require!(
                    ctx.accounts.enemy_location.is_none() && ctx.accounts.shop_account.is_none(),
                    PackrunError::UnexpectedLocationDetail
                );
            }
        }

        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.daily_dungeon.location_count =
            ctx.accounts.daily_dungeon.location_count.saturating_add(1);
        ctx.accounts.daily_dungeon.updated_at = now;

        Ok(())
    }

    pub fn clear_enemy(
        ctx: Context<ClearEnemy>,
        battle_result_hash: [u8; 32],
        player_performance_summary: PlayerPerformanceSummary,
        proof_uri_hash: Option<[u8; 32]>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_clear_enemy(
            &ctx.accounts.daily_dungeon,
            &ctx.accounts.location_account,
            &ctx.accounts.enemy_location,
            &ctx.accounts.player_run,
            now,
        )?;

        let outcome = apply_clear_enemy_state(
            &mut ctx.accounts.enemy_location,
            &mut ctx.accounts.player_run,
            &player_performance_summary,
            now,
        )?;

        emit!(EnemyCleared {
            battle_result_hash,
            clear_count: outcome.clear_count,
            common_loot_count: ctx.accounts.player_run.common_loot_count,
            day_id: ctx.accounts.daily_dungeon.day_id.clone(),
            difficulty_level: outcome.difficulty_level,
            energy_spent: outcome.energy_spent,
            location: ctx.accounts.location_account.key(),
            next_available_at: outcome.next_available_at,
            player: ctx.accounts.player.key(),
            poi_id: ctx.accounts.location_account.poi_id.clone(),
            proof_uri_hash,
            rare_eligibility_points_awarded: outcome.rare_eligibility_points_awarded,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
#[instruction(day_id: String)]
pub struct InitDailyDungeon<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = DAILY_DUNGEON_SPACE,
        seeds = [DAILY_DUNGEON_SEED, day_id.as_bytes()],
        bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day_id: String)]
pub struct EnterDungeon<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        seeds = [DAILY_DUNGEON_SEED, day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        init,
        payer = player,
        space = PLAYER_RUN_SPACE,
        seeds = [PLAYER_RUN_SEED, day_id.as_bytes(), player.key().as_ref()],
        bump
    )]
    pub player_run: Account<'info, PlayerRun>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(spec: LocationSpecInput)]
pub struct InitLocationFromMerkle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [DAILY_DUNGEON_SEED, spec.day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        init,
        payer = authority,
        space = LOCATION_ACCOUNT_SPACE,
        seeds = [LOCATION_SEED, spec.day_id.as_bytes(), spec.poi_id.as_bytes()],
        bump
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(init, payer = authority, space = ENEMY_LOCATION_SPACE)]
    pub enemy_location: Option<Account<'info, EnemyLocation>>,
    #[account(init, payer = authority, space = SHOP_ACCOUNT_SPACE)]
    pub shop_account: Option<Account<'info, ShopAccount>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClearEnemy<'info> {
    pub player: Signer<'info>,
    #[account(
        seeds = [DAILY_DUNGEON_SEED, daily_dungeon.day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        mut,
        seeds = [PLAYER_RUN_SEED, daily_dungeon.day_id.as_bytes(), player.key().as_ref()],
        bump = player_run.bump,
        constraint = player_run.player == player.key() @ PackrunError::InvalidPlayerRun,
        constraint = player_run.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidPlayerRun
    )]
    pub player_run: Account<'info, PlayerRun>,
    #[account(
        seeds = [LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id.as_bytes()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(
        mut,
        constraint = enemy_location.location == location_account.key() @ PackrunError::InvalidEnemyLocation,
        constraint = enemy_location.day_id == daily_dungeon.day_id @ PackrunError::InvalidEnemyLocation,
        constraint = enemy_location.poi_id == location_account.poi_id @ PackrunError::InvalidEnemyLocation
    )]
    pub enemy_location: Account<'info, EnemyLocation>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum DungeonStatus {
    Pending,
    Open,
    Completed,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum LocationKind {
    Enemy,
    Shop,
    Treasure,
    Boss,
    Event,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum LocationStatus {
    Hidden,
    Available,
    Cleared,
    Exhausted,
    Locked,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum RewardTier {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MerkleProofPosition {
    Left,
    Right,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LocationMerkleProofStep {
    pub sibling: [u8; 32],
    pub position: MerkleProofPosition,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LocationSpecInput {
    pub day_id: String,
    pub poi_id: String,
    pub kind: LocationKind,
    pub x: u32,
    pub y: u32,
    pub base_config_hash: [u8; 32],
    pub enemy: Option<EnemySpecInput>,
    pub shop: Option<ShopSpecInput>,
    pub boss: Option<BossSpecInput>,
    pub reward_tier: Option<RewardTier>,
    pub event_id: Option<String>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct EnemySpecInput {
    pub id: String,
    pub name: String,
    pub level: u16,
    pub max_health: u32,
    pub attack: u32,
    pub reward_tier: RewardTier,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct BossSpecInput {
    pub id: String,
    pub name: String,
    pub level: u16,
    pub max_health: u32,
    pub attack: u32,
    pub reward_tier: RewardTier,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ShopSpecInput {
    pub id: String,
    pub keeper_name: Option<String>,
    pub item_slots: Vec<ShopItemSlotSpecInput>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ShopItemSlotSpecInput {
    pub slot_id: String,
    pub item_id: String,
    pub price: u64,
    pub stock: u16,
    pub reward_tier: RewardTier,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct PlayerPerformanceSummary {
    pub damage_dealt: u32,
    pub damage_taken: u32,
    pub turns_taken: u16,
    pub score: u32,
    pub flawless: bool,
}

#[event]
pub struct EnemyCleared {
    pub battle_result_hash: [u8; 32],
    pub clear_count: u64,
    pub common_loot_count: u32,
    pub day_id: String,
    pub difficulty_level: u16,
    pub energy_spent: u16,
    pub location: Pubkey,
    pub next_available_at: i64,
    pub player: Pubkey,
    pub poi_id: String,
    pub proof_uri_hash: Option<[u8; 32]>,
    pub rare_eligibility_points_awarded: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClearEnemyOutcome {
    pub clear_count: u64,
    pub difficulty_level: u16,
    pub energy_spent: u16,
    pub next_available_at: i64,
    pub rare_eligibility_points_awarded: u32,
}

/// PDA: ["dungeon", day_id]
#[account]
#[derive(InitSpace)]
pub struct DailyDungeon {
    #[max_len(16)]
    pub day_id: String,
    pub authority: Pubkey,
    pub status: DungeonStatus,
    pub map_root: [u8; 32],
    pub ruleset_hash: [u8; 32],
    pub width: u32,
    pub height: u32,
    pub location_count: u32,
    pub enemy_count: u32,
    pub shop_count: u32,
    pub treasure_count: u32,
    pub boss_count: u32,
    pub start_ts: i64,
    pub end_ts: i64,
    pub boss_hp: u64,
    pub boss_shard_count: u16,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

/// PDA: ["location", day_id, poi_id]
#[account]
#[derive(InitSpace)]
pub struct LocationAccount {
    pub daily_dungeon: Pubkey,
    #[max_len(16)]
    pub day_id: String,
    #[max_len(64)]
    pub poi_id: String,
    pub kind: LocationKind,
    pub status: LocationStatus,
    pub x: u32,
    pub y: u32,
    pub base_config_hash: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EnemyLocation {
    pub location: Pubkey,
    #[max_len(16)]
    pub day_id: String,
    #[max_len(64)]
    pub poi_id: String,
    #[max_len(64)]
    pub enemy_id: String,
    #[max_len(64)]
    pub name: String,
    pub level: u16,
    pub base_hp: u32,
    pub base_damage: u32,
    pub difficulty_level: u16,
    pub max_reward_tier: RewardTier,
    pub valuable_clear_cap: u16,
    pub clear_count: u64,
    pub base_cooldown_seconds: i64,
    pub next_available_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct ShopAccount {
    pub location: Pubkey,
    #[max_len(16)]
    pub day_id: String,
    #[max_len(64)]
    pub poi_id: String,
    #[max_len(32)]
    pub keeper_name: String,
    pub slot_count: u16,
    pub opened_at: i64,
}

/// PDA: ["shop_slot", day_id, poi_id, slot_index]
#[account]
#[derive(InitSpace)]
pub struct ShopItemSlotAccount {
    pub shop: Pubkey,
    #[max_len(16)]
    pub day_id: String,
    #[max_len(64)]
    pub poi_id: String,
    pub slot_index: u16,
    #[max_len(64)]
    pub item_id: String,
    pub reward_tier: RewardTier,
    pub base_price: u64,
    pub base_stock: u16,
    pub max_stock: u16,
    pub sold_count: u64,
    pub restock_interval_seconds: i64,
    pub max_restock_count: u16,
    pub per_wallet_daily_limit: u16,
    pub opened_at: i64,
    pub bump: u8,
}

/// PDA: ["run", day_id, player]
#[account]
#[derive(InitSpace)]
pub struct PlayerRun {
    #[max_len(16)]
    pub day_id: String,
    pub player: Pubkey,
    pub daily_dungeon: Pubkey,
    pub energy: u16,
    pub cleared_locations: u32,
    pub boss_damage: u64,
    pub common_loot_count: u32,
    pub rare_eligibility_points: u32,
    pub entered_at: i64,
    pub active: bool,
    pub bump: u8,
}

/// PDA: ["boss_shard", day_id, shard_index]
#[account]
#[derive(InitSpace)]
pub struct BossDamageShard {
    #[max_len(16)]
    pub day_id: String,
    pub boss_location: Pubkey,
    pub shard_index: u16,
    pub total_damage: u64,
    pub contribution_count: u32,
    pub bump: u8,
}

/// PDA: ["boss_contribution", day_id, player]
#[account]
#[derive(InitSpace)]
pub struct PlayerBossContribution {
    #[max_len(16)]
    pub day_id: String,
    pub player: Pubkey,
    pub boss_location: Pubkey,
    pub shard_index: u16,
    pub total_damage: u64,
    pub last_hit_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RewardPool {
    #[max_len(16)]
    pub day_id: String,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub reward_tier: RewardTier,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub claim_count: u32,
}

/// PDA: ["daily_claim", day_id, player]
#[account]
#[derive(InitSpace)]
pub struct DailyRewardClaim {
    #[max_len(16)]
    pub day_id: String,
    pub player: Pubkey,
    pub reward_pool: Pubkey,
    pub reward_tier: RewardTier,
    pub amount: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

fn validate_init_daily_dungeon_input(
    day_id: &str,
    width: u32,
    height: u32,
    start_ts: i64,
    end_ts: i64,
    boss_hp: u64,
    boss_shard_count: u16,
) -> Result<()> {
    require!(day_id.len() <= DAY_ID_MAX_LEN, PackrunError::DayIdTooLong);
    require!(width > 0, PackrunError::InvalidMapDimensions);
    require!(height > 0, PackrunError::InvalidMapDimensions);
    require!(start_ts < end_ts, PackrunError::InvalidTimeRange);
    require!(boss_hp > 0, PackrunError::InvalidBossHp);
    require!(boss_shard_count > 0, PackrunError::InvalidBossShardCount);

    Ok(())
}

fn validate_enter_dungeon(dungeon: &DailyDungeon, day_id: &str, now: i64) -> Result<()> {
    require!(day_id.len() <= DAY_ID_MAX_LEN, PackrunError::DayIdTooLong);
    require!(dungeon.day_id == day_id, PackrunError::DungeonDayMismatch);
    require!(
        dungeon.status == DungeonStatus::Open,
        PackrunError::DungeonNotOpen
    );
    require!(
        now >= dungeon.start_ts && now <= dungeon.end_ts,
        PackrunError::DungeonNotInOpenWindow
    );

    Ok(())
}

fn validate_clear_enemy(
    dungeon: &DailyDungeon,
    location: &LocationAccount,
    enemy: &EnemyLocation,
    player_run: &PlayerRun,
    now: i64,
) -> Result<()> {
    require!(
        dungeon.status == DungeonStatus::Open,
        PackrunError::DungeonNotOpen
    );
    require!(
        now >= dungeon.start_ts && now <= dungeon.end_ts,
        PackrunError::DungeonNotInOpenWindow
    );
    require!(player_run.active, PackrunError::PlayerRunNotActive);
    require!(
        location.kind == LocationKind::Enemy,
        PackrunError::LocationIsNotEnemy
    );
    require!(
        now >= enemy.next_available_at,
        PackrunError::EnemyOnCooldown
    );
    require!(
        player_run.energy >= DEFAULT_ENEMY_CLEAR_ENERGY_COST,
        PackrunError::InsufficientEnergy
    );
    require!(
        player_run.cleared_locations < DEFAULT_DAILY_ENEMY_CLEAR_LIMIT,
        PackrunError::DailyClearLimitExceeded
    );

    Ok(())
}

fn apply_clear_enemy_state(
    enemy: &mut EnemyLocation,
    player_run: &mut PlayerRun,
    player_performance_summary: &PlayerPerformanceSummary,
    now: i64,
) -> Result<ClearEnemyOutcome> {
    player_run.energy = player_run
        .energy
        .checked_sub(DEFAULT_ENEMY_CLEAR_ENERGY_COST)
        .ok_or(error!(PackrunError::InsufficientEnergy))?;
    enemy.clear_count = enemy
        .clear_count
        .checked_add(1)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    enemy.difficulty_level = compute_enemy_difficulty_level(enemy.level, enemy.clear_count)?;
    enemy.next_available_at = now
        .checked_add(compute_enemy_cooldown_seconds(
            enemy.base_cooldown_seconds,
            enemy.clear_count,
        )?)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;

    player_run.cleared_locations = player_run
        .cleared_locations
        .checked_add(1)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    player_run.common_loot_count = player_run
        .common_loot_count
        .checked_add(1)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;

    let rare_eligibility_points_awarded = compute_rare_eligibility_points(
        player_performance_summary,
        enemy.clear_count,
        enemy.valuable_clear_cap,
    );
    player_run.rare_eligibility_points = player_run
        .rare_eligibility_points
        .checked_add(rare_eligibility_points_awarded)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;

    Ok(ClearEnemyOutcome {
        clear_count: enemy.clear_count,
        difficulty_level: enemy.difficulty_level,
        energy_spent: DEFAULT_ENEMY_CLEAR_ENERGY_COST,
        next_available_at: enemy.next_available_at,
        rare_eligibility_points_awarded,
    })
}

fn compute_enemy_difficulty_level(base_level: u16, clear_count: u64) -> Result<u16> {
    let clear_bonus = clear_count.min(u16::MAX as u64) as u16;
    base_level
        .checked_add(clear_bonus)
        .ok_or(error!(PackrunError::ArithmeticOverflow))
}

fn compute_enemy_cooldown_seconds(base_cooldown_seconds: i64, clear_count: u64) -> Result<i64> {
    let base = if base_cooldown_seconds > 0 {
        base_cooldown_seconds
    } else {
        DEFAULT_ENEMY_BASE_COOLDOWN_SECONDS
    };
    let clear_count =
        i64::try_from(clear_count).map_err(|_| error!(PackrunError::ArithmeticOverflow))?;
    base.checked_mul(100 + clear_count * 5)
        .and_then(|value| value.checked_div(100))
        .ok_or(error!(PackrunError::ArithmeticOverflow))
}

fn compute_rare_eligibility_points(
    player_performance_summary: &PlayerPerformanceSummary,
    clear_count: u64,
    valuable_clear_cap: u16,
) -> u32 {
    if valuable_clear_cap == 0 || clear_count >= valuable_clear_cap as u64 {
        return 0;
    }

    let mut points = 1 + (player_performance_summary.score / 1_000).min(3);
    if player_performance_summary.flawless {
        points += 1;
    }
    if player_performance_summary.damage_taken == 0 {
        points += 1;
    }
    if player_performance_summary.turns_taken <= 5 {
        points += 1;
    }

    points.min(7)
}

fn validate_location_spec_input(spec: &LocationSpecInput) -> Result<()> {
    require!(
        spec.day_id.len() <= DAY_ID_MAX_LEN,
        PackrunError::DayIdTooLong
    );
    require!(
        spec.poi_id.len() <= POI_ID_MAX_LEN,
        PackrunError::PoiIdTooLong
    );

    if let Some(enemy) = &spec.enemy {
        require!(
            enemy.id.len() <= ENEMY_ID_MAX_LEN,
            PackrunError::LocationDetailTooLong
        );
        require!(
            enemy.name.len() <= ENEMY_NAME_MAX_LEN,
            PackrunError::LocationDetailTooLong
        );
    }

    if let Some(boss) = &spec.boss {
        require!(
            boss.id.len() <= ENEMY_ID_MAX_LEN,
            PackrunError::LocationDetailTooLong
        );
        require!(
            boss.name.len() <= ENEMY_NAME_MAX_LEN,
            PackrunError::LocationDetailTooLong
        );
    }

    if let Some(shop) = &spec.shop {
        require!(
            shop.id.len() <= POI_ID_MAX_LEN,
            PackrunError::LocationDetailTooLong
        );
        if let Some(keeper_name) = &shop.keeper_name {
            require!(
                keeper_name.len() <= SHOP_KEEPER_MAX_LEN,
                PackrunError::LocationDetailTooLong
            );
        }
        for slot in &shop.item_slots {
            require!(
                slot.slot_id.len() <= POI_ID_MAX_LEN,
                PackrunError::LocationDetailTooLong
            );
            require!(
                slot.item_id.len() <= ITEM_ID_MAX_LEN,
                PackrunError::LocationDetailTooLong
            );
        }
    }

    if let Some(event_id) = &spec.event_id {
        require!(
            event_id.len() <= POI_ID_MAX_LEN,
            PackrunError::LocationDetailTooLong
        );
    }

    Ok(())
}

fn verify_location_merkle_proof(
    root: [u8; 32],
    spec: &LocationSpecInput,
    proof: &[LocationMerkleProofStep],
) -> Result<bool> {
    require!(
        proof.len() <= MAX_MERKLE_PROOF_LEN,
        PackrunError::MerkleProofTooLong
    );

    let mut computed = location_leaf_hash(spec);
    for step in proof {
        computed = match step.position {
            MerkleProofPosition::Left => location_parent_hash(step.sibling, computed),
            MerkleProofPosition::Right => location_parent_hash(computed, step.sibling),
        };
    }

    Ok(computed == root)
}

fn location_leaf_hash(spec: &LocationSpecInput) -> [u8; 32] {
    sha256_json(&location_leaf_json(spec))
}

fn location_parent_hash(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut json = String::from("{\"domain\":\"location-merkle-node\",\"left\":\"");
    json.push_str(&bytes_to_hex(&left));
    json.push_str("\",\"right\":\"");
    json.push_str(&bytes_to_hex(&right));
    json.push_str("\",\"version\":1}");
    sha256_json(&json)
}

fn location_leaf_json(spec: &LocationSpecInput) -> String {
    let mut json = String::from("{\"domain\":\"location-merkle-leaf\",\"spec\":{");
    json.push_str("\"baseConfigHash\":\"");
    json.push_str(&bytes_to_hex(&spec.base_config_hash));
    json.push('"');

    if let Some(boss) = &spec.boss {
        json.push_str(",\"boss\":");
        append_boss_json(&mut json, boss);
    }

    if let Some(enemy) = &spec.enemy {
        json.push_str(",\"enemy\":");
        append_enemy_json(&mut json, enemy);
    }

    if let Some(event_id) = &spec.event_id {
        json.push_str(",\"eventId\":");
        append_json_string(&mut json, event_id);
    }

    json.push_str(",\"id\":");
    append_json_string(&mut json, &spec.poi_id);
    json.push_str(",\"kind\":\"");
    json.push_str(location_kind_name(spec.kind));
    json.push_str("\",\"position\":{\"x\":");
    json.push_str(&spec.x.to_string());
    json.push_str(",\"y\":");
    json.push_str(&spec.y.to_string());
    json.push('}');

    if let Some(reward_tier) = spec.reward_tier {
        json.push_str(",\"rewardTier\":\"");
        json.push_str(reward_tier_name(reward_tier));
        json.push('"');
    }

    if let Some(shop) = &spec.shop {
        json.push_str(",\"shop\":");
        append_shop_json(&mut json, shop);
    }

    json.push_str("},\"version\":1}");
    json
}

fn append_enemy_json(json: &mut String, enemy: &EnemySpecInput) {
    json.push_str("{\"attack\":");
    json.push_str(&enemy.attack.to_string());
    json.push_str(",\"id\":");
    append_json_string(json, &enemy.id);
    json.push_str(",\"level\":");
    json.push_str(&enemy.level.to_string());
    json.push_str(",\"maxHealth\":");
    json.push_str(&enemy.max_health.to_string());
    json.push_str(",\"name\":");
    append_json_string(json, &enemy.name);
    json.push_str(",\"rewardTier\":\"");
    json.push_str(reward_tier_name(enemy.reward_tier));
    json.push_str("\"}");
}

fn append_boss_json(json: &mut String, boss: &BossSpecInput) {
    json.push_str("{\"attack\":");
    json.push_str(&boss.attack.to_string());
    json.push_str(",\"id\":");
    append_json_string(json, &boss.id);
    json.push_str(",\"level\":");
    json.push_str(&boss.level.to_string());
    json.push_str(",\"maxHealth\":");
    json.push_str(&boss.max_health.to_string());
    json.push_str(",\"name\":");
    append_json_string(json, &boss.name);
    json.push_str(",\"rewardTier\":\"");
    json.push_str(reward_tier_name(boss.reward_tier));
    json.push_str("\"}");
}

fn append_shop_json(json: &mut String, shop: &ShopSpecInput) {
    json.push_str("{\"id\":");
    append_json_string(json, &shop.id);
    json.push_str(",\"itemSlots\":[");
    for (index, slot) in shop.item_slots.iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push_str("{\"itemId\":");
        append_json_string(json, &slot.item_id);
        json.push_str(",\"price\":");
        json.push_str(&slot.price.to_string());
        json.push_str(",\"rewardTier\":\"");
        json.push_str(reward_tier_name(slot.reward_tier));
        json.push_str("\",\"slotId\":");
        append_json_string(json, &slot.slot_id);
        json.push_str(",\"stock\":");
        json.push_str(&slot.stock.to_string());
        json.push('}');
    }
    json.push(']');

    if let Some(keeper_name) = &shop.keeper_name {
        json.push_str(",\"keeperName\":");
        append_json_string(json, keeper_name);
    }

    json.push('}');
}

fn append_json_string(json: &mut String, value: &str) {
    json.push('"');
    for character in value.chars() {
        match character {
            '"' => json.push_str("\\\""),
            '\\' => json.push_str("\\\\"),
            '\u{08}' => json.push_str("\\b"),
            '\u{0c}' => json.push_str("\\f"),
            '\n' => json.push_str("\\n"),
            '\r' => json.push_str("\\r"),
            '\t' => json.push_str("\\t"),
            character if character <= '\u{1f}' => {
                json.push_str("\\u00");
                json.push(hex_nibble((character as u8) >> 4));
                json.push(hex_nibble((character as u8) & 0x0f));
            }
            character => json.push(character),
        }
    }
    json.push('"');
}

fn sha256_json(json: &str) -> [u8; 32] {
    hash(json.as_bytes()).to_bytes()
}

fn bytes_to_hex(bytes: &[u8; 32]) -> String {
    let mut hex = String::with_capacity(64);
    for byte in bytes {
        hex.push(hex_nibble(byte >> 4));
        hex.push(hex_nibble(byte & 0x0f));
    }
    hex
}

fn hex_nibble(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + value - 10) as char,
        _ => unreachable!(),
    }
}

fn location_kind_name(kind: LocationKind) -> &'static str {
    match kind {
        LocationKind::Enemy => "Enemy",
        LocationKind::Shop => "Shop",
        LocationKind::Treasure => "Treasure",
        LocationKind::Boss => "Boss",
        LocationKind::Event => "Event",
    }
}

fn reward_tier_name(tier: RewardTier) -> &'static str {
    match tier {
        RewardTier::Common => "Common",
        RewardTier::Uncommon => "Uncommon",
        RewardTier::Rare => "Rare",
        RewardTier::Epic => "Epic",
        RewardTier::Legendary => "Legendary",
    }
}

#[error_code]
pub enum PackrunError {
    #[msg("day_id exceeds the maximum supported length.")]
    DayIdTooLong,
    #[msg("width and height must both be greater than zero.")]
    InvalidMapDimensions,
    #[msg("start_ts must be less than end_ts.")]
    InvalidTimeRange,
    #[msg("boss_hp must be greater than zero.")]
    InvalidBossHp,
    #[msg("boss_shard_count must be greater than zero.")]
    InvalidBossShardCount,
    #[msg("daily dungeon account does not match the requested day_id.")]
    DungeonDayMismatch,
    #[msg("daily dungeon is not open.")]
    DungeonNotOpen,
    #[msg("current time is outside the daily dungeon open window.")]
    DungeonNotInOpenWindow,
    #[msg("poi_id exceeds the maximum supported length.")]
    PoiIdTooLong,
    #[msg("location detail field exceeds the maximum supported length.")]
    LocationDetailTooLong,
    #[msg("location Merkle proof is invalid.")]
    InvalidLocationMerkleProof,
    #[msg("location Merkle proof is too long.")]
    MerkleProofTooLong,
    #[msg("required location detail account or spec is missing.")]
    MissingLocationDetail,
    #[msg("unexpected location detail account was provided.")]
    UnexpectedLocationDetail,
    #[msg("player run account is invalid.")]
    InvalidPlayerRun,
    #[msg("location account is invalid.")]
    InvalidLocationAccount,
    #[msg("enemy location account is invalid.")]
    InvalidEnemyLocation,
    #[msg("player run is not active.")]
    PlayerRunNotActive,
    #[msg("location is not an enemy.")]
    LocationIsNotEnemy,
    #[msg("enemy is still on cooldown.")]
    EnemyOnCooldown,
    #[msg("player does not have enough energy.")]
    InsufficientEnergy,
    #[msg("player has exceeded the daily enemy clear limit.")]
    DailyClearLimitExceeded,
    #[msg("arithmetic overflow.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_daily_dungeon_inputs() {
        assert!(
            validate_init_daily_dungeon_input("2026-04-25", 100, 80, 1_000, 2_000, 50_000, 8)
                .is_ok()
        );
    }

    #[test]
    fn rejects_invalid_daily_dungeon_time_range() {
        assert!(
            validate_init_daily_dungeon_input("2026-04-25", 100, 80, 2_000, 2_000, 50_000, 8)
                .is_err()
        );
    }

    #[test]
    fn rejects_invalid_daily_dungeon_dimensions() {
        assert!(
            validate_init_daily_dungeon_input("2026-04-25", 0, 80, 1_000, 2_000, 50_000, 8)
                .is_err()
        );
    }

    #[test]
    fn rejects_invalid_daily_dungeon_boss_shards() {
        assert!(
            validate_init_daily_dungeon_input("2026-04-25", 100, 80, 1_000, 2_000, 50_000, 0)
                .is_err()
        );
    }

    #[test]
    fn validates_enter_dungeon() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);

        assert!(validate_enter_dungeon(&dungeon, "2026-04-25", 1_500).is_ok());
    }

    #[test]
    fn rejects_enter_dungeon_when_not_open() {
        let dungeon = test_dungeon(DungeonStatus::Pending, 1_000, 2_000);

        assert!(validate_enter_dungeon(&dungeon, "2026-04-25", 1_500).is_err());
    }

    #[test]
    fn rejects_enter_dungeon_before_open_window() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);

        assert!(validate_enter_dungeon(&dungeon, "2026-04-25", 999).is_err());
    }

    #[test]
    fn rejects_enter_dungeon_after_open_window() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);

        assert!(validate_enter_dungeon(&dungeon, "2026-04-25", 2_001).is_err());
    }

    #[test]
    fn location_leaf_hash_matches_game_core() {
        let spec = test_enemy_location_spec();

        assert_eq!(
            location_leaf_hash(&spec),
            hex_32("50299658ca6eed17c096eb4a9d24752becb15f4435aadef3daff078d3a3cda4c")
        );
    }

    #[test]
    fn valid_location_merkle_proof_passes() {
        let spec = test_enemy_location_spec();
        let root = hex_32("10b2ef0d72461a03713b56bb782f0c5899a78233a68f2023ace1753d04f11b6e");
        let proof = vec![LocationMerkleProofStep {
            position: MerkleProofPosition::Right,
            sibling: hex_32("d011fbb83a5c8f4036b2cb73f2b95113924ff21a8504ac105f8a86fab9cdf98c"),
        }];

        assert!(verify_location_merkle_proof(root, &spec, &proof).unwrap());
    }

    #[test]
    fn modified_location_type_fails_merkle_proof() {
        let mut spec = test_enemy_location_spec();
        spec.kind = LocationKind::Treasure;
        let root = hex_32("10b2ef0d72461a03713b56bb782f0c5899a78233a68f2023ace1753d04f11b6e");
        let proof = vec![LocationMerkleProofStep {
            position: MerkleProofPosition::Right,
            sibling: hex_32("d011fbb83a5c8f4036b2cb73f2b95113924ff21a8504ac105f8a86fab9cdf98c"),
        }];

        assert!(!verify_location_merkle_proof(root, &spec, &proof).unwrap());
    }

    #[test]
    fn modified_location_position_fails_merkle_proof() {
        let mut spec = test_enemy_location_spec();
        spec.x += 1;
        let root = hex_32("10b2ef0d72461a03713b56bb782f0c5899a78233a68f2023ace1753d04f11b6e");
        let proof = vec![LocationMerkleProofStep {
            position: MerkleProofPosition::Right,
            sibling: hex_32("d011fbb83a5c8f4036b2cb73f2b95113924ff21a8504ac105f8a86fab9cdf98c"),
        }];

        assert!(!verify_location_merkle_proof(root, &spec, &proof).unwrap());
    }

    #[test]
    fn modified_location_config_hash_fails_merkle_proof() {
        let mut spec = test_enemy_location_spec();
        spec.base_config_hash = [0; 32];
        let root = hex_32("10b2ef0d72461a03713b56bb782f0c5899a78233a68f2023ace1753d04f11b6e");
        let proof = vec![LocationMerkleProofStep {
            position: MerkleProofPosition::Right,
            sibling: hex_32("d011fbb83a5c8f4036b2cb73f2b95113924ff21a8504ac105f8a86fab9cdf98c"),
        }];

        assert!(!verify_location_merkle_proof(root, &spec, &proof).unwrap());
    }

    #[test]
    fn rejects_clear_enemy_during_cooldown() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_enemy_location_account();
        let mut enemy = test_enemy_location();
        enemy.next_available_at = 1_600;
        let player_run = test_player_run();

        assert!(validate_clear_enemy(&dungeon, &location, &enemy, &player_run, 1_500).is_err());
    }

    #[test]
    fn clear_enemy_updates_counts_and_difficulty() {
        let mut enemy = test_enemy_location();
        let mut player_run = test_player_run();
        let previous_difficulty = enemy.difficulty_level;

        let outcome = apply_clear_enemy_state(
            &mut enemy,
            &mut player_run,
            &test_player_performance(),
            1_500,
        )
        .unwrap();

        assert_eq!(enemy.clear_count, 1);
        assert!(enemy.difficulty_level > previous_difficulty);
        assert_eq!(outcome.difficulty_level, enemy.difficulty_level);
        assert!(enemy.next_available_at > 1_500);
        assert_eq!(
            player_run.energy,
            DEFAULT_PLAYER_RUN_ENERGY - DEFAULT_ENEMY_CLEAR_ENERGY_COST
        );
        assert_eq!(player_run.cleared_locations, 1);
        assert_eq!(player_run.common_loot_count, 1);
        assert!(player_run.rare_eligibility_points > 0);
    }

    #[test]
    fn clear_enemy_after_cap_only_adds_common_marker() {
        let mut enemy = test_enemy_location();
        enemy.clear_count = DEFAULT_VALUABLE_CLEAR_CAP as u64 - 1;
        let mut player_run = test_player_run();

        let outcome = apply_clear_enemy_state(
            &mut enemy,
            &mut player_run,
            &test_player_performance(),
            1_500,
        )
        .unwrap();

        assert_eq!(enemy.clear_count, DEFAULT_VALUABLE_CLEAR_CAP as u64);
        assert_eq!(player_run.common_loot_count, 1);
        assert_eq!(outcome.rare_eligibility_points_awarded, 0);
        assert_eq!(player_run.rare_eligibility_points, 0);
    }

    fn test_dungeon(status: DungeonStatus, start_ts: i64, end_ts: i64) -> DailyDungeon {
        DailyDungeon {
            authority: Pubkey::default(),
            boss_count: 0,
            boss_hp: 50_000,
            boss_shard_count: 8,
            bump: 255,
            created_at: 900,
            day_id: "2026-04-25".to_string(),
            enemy_count: 0,
            end_ts,
            height: 80,
            location_count: 0,
            map_root: [1; 32],
            ruleset_hash: [2; 32],
            shop_count: 0,
            start_ts,
            status,
            treasure_count: 0,
            updated_at: 900,
            width: 100,
        }
    }

    fn test_enemy_location_account() -> LocationAccount {
        LocationAccount {
            base_config_hash: [3; 32],
            bump: 254,
            daily_dungeon: Pubkey::default(),
            day_id: "2026-04-25".to_string(),
            kind: LocationKind::Enemy,
            poi_id: "enemy-1".to_string(),
            status: LocationStatus::Available,
            x: 4,
            y: 7,
        }
    }

    fn test_enemy_location() -> EnemyLocation {
        EnemyLocation {
            base_cooldown_seconds: DEFAULT_ENEMY_BASE_COOLDOWN_SECONDS,
            base_damage: 10,
            base_hp: 100,
            clear_count: 0,
            day_id: "2026-04-25".to_string(),
            difficulty_level: 3,
            enemy_id: "enemy-cavern-scout".to_string(),
            level: 3,
            location: Pubkey::default(),
            max_reward_tier: RewardTier::Rare,
            name: "Cavern Scout".to_string(),
            next_available_at: 0,
            poi_id: "enemy-1".to_string(),
            valuable_clear_cap: DEFAULT_VALUABLE_CLEAR_CAP,
        }
    }

    fn test_player_run() -> PlayerRun {
        PlayerRun {
            active: true,
            boss_damage: 0,
            bump: 253,
            cleared_locations: 0,
            common_loot_count: 0,
            daily_dungeon: Pubkey::default(),
            day_id: "2026-04-25".to_string(),
            energy: DEFAULT_PLAYER_RUN_ENERGY,
            entered_at: 1_000,
            player: Pubkey::default(),
            rare_eligibility_points: 0,
        }
    }

    fn test_player_performance() -> PlayerPerformanceSummary {
        PlayerPerformanceSummary {
            damage_dealt: 100,
            damage_taken: 0,
            flawless: true,
            score: 2_500,
            turns_taken: 4,
        }
    }

    fn test_enemy_location_spec() -> LocationSpecInput {
        LocationSpecInput {
            base_config_hash: [0x11; 32],
            boss: None,
            day_id: "2026-04-25".to_string(),
            enemy: Some(EnemySpecInput {
                attack: 10,
                id: "enemy-cavern-scout".to_string(),
                level: 3,
                max_health: 100,
                name: "Cavern Scout".to_string(),
                reward_tier: RewardTier::Rare,
            }),
            event_id: None,
            kind: LocationKind::Enemy,
            poi_id: "enemy-1".to_string(),
            reward_tier: None,
            shop: None,
            x: 4,
            y: 7,
        }
    }

    fn hex_32(value: &str) -> [u8; 32] {
        assert_eq!(value.len(), 64);
        let mut bytes = [0_u8; 32];
        for index in 0..32 {
            bytes[index] = (hex_value(value.as_bytes()[index * 2]) << 4)
                | hex_value(value.as_bytes()[index * 2 + 1]);
        }
        bytes
    }

    fn hex_value(value: u8) -> u8 {
        match value {
            b'0'..=b'9' => value - b'0',
            b'a'..=b'f' => value - b'a' + 10,
            b'A'..=b'F' => value - b'A' + 10,
            _ => panic!("invalid hex character"),
        }
    }
}
