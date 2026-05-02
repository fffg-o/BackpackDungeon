use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

declare_id!("Hj9xusyzfxP8ic9U6rmpGcY4pPGFBJQqm7BUJ4w475jU");

pub const DAILY_DUNGEON_SEED: &[u8] = b"dungeon";

/// Settlement period in seconds (2 hours at the end of each 24h cycle).
/// During this window the dungeon is closed for gameplay and players can
/// mint settlement NFTs.
pub const SETTLEMENT_DURATION_SECONDS: i64 = 7_200; // 2 hours
pub const LOCATION_SEED: &[u8] = b"location";
pub const ENEMY_LOCATION_SEED: &[u8] = b"enemy";
pub const SHOP_SEED: &[u8] = b"shop";
pub const BOSS_LOCATION_SEED: &[u8] = b"boss";
pub const PLAYER_RUN_SEED: &[u8] = b"run";
pub const BOSS_SHARD_SEED: &[u8] = b"boss_shard";
pub const BOSS_CONTRIBUTION_SEED: &[u8] = b"boss_contribution";
pub const SHOP_ITEM_SLOT_SEED: &[u8] = b"shop_slot";
pub const DAILY_REWARD_CLAIM_SEED: &[u8] = b"daily_claim";
pub const BOSS_NFT_CLAIM_SEED: &[u8] = b"boss_nft_claim";

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
pub const DEFAULT_RARE_ELIGIBILITY_POINTS_PER_CLEAR: u32 = 1;
pub const MAX_MERKLE_PROOF_LEN: usize = 32;
pub const MAX_BOSS_DAMAGE_PER_SUBMISSION: u64 = 10_000;
pub const MAX_BOSS_SUBMISSIONS_PER_PLAYER: u16 = 10;
pub const MINIMUM_BOSS_DAMAGE: u64 = 1;

/// Basis points denominator (100% = 10_000 bps).
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Price increase per restock event (1200 bps = 12%).
pub const DEFAULT_RESTOCK_PRICE_INCREASE_BPS: u64 = 1_200;
/// Price increase per item sold (400 bps = 4%).
pub const DEFAULT_SOLD_PRICE_INCREASE_BPS: u64 = 400;
/// Player inventory counters added on purchase.
pub const DEFAULT_ITEMS_PURCHASED_PER_BUY: u32 = 1;

pub const DAILY_DUNGEON_SPACE: usize = 8 + DailyDungeon::INIT_SPACE;
pub const LOCATION_ACCOUNT_SPACE: usize = 8 + LocationAccount::INIT_SPACE;
pub const ENEMY_LOCATION_SPACE: usize = 8 + EnemyLocation::INIT_SPACE;
pub const SHOP_ACCOUNT_SPACE: usize = 8 + ShopAccount::INIT_SPACE;
pub const BOSS_LOCATION_SPACE: usize = 8 + BossLocation::INIT_SPACE;
pub const SHOP_ITEM_SLOT_ACCOUNT_SPACE: usize = 8 + ShopItemSlotAccount::INIT_SPACE;
pub const PLAYER_RUN_SPACE: usize = 8 + PlayerRun::INIT_SPACE;
pub const BOSS_DAMAGE_SHARD_SPACE: usize = 8 + BossDamageShard::INIT_SPACE;
pub const PLAYER_BOSS_CONTRIBUTION_SPACE: usize = 8 + PlayerBossContribution::INIT_SPACE;
pub const REWARD_POOL_SPACE: usize = 8 + RewardPool::INIT_SPACE;
pub const DAILY_REWARD_CLAIM_SPACE: usize = 8 + DailyRewardClaim::INIT_SPACE;
pub const BOSS_NFT_CLAIM_SPACE: usize = 8 + BossNftClaim::INIT_SPACE;

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
        location.poi_id_hash = spec.poi_id_hash;
        location.kind = spec.kind;
        location.status = LocationStatus::Available;
        location.x = spec.x;
        location.y = spec.y;
        location.base_config_hash = spec.base_config_hash;
        location.bump = ctx.bumps.location_account;

        // NOTE: Detail sub-accounts (EnemyLocation, ShopAccount, BossLocation)
        // are initialized in separate instructions (init_enemy_detail,
        // init_shop_detail, init_boss_detail) to work around an Anchor v0.32.1
        // bug where Option<Account> with init constraints uses Pubkey::default()
        // instead of the declare_id! program ID for PDA derivation.
        match spec.kind {
            LocationKind::Enemy | LocationKind::Shop | LocationKind::Boss => {
                // Location account is created; detail account is handled by
                // the corresponding init_*_detail instruction which also
                // increments the daily_dungeon counter for this kind.
            }
            LocationKind::Treasure => {
                ctx.accounts.daily_dungeon.treasure_count =
                    ctx.accounts.daily_dungeon.treasure_count.saturating_add(1);
            }
            LocationKind::Event => {
                // No additional state needed for event locations.
            }
        }

        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.daily_dungeon.location_count =
            ctx.accounts.daily_dungeon.location_count.saturating_add(1);
        ctx.accounts.daily_dungeon.updated_at = now;

        Ok(())
    }

    /// Initialise the EnemyLocation detail sub-account for an Enemy POI.
    ///
    /// Must be called after `init_location_from_merkle` for each Enemy location.
    /// This is a separate instruction (not combined with `init_location_from_merkle`)
    /// to work around an Anchor v0.32.1 bug where `Option<Account>` with `init`
    /// constraints incorrectly uses `Pubkey::default()` (SystemProgram) instead of
    /// the `declare_id!()` program ID for PDA derivation.
    pub fn init_enemy_detail(
        ctx: Context<InitEnemyDetail>,
        day_id: String,
        poi_id: String,
        poi_id_hash: [u8; 32],
        spec: LocationSpecInput,
    ) -> Result<()> {
        let enemy = spec
            .enemy
            .as_ref()
            .ok_or(error!(PackrunError::MissingLocationDetail))?;

        // Manually create PDA via CPI to bypass Anchor v0.32.1 init+seeds bug
        let bump = create_pda_account(
            &ctx.accounts.authority,
            &ctx.accounts.enemy_location,
            &ctx.accounts.system_program,
            ENEMY_LOCATION_SEED,
            &day_id,
            &poi_id_hash,
            ENEMY_LOCATION_SPACE,
            &crate::ID,
        )?;

        let enemy_location = EnemyLocation {
            location: ctx.accounts.location_account.key(),
            day_id,
            poi_id,
            enemy_id: enemy.id.clone(),
            name: enemy.name.clone(),
            level: enemy.level,
            base_hp: enemy.max_health,
            base_damage: enemy.attack,
            difficulty_level: enemy.level,
            max_reward_tier: enemy.reward_tier,
            valuable_clear_cap: DEFAULT_VALUABLE_CLEAR_CAP,
            clear_count: 0,
            base_cooldown_seconds: DEFAULT_ENEMY_BASE_COOLDOWN_SECONDS,
            next_available_at: 0,
            bump,
        };

        // Serialize account data (discriminator + borsh fields)
        let data = &mut ctx.accounts.enemy_location.data;
        let mut slice: &mut [u8] = &mut *data.borrow_mut();
        enemy_location.try_serialize(&mut slice)?;

        ctx.accounts.daily_dungeon.enemy_count =
            ctx.accounts.daily_dungeon.enemy_count.saturating_add(1);

        Ok(())
    }

    /// Initialise the ShopAccount detail sub-account for a Shop POI.
    ///
    /// Must be called after `init_location_from_merkle` for each Shop location.
    pub fn init_shop_detail(
        ctx: Context<InitShopDetail>,
        day_id: String,
        poi_id: String,
        poi_id_hash: [u8; 32],
        spec: LocationSpecInput,
    ) -> Result<()> {
        let shop = spec
            .shop
            .as_ref()
            .ok_or(error!(PackrunError::MissingLocationDetail))?;

        // Manually create PDA via CPI to bypass Anchor v0.32.1 init+seeds bug
        let bump = create_pda_account(
            &ctx.accounts.authority,
            &ctx.accounts.shop_account,
            &ctx.accounts.system_program,
            SHOP_SEED,
            &day_id,
            &poi_id_hash,
            SHOP_ACCOUNT_SPACE,
            &crate::ID,
        )?;

        let shop_account = ShopAccount {
            location: ctx.accounts.location_account.key(),
            day_id,
            poi_id,
            keeper_name: shop.keeper_name.clone().unwrap_or_default(),
            slot_count: shop.item_slots.len() as u16,
            opened_at: Clock::get()?.unix_timestamp,
            bump,
        };

        // Serialize account data (discriminator + borsh fields)
        let data = &mut ctx.accounts.shop_account.data;
        let mut slice: &mut [u8] = &mut *data.borrow_mut();
        shop_account.try_serialize(&mut slice)?;

        ctx.accounts.daily_dungeon.shop_count =
            ctx.accounts.daily_dungeon.shop_count.saturating_add(1);

        Ok(())
    }

    /// Initialise the BossLocation detail sub-account for a Boss POI.
    ///
    /// Must be called after `init_location_from_merkle` for each Boss location.
    pub fn init_boss_detail(
        ctx: Context<InitBossDetail>,
        day_id: String,
        poi_id: String,
        poi_id_hash: [u8; 32],
        spec: LocationSpecInput,
    ) -> Result<()> {
        let boss = spec
            .boss
            .as_ref()
            .ok_or(error!(PackrunError::MissingLocationDetail))?;

        // Manually create PDA via CPI to bypass Anchor v0.32.1 init+seeds bug
        let bump = create_pda_account(
            &ctx.accounts.authority,
            &ctx.accounts.boss_location,
            &ctx.accounts.system_program,
            BOSS_LOCATION_SEED,
            &day_id,
            &poi_id_hash,
            BOSS_LOCATION_SPACE,
            &crate::ID,
        )?;

        let boss_location = BossLocation {
            location: ctx.accounts.location_account.key(),
            day_id,
            poi_id,
            boss_id: boss.id.clone(),
            name: boss.name.clone(),
            level: boss.level,
            base_hp: boss.max_health,
            base_damage: boss.attack,
            reward_tier: boss.reward_tier,
            bump,
        };

        // Serialize account data (discriminator + borsh fields)
        let data = &mut ctx.accounts.boss_location.data;
        let mut slice: &mut [u8] = &mut *data.borrow_mut();
        boss_location.try_serialize(&mut slice)?;

        ctx.accounts.daily_dungeon.boss_count =
            ctx.accounts.daily_dungeon.boss_count.saturating_add(1);

        Ok(())
    }

    pub fn init_shop_item_slot(
        ctx: Context<InitShopItemSlot>,
        day_id: String,
        poi_id: String,
        poi_id_hash: [u8; 32],
        slot_index: u16,
        slot: ShopItemSlotSpecInput,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_init_shop_item_slot(
            &ctx.accounts.daily_dungeon,
            &ctx.accounts.location_account,
            &ctx.accounts.shop_account,
            ctx.accounts.location_account.key(),
            &day_id,
            &poi_id,
            poi_id_hash,
            slot_index,
            &slot,
            now,
        )?;

        let shop_item_slot = &mut ctx.accounts.shop_item_slot;
        shop_item_slot.shop = ctx.accounts.shop_account.key();
        shop_item_slot.day_id = day_id;
        shop_item_slot.poi_id = poi_id;
        shop_item_slot.poi_id_hash = poi_id_hash;
        shop_item_slot.slot_index = slot_index;
        shop_item_slot.item_id = slot.item_id;
        shop_item_slot.reward_tier = slot.reward_tier;
        shop_item_slot.base_price = slot.price;
        shop_item_slot.base_stock = slot.base_stock;
        shop_item_slot.max_stock = slot.max_stock;
        shop_item_slot.sold_count = 0;
        shop_item_slot.restock_interval_seconds = slot.restock_interval_seconds;
        shop_item_slot.max_restock_count = slot.max_restock_count;
        shop_item_slot.per_wallet_daily_limit = slot.per_wallet_daily_limit;
        shop_item_slot.opened_at = now;
        shop_item_slot.bump = ctx.bumps.shop_item_slot;

        Ok(())
    }

    pub fn init_boss_damage_shard(
        ctx: Context<InitBossDamageShard>,
        day_id: String,
        boss_poi_hash: [u8; 32],
        shard_index: u16,
    ) -> Result<()> {
        require!(
            ctx.accounts.daily_dungeon.day_id == day_id,
            PackrunError::InvalidBossDamageShard
        );
        require!(
            ctx.accounts.location_account.poi_id_hash == boss_poi_hash,
            PackrunError::InvalidBossDamageShard
        );
        require!(
            shard_index < ctx.accounts.daily_dungeon.boss_shard_count,
            PackrunError::InvalidBossDamageShard
        );

        let shard = &mut ctx.accounts.boss_damage_shard;
        shard.day_id = day_id;
        shard.boss_location = ctx.accounts.boss_location.key();
        shard.shard_index = shard_index;
        shard.total_damage = 0;
        shard.participant_count = 0;
        shard.bump = ctx.bumps.boss_damage_shard;

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

        // In the MVP, battle_result_hash, proof_uri_hash, and the performance
        // summary are self-reported. They stay as replay/UI hints; reward
        // eligibility is computed only from on-chain clear state.
        let _ = player_performance_summary;
        let outcome = apply_clear_enemy_state(
            &mut ctx.accounts.enemy_location,
            &mut ctx.accounts.player_run,
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

    pub fn buy_item(
        ctx: Context<BuyItem>,
        slot_index: u16,
        expected_price: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_buy_item(
            &ctx.accounts.daily_dungeon,
            &ctx.accounts.location_account,
            ctx.accounts.shop_account.key(),
            &ctx.accounts.shop_item_slot,
            &ctx.accounts.player_run,
            slot_index,
            expected_price,
            now,
        )?;

        apply_buy_item_state(
            &mut ctx.accounts.shop_item_slot,
            &mut ctx.accounts.player_run,
            now,
        )?;

        emit!(ItemPurchased {
            day_id: ctx.accounts.daily_dungeon.day_id.clone(),
            player: ctx.accounts.player.key(),
            location: ctx.accounts.location_account.key(),
            shop: ctx.accounts.shop_account.key(),
            shop_item_slot: ctx.accounts.shop_item_slot.key(),
            slot_index,
            poi_id: ctx.accounts.location_account.poi_id.clone(),
            item_id: ctx.accounts.shop_item_slot.item_id.clone(),
            price: expected_price,
            sold_count: ctx.accounts.shop_item_slot.sold_count,
            player_item_count: ctx.accounts.player_run.items_purchased,
        });

        Ok(())
    }

    pub fn submit_boss_damage(
        ctx: Context<SubmitBossDamage>,
        damage_score: u64,
        boss_battle_hash: [u8; 32],
        shard_index: u16,
        proof_uri_hash: Option<[u8; 32]>,
    ) -> Result<()> {
        let _ = shard_index;
        let now = Clock::get()?.unix_timestamp;
        validate_submit_boss_damage(
            &ctx.accounts.daily_dungeon,
            &ctx.accounts.location_account,
            &ctx.accounts.player_run,
            &ctx.accounts.boss_damage_shard,
            &ctx.accounts.player_boss_contribution,
            ctx.accounts.player.key(),
            ctx.accounts.boss_location.key(),
            ctx.accounts.daily_dungeon.boss_shard_count,
            damage_score,
            now,
        )?;

        apply_submit_boss_damage(
            &mut ctx.accounts.boss_damage_shard,
            &mut ctx.accounts.player_boss_contribution,
            &mut ctx.accounts.player_run,
            damage_score,
            now,
            ctx.bumps.player_boss_contribution,
        )?;

        emit!(BossDamageSubmitted {
            day_id: ctx.accounts.daily_dungeon.day_id.clone(),
            player: ctx.accounts.player.key(),
            boss_location: ctx.accounts.boss_location.key(),
            shard_index: ctx.accounts.boss_damage_shard.shard_index,
            damage_score,
            boss_battle_hash,
            proof_uri_hash,
            total_damage: ctx.accounts.boss_damage_shard.total_damage,
            participant_count: ctx.accounts.boss_damage_shard.participant_count,
            player_total_damage: ctx.accounts.player_boss_contribution.total_damage,
        });

        Ok(())
    }

    pub fn claim_boss_participation_nft(ctx: Context<ClaimBossParticipationNft>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_claim_boss_participation_nft(
            &ctx.accounts.daily_dungeon,
            ctx.accounts.boss_location.key(),
            &ctx.accounts.player_boss_contribution,
            &ctx.accounts.boss_nft_claim,
            ctx.accounts.player.key(),
        )?;

        apply_claim_boss_participation_nft(
            &mut ctx.accounts.boss_nft_claim,
            &ctx.accounts.daily_dungeon,
            ctx.accounts.boss_location.key(),
            &ctx.accounts.player_boss_contribution,
            ctx.accounts.player.key(),
            now,
        )?;

        emit!(BossNftClaimed {
            day_id: ctx.accounts.daily_dungeon.day_id.clone(),
            boss_id: ctx.accounts.boss_location.boss_id.clone(),
            player: ctx.accounts.player.key(),
            player_damage: ctx.accounts.player_boss_contribution.total_damage,
            shard_index: ctx.accounts.player_boss_contribution.shard_index,
            total_damage_snapshot: ctx.accounts.boss_damage_shard.total_damage,
            boss_location: ctx.accounts.boss_location.key(),
        });

        Ok(())
    }

    pub fn claim_daily_reward(ctx: Context<ClaimDailyReward>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_claim_daily_reward(
            &ctx.accounts.daily_dungeon,
            &ctx.accounts.player_run,
            &ctx.accounts.daily_reward_claim,
            ctx.accounts.player.key(),
            ctx.accounts.daily_dungeon.key(),
        )?;

        let reward_tier = compute_daily_reward_tier(
            &ctx.accounts.daily_dungeon,
            &ctx.accounts.player_run,
        )?;

        apply_claim_daily_reward(
            &mut ctx.accounts.daily_reward_claim,
            &ctx.accounts.daily_dungeon,
            reward_tier,
            ctx.accounts.player.key(),
            now,
        )?;

        emit!(DailyRewardClaimed {
            day_id: ctx.accounts.daily_dungeon.day_id.clone(),
            player: ctx.accounts.player.key(),
            reward_tier,
            cleared_locations: ctx.accounts.player_run.cleared_locations,
            boss_damage: ctx.accounts.player_run.boss_damage,
            claimed_at: now,
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
        seeds = [LOCATION_SEED, spec.day_id.as_bytes(), spec.poi_id_hash.as_ref()],
        bump
    )]
    pub location_account: Account<'info, LocationAccount>,
    pub system_program: Program<'info, System>,
}

/// Helper: manually create a PDA account via system program CPI.
/// Bypasses Anchor's `#[account(init, seeds, bump)]` macro which in v0.32.1
/// sometimes uses `Pubkey::default()` instead of `declare_id!()` for PDA derivation.
fn create_pda_account<'info>(
    authority: &Signer<'info>,
    target: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    seed_prefix: &[u8],
    day_id: &str,
    poi_id_hash: &[u8; 32],
    space: usize,
    program_id: &Pubkey,
) -> Result<u8> {
    let day_id_bytes = day_id.as_bytes();
    let seeds: &[&[u8]] = &[seed_prefix, day_id_bytes, poi_id_hash.as_ref()];
    let (pda, bump) = Pubkey::find_program_address(seeds, program_id);
    require_eq!(pda, target.key(), PackrunError::InvalidEnemyLocation);

    let lamports = Rent::get()?.minimum_balance(space);
    let account_size = space as u64;
    let bump_seed = [bump];
    let signer_seeds: &[&[&[u8]]] =
        &[&[seed_prefix, day_id_bytes, poi_id_hash.as_ref(), &bump_seed]];

    anchor_lang::system_program::create_account(
        CpiContext::new(
            system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: authority.to_account_info(),
                to: target.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        lamports,
        account_size,
        program_id,
    )?;

    Ok(bump)
}

#[derive(Accounts)]
#[instruction(day_id: String, poi_id: String, poi_id_hash: [u8; 32])]
pub struct InitEnemyDetail<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [DAILY_DUNGEON_SEED, day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        seeds = [LOCATION_SEED, day_id.as_bytes(), poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount,
        constraint = location_account.day_id == day_id @ PackrunError::InvalidLocationAccount,
        constraint = location_account.poi_id_hash == poi_id_hash @ PackrunError::InvalidLocationAccount,
        constraint = location_account.kind == LocationKind::Enemy @ PackrunError::LocationIsNotEnemy
    )]
    pub location_account: Account<'info, LocationAccount>,
    /// CHECK: initialised manually via CPI to system program in the processor
    #[account(mut)]
    pub enemy_location: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day_id: String, poi_id: String, poi_id_hash: [u8; 32])]
pub struct InitShopDetail<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [DAILY_DUNGEON_SEED, day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        seeds = [LOCATION_SEED, day_id.as_bytes(), poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount,
        constraint = location_account.day_id == day_id @ PackrunError::InvalidLocationAccount,
        constraint = location_account.poi_id_hash == poi_id_hash @ PackrunError::InvalidLocationAccount,
        constraint = location_account.kind == LocationKind::Shop @ PackrunError::LocationIsNotShop
    )]
    pub location_account: Account<'info, LocationAccount>,
    /// CHECK: initialised manually via CPI to system program in the processor
    #[account(mut)]
    pub shop_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day_id: String, poi_id: String, poi_id_hash: [u8; 32])]
pub struct InitBossDetail<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [DAILY_DUNGEON_SEED, day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        seeds = [LOCATION_SEED, day_id.as_bytes(), poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount,
        constraint = location_account.day_id == day_id @ PackrunError::InvalidLocationAccount,
        constraint = location_account.poi_id_hash == poi_id_hash @ PackrunError::InvalidLocationAccount,
        constraint = location_account.kind == LocationKind::Boss @ PackrunError::LocationIsNotBoss
    )]
    pub location_account: Account<'info, LocationAccount>,
    /// CHECK: initialised manually via CPI to system program in the processor
    #[account(mut)]
    pub boss_location: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    day_id: String,
    poi_id: String,
    poi_id_hash: [u8; 32],
    slot_index: u16,
    slot: ShopItemSlotSpecInput
)]
pub struct InitShopItemSlot<'info> {
    #[account(
        seeds = [DAILY_DUNGEON_SEED, day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        seeds = [LOCATION_SEED, day_id.as_bytes(), poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount,
        constraint = location_account.day_id == day_id @ PackrunError::InvalidLocationAccount,
        constraint = location_account.poi_id == poi_id @ PackrunError::InvalidLocationAccount,
        constraint = location_account.poi_id_hash == poi_id_hash @ PackrunError::InvalidLocationAccount
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(
        seeds = [SHOP_SEED, day_id.as_bytes(), poi_id_hash.as_ref()],
        bump = shop_account.bump,
        constraint = shop_account.location == location_account.key() @ PackrunError::InvalidShopAccount,
        constraint = shop_account.day_id == day_id @ PackrunError::InvalidShopAccount,
        constraint = shop_account.poi_id == poi_id @ PackrunError::InvalidShopAccount
    )]
    pub shop_account: Account<'info, ShopAccount>,
    #[account(
        init,
        payer = payer,
        space = SHOP_ITEM_SLOT_ACCOUNT_SPACE,
        seeds = [SHOP_ITEM_SLOT_SEED, day_id.as_bytes(), poi_id_hash.as_ref(), &slot_index.to_le_bytes()],
        bump
    )]
    pub shop_item_slot: Account<'info, ShopItemSlotAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day_id: String, boss_poi_hash: [u8; 32], shard_index: u16)]
pub struct InitBossDamageShard<'info> {
    #[account(
        seeds = [DAILY_DUNGEON_SEED, day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        seeds = [LOCATION_SEED, day_id.as_bytes(), boss_poi_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount,
        constraint = location_account.day_id == day_id @ PackrunError::InvalidLocationAccount,
        constraint = location_account.poi_id_hash == boss_poi_hash @ PackrunError::InvalidLocationAccount,
        constraint = location_account.kind == LocationKind::Boss @ PackrunError::LocationIsNotBoss
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(
        seeds = [BOSS_LOCATION_SEED, day_id.as_bytes(), boss_poi_hash.as_ref()],
        bump = boss_location.bump,
        constraint = boss_location.location == location_account.key() @ PackrunError::InvalidBossLocation,
        constraint = boss_location.day_id == day_id @ PackrunError::InvalidBossLocation,
        constraint = boss_location.poi_id == location_account.poi_id @ PackrunError::InvalidBossLocation
    )]
    pub boss_location: Account<'info, BossLocation>,
    #[account(
        init,
        payer = payer,
        space = BOSS_DAMAGE_SHARD_SPACE,
        seeds = [BOSS_SHARD_SEED, day_id.as_bytes(), &shard_index.to_le_bytes()],
        bump
    )]
    pub boss_damage_shard: Account<'info, BossDamageShard>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
        seeds = [LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(
        mut,
        seeds = [ENEMY_LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = enemy_location.bump,
        constraint = enemy_location.location == location_account.key() @ PackrunError::InvalidEnemyLocation,
        constraint = enemy_location.day_id == daily_dungeon.day_id @ PackrunError::InvalidEnemyLocation,
        constraint = enemy_location.poi_id == location_account.poi_id @ PackrunError::InvalidEnemyLocation
    )]
    pub enemy_location: Account<'info, EnemyLocation>,
}

#[derive(Accounts)]
#[instruction(slot_index: u16, expected_price: u64)]
pub struct BuyItem<'info> {
    pub player: Signer<'info>,
    #[account(
        seeds = [DAILY_DUNGEON_SEED, daily_dungeon.day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Box<Account<'info, DailyDungeon>>,
    #[account(
        mut,
        seeds = [PLAYER_RUN_SEED, daily_dungeon.day_id.as_bytes(), player.key().as_ref()],
        bump = player_run.bump,
        constraint = player_run.player == player.key() @ PackrunError::InvalidPlayerRun,
        constraint = player_run.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidPlayerRun
    )]
    pub player_run: Box<Account<'info, PlayerRun>>,
    #[account(
        seeds = [LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount
    )]
    pub location_account: Box<Account<'info, LocationAccount>>,
    #[account(
        seeds = [SHOP_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = shop_account.bump,
        constraint = shop_account.location == location_account.key() @ PackrunError::InvalidShopAccount,
        constraint = shop_account.day_id == daily_dungeon.day_id @ PackrunError::InvalidShopAccount,
        constraint = shop_account.poi_id == location_account.poi_id @ PackrunError::InvalidShopAccount
    )]
    pub shop_account: Box<Account<'info, ShopAccount>>,
    #[account(
        mut,
        seeds = [SHOP_ITEM_SLOT_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref(), &slot_index.to_le_bytes()],
        bump = shop_item_slot.bump,
        constraint = shop_item_slot.shop == shop_account.key() @ PackrunError::InvalidShopItemSlot,
        constraint = shop_item_slot.day_id == daily_dungeon.day_id @ PackrunError::InvalidShopItemSlot,
        constraint = shop_item_slot.poi_id == location_account.poi_id @ PackrunError::InvalidShopItemSlot,
        constraint = shop_item_slot.poi_id_hash == location_account.poi_id_hash @ PackrunError::InvalidShopItemSlot,
        constraint = shop_item_slot.slot_index == slot_index @ PackrunError::InvalidShopItemSlot
    )]
    pub shop_item_slot: Box<Account<'info, ShopItemSlotAccount>>,
}

#[derive(Accounts)]
#[instruction(damage_score: u64, boss_battle_hash: [u8; 32], shard_index: u16)]
pub struct SubmitBossDamage<'info> {
    #[account(mut)]
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
        seeds = [LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(
        seeds = [BOSS_LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = boss_location.bump,
        constraint = boss_location.location == location_account.key() @ PackrunError::InvalidEnemyLocation,
        constraint = boss_location.day_id == daily_dungeon.day_id @ PackrunError::InvalidEnemyLocation,
        constraint = boss_location.poi_id == location_account.poi_id @ PackrunError::InvalidEnemyLocation
    )]
    pub boss_location: Account<'info, BossLocation>,
    /// The shard_index is derived from the instruction data, not from the account seed.
    /// We verify it matches: shard_index == hash(player_pubkey) % boss_shard_count.
    #[account(
        mut,
        seeds = [BOSS_SHARD_SEED, daily_dungeon.day_id.as_bytes(), &shard_index.to_le_bytes()],
        bump = boss_damage_shard.bump,
        constraint = boss_damage_shard.day_id == daily_dungeon.day_id @ PackrunError::InvalidBossDamageShard,
        constraint = boss_damage_shard.boss_location == boss_location.key() @ PackrunError::InvalidBossDamageShard,
        constraint = boss_damage_shard.shard_index == shard_index @ PackrunError::InvalidBossDamageShard
    )]
    pub boss_damage_shard: Account<'info, BossDamageShard>,
    #[account(
        init_if_needed,
        payer = player,
        space = PLAYER_BOSS_CONTRIBUTION_SPACE,
        seeds = [BOSS_CONTRIBUTION_SEED, daily_dungeon.day_id.as_bytes(), player.key().as_ref()],
        bump
    )]
    pub player_boss_contribution: Account<'info, PlayerBossContribution>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimBossParticipationNft<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        seeds = [DAILY_DUNGEON_SEED, daily_dungeon.day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        seeds = [BOSS_LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = boss_location.bump,
        constraint = boss_location.day_id == daily_dungeon.day_id @ PackrunError::InvalidBossLocation,
        constraint = boss_location.location == location_account.key() @ PackrunError::InvalidBossLocation
    )]
    pub boss_location: Account<'info, BossLocation>,
    #[account(
        seeds = [LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount,
        constraint = location_account.kind == LocationKind::Boss @ PackrunError::LocationIsNotBoss
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(
        mut,
        seeds = [BOSS_CONTRIBUTION_SEED, daily_dungeon.day_id.as_bytes(), player.key().as_ref()],
        bump = player_boss_contribution.bump,
        constraint = player_boss_contribution.player == player.key() @ PackrunError::InvalidBossContribution,
        constraint = player_boss_contribution.day_id == daily_dungeon.day_id @ PackrunError::InvalidBossContribution,
        constraint = player_boss_contribution.boss_location == boss_location.key() @ PackrunError::InvalidBossContribution
    )]
    pub player_boss_contribution: Account<'info, PlayerBossContribution>,
    #[account(
        seeds = [BOSS_SHARD_SEED, daily_dungeon.day_id.as_bytes(), &player_boss_contribution.shard_index.to_le_bytes()],
        bump = boss_damage_shard.bump,
        constraint = boss_damage_shard.day_id == daily_dungeon.day_id @ PackrunError::InvalidBossDamageShard,
        constraint = boss_damage_shard.boss_location == boss_location.key() @ PackrunError::InvalidBossDamageShard
    )]
    pub boss_damage_shard: Account<'info, BossDamageShard>,
    #[account(
        init,
        payer = player,
        space = BOSS_NFT_CLAIM_SPACE,
        seeds = [BOSS_NFT_CLAIM_SEED, daily_dungeon.day_id.as_bytes(), player.key().as_ref()],
        bump
    )]
    pub boss_nft_claim: Account<'info, BossNftClaim>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimDailyReward<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        seeds = [DAILY_DUNGEON_SEED, daily_dungeon.day_id.as_bytes()],
        bump = daily_dungeon.bump
    )]
    pub daily_dungeon: Account<'info, DailyDungeon>,
    #[account(
        seeds = [PLAYER_RUN_SEED, daily_dungeon.day_id.as_bytes(), player.key().as_ref()],
        bump = player_run.bump,
        constraint = player_run.player == player.key() @ PackrunError::InvalidPlayerRun,
        constraint = player_run.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidPlayerRun
    )]
    pub player_run: Account<'info, PlayerRun>,
    #[account(
        seeds = [LOCATION_SEED, daily_dungeon.day_id.as_bytes(), location_account.poi_id_hash.as_ref()],
        bump = location_account.bump,
        constraint = location_account.daily_dungeon == daily_dungeon.key() @ PackrunError::InvalidLocationAccount,
        constraint = location_account.kind == LocationKind::Treasure @ PackrunError::LocationIsNotTreasure
    )]
    pub location_account: Account<'info, LocationAccount>,
    #[account(
        init_if_needed,
        payer = player,
        space = DAILY_REWARD_CLAIM_SPACE,
        seeds = [DAILY_REWARD_CLAIM_SEED, daily_dungeon.day_id.as_bytes(), player.key().as_ref(), location_account.poi_id_hash.as_ref()],
        bump
    )]
    pub daily_reward_claim: Account<'info, DailyRewardClaim>,
    pub system_program: Program<'info, System>,
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
    pub poi_id_hash: [u8; 32],
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
    pub base_stock: u16,
    pub max_stock: u16,
    pub restock_interval_seconds: i64,
    pub max_restock_count: u16,
    pub per_wallet_daily_limit: u16,
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

#[event]
pub struct ItemPurchased {
    pub day_id: String,
    pub player: Pubkey,
    pub location: Pubkey,
    pub shop: Pubkey,
    pub shop_item_slot: Pubkey,
    pub slot_index: u16,
    pub poi_id: String,
    pub item_id: String,
    pub price: u64,
    pub sold_count: u64,
    pub player_item_count: u32,
}

#[event]
pub struct BossDamageSubmitted {
    pub day_id: String,
    pub player: Pubkey,
    pub boss_location: Pubkey,
    pub shard_index: u16,
    pub damage_score: u64,
    pub boss_battle_hash: [u8; 32],
    pub proof_uri_hash: Option<[u8; 32]>,
    pub total_damage: u64,
    pub participant_count: u32,
    pub player_total_damage: u64,
}

#[event]
pub struct BossNftClaimed {
    pub day_id: String,
    pub boss_id: String,
    pub player: Pubkey,
    pub player_damage: u64,
    pub shard_index: u16,
    pub total_damage_snapshot: u64,
    pub boss_location: Pubkey,
}

#[event]
pub struct DailyRewardClaimed {
    pub day_id: String,
    pub player: Pubkey,
    pub reward_tier: RewardTier,
    pub cleared_locations: u32,
    pub boss_damage: u64,
    pub claimed_at: i64,
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

/// PDA: ["location", day_id, poi_id_hash]
#[account]
#[derive(InitSpace)]
pub struct LocationAccount {
    pub daily_dungeon: Pubkey,
    #[max_len(16)]
    pub day_id: String,
    #[max_len(64)]
    pub poi_id: String,
    pub poi_id_hash: [u8; 32],
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
    pub bump: u8,
}

/// PDA: ["shop", day_id, poi_id_hash]
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
    pub bump: u8,
}

/// PDA: ["boss", day_id, poi_id_hash]
#[account]
#[derive(InitSpace)]
pub struct BossLocation {
    pub location: Pubkey,
    #[max_len(16)]
    pub day_id: String,
    #[max_len(64)]
    pub poi_id: String,
    #[max_len(64)]
    pub boss_id: String,
    #[max_len(64)]
    pub name: String,
    pub level: u16,
    pub base_hp: u32,
    pub base_damage: u32,
    pub reward_tier: RewardTier,
    pub bump: u8,
}

/// PDA: ["shop_slot", day_id, poi_id_hash, slot_index]
#[account]
#[derive(InitSpace)]
pub struct ShopItemSlotAccount {
    pub shop: Pubkey,
    #[max_len(16)]
    pub day_id: String,
    #[max_len(64)]
    pub poi_id: String,
    pub poi_id_hash: [u8; 32],
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
    pub items_purchased: u32,
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
    pub participant_count: u32,
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

/// PDA: ["boss_nft_claim", day_id, player]
/// Tracks whether a player has claimed their Boss participation NFT for a given day.
#[account]
#[derive(InitSpace)]
pub struct BossNftClaim {
    #[max_len(16)]
    pub day_id: String,
    pub player: Pubkey,
    pub boss_location: Pubkey,
    pub player_damage: u64,
    pub shard_index: u16,
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
    // Only allow entering during the 22-hour open window (before settlement period)
    require!(
        now >= dungeon.start_ts && now < dungeon.end_ts - SETTLEMENT_DURATION_SECONDS,
        PackrunError::DungeonNotInOpenWindow
    );

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_init_shop_item_slot(
    dungeon: &DailyDungeon,
    location: &LocationAccount,
    shop: &ShopAccount,
    location_key: Pubkey,
    day_id: &str,
    poi_id: &str,
    poi_id_hash_value: [u8; 32],
    slot_index: u16,
    slot: &ShopItemSlotSpecInput,
    now: i64,
) -> Result<()> {
    require!(day_id.len() <= DAY_ID_MAX_LEN, PackrunError::DayIdTooLong);
    require!(poi_id.len() <= POI_ID_MAX_LEN, PackrunError::PoiIdTooLong);
    require!(
        poi_id_hash_value == poi_id_hash(poi_id),
        PackrunError::PoiIdHashMismatch
    );
    require!(dungeon.day_id == day_id, PackrunError::DungeonDayMismatch);
    require!(
        dungeon.status == DungeonStatus::Open,
        PackrunError::DungeonNotOpen
    );
    // Shop item slot initialization only during open window (before settlement)
    require!(
        now >= dungeon.start_ts && now < dungeon.end_ts - SETTLEMENT_DURATION_SECONDS,
        PackrunError::DungeonNotInOpenWindow
    );
    require!(
        location.day_id == day_id
            && location.poi_id == poi_id
            && location.poi_id_hash == poi_id_hash_value,
        PackrunError::InvalidLocationAccount
    );
    require!(
        location.kind == LocationKind::Shop,
        PackrunError::LocationIsNotShop
    );
    require!(
        shop.location == location_key && shop.day_id == day_id && shop.poi_id == poi_id,
        PackrunError::InvalidShopAccount
    );
    require!(
        slot_index < shop.slot_count,
        PackrunError::InvalidShopItemSlot
    );
    require!(
        slot.slot_id.len() <= POI_ID_MAX_LEN && slot.item_id.len() <= ITEM_ID_MAX_LEN,
        PackrunError::InvalidShopItemSlot
    );
    require!(slot.base_stock > 0, PackrunError::InvalidShopItemSlot);
    require!(
        slot.max_stock >= slot.base_stock,
        PackrunError::InvalidShopItemSlot
    );
    require!(
        slot.restock_interval_seconds > 0,
        PackrunError::InvalidShopItemSlot
    );
    require!(
        slot.per_wallet_daily_limit > 0 && slot.per_wallet_daily_limit <= slot.max_stock,
        PackrunError::InvalidShopItemSlot
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
    // Clear enemy only during open window (before settlement)
    require!(
        now >= dungeon.start_ts && now < dungeon.end_ts - SETTLEMENT_DURATION_SECONDS,
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

fn validate_buy_item(
    dungeon: &DailyDungeon,
    location: &LocationAccount,
    shop_key: Pubkey,
    slot: &ShopItemSlotAccount,
    player_run: &PlayerRun,
    slot_index: u16,
    expected_price: u64,
    now: i64,
) -> Result<()> {
    require!(
        dungeon.status == DungeonStatus::Open,
        PackrunError::DungeonNotOpen
    );
    // Buy item only during open window (before settlement)
    require!(
        now >= dungeon.start_ts && now < dungeon.end_ts - SETTLEMENT_DURATION_SECONDS,
        PackrunError::DungeonNotInOpenWindow
    );
    require!(player_run.active, PackrunError::PlayerRunNotActive);
    require!(
        location.kind == LocationKind::Shop,
        PackrunError::LocationIsNotShop
    );
    require!(
        slot.shop == shop_key
            && slot.day_id == dungeon.day_id
            && slot.poi_id == location.poi_id
            && slot.poi_id_hash == location.poi_id_hash
            && slot.slot_index == slot_index,
        PackrunError::InvalidShopItemSlot
    );

    // Compute current restock epoch and available stock
    let restock_epoch = compute_restock_epoch(slot.opened_at, now, slot.restock_interval_seconds)?;
    let available_stock = compute_available_stock(
        slot.base_stock,
        restock_epoch,
        slot.sold_count,
        slot.max_stock,
    )?;

    require!(available_stock > 0, PackrunError::InsufficientStock);

    // Compute expected price and verify match
    let computed_price = compute_shop_price(
        slot.base_price,
        restock_epoch,
        slot.sold_count,
    )?;
    require!(
        expected_price == computed_price,
        PackrunError::PriceMismatch
    );

    // Check per-wallet daily purchase limit
    if slot.per_wallet_daily_limit > 0 {
        require!(
            player_run.items_purchased < slot.per_wallet_daily_limit as u32,
            PackrunError::PurchaseLimitExceeded
        );
    }

    Ok(())
}

fn apply_buy_item_state(
    slot: &mut ShopItemSlotAccount,
    player_run: &mut PlayerRun,
    _now: i64,
) -> Result<()> {
    // Decrease stock (increase sold_count)
    slot.sold_count = slot
        .sold_count
        .checked_add(1)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;

    // Update player inventory counters
    player_run.items_purchased = player_run
        .items_purchased
        .checked_add(DEFAULT_ITEMS_PURCHASED_PER_BUY)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;

    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SubmitBossDamageOutcome {
    pub shard_total_damage: u64,
    pub participant_count: u32,
    pub player_total_damage: u64,
    pub is_first_participation: bool,
}

fn validate_submit_boss_damage(
    dungeon: &DailyDungeon,
    location: &LocationAccount,
    player_run: &PlayerRun,
    boss_damage_shard: &BossDamageShard,
    _player_boss_contribution: &PlayerBossContribution,
    player_pubkey: Pubkey,
    boss_location_key: Pubkey,
    boss_shard_count: u16,
    damage_score: u64,
    now: i64,
) -> Result<()> {
    require!(
        dungeon.status == DungeonStatus::Open,
        PackrunError::DungeonNotOpen
    );
    // Submit boss damage only during open window (before settlement)
    require!(
        now >= dungeon.start_ts && now < dungeon.end_ts - SETTLEMENT_DURATION_SECONDS,
        PackrunError::DungeonNotInOpenWindow
    );
    require!(player_run.active, PackrunError::PlayerRunNotActive);
    require!(
        location.kind == LocationKind::Boss,
        PackrunError::LocationIsNotBoss
    );
    require!(damage_score > 0, PackrunError::InvalidDamageScore);
    require!(
        damage_score <= MAX_BOSS_DAMAGE_PER_SUBMISSION,
        PackrunError::DamageScoreExceeded
    );

    // Verify shard_index matches hash(player_pubkey) % boss_shard_count
    let expected_shard_index = compute_boss_shard_index(player_pubkey, boss_shard_count);
    require!(
        boss_damage_shard.shard_index == expected_shard_index,
        PackrunError::ShardIndexMismatch
    );

    // Verify the shard belongs to this dungeon's boss
    require!(
        boss_damage_shard.day_id == dungeon.day_id
            && boss_damage_shard.boss_location == boss_location_key,
        PackrunError::InvalidBossDamageShard
    );

    // Check player has not exceeded boss submission limit.
    // Uses player_run.boss_damage as a proxy for number of submissions made.
    let estimated_submissions = player_run
        .boss_damage
        .checked_div(MAX_BOSS_DAMAGE_PER_SUBMISSION)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    require!(
        (estimated_submissions as u16) < MAX_BOSS_SUBMISSIONS_PER_PLAYER,
        PackrunError::BossSubmissionLimitExceeded
    );

    Ok(())
}

fn apply_submit_boss_damage(
    shard: &mut BossDamageShard,
    contribution: &mut PlayerBossContribution,
    player_run: &mut PlayerRun,
    damage_score: u64,
    now: i64,
    bump: u8,
) -> Result<SubmitBossDamageOutcome> {
    let is_first_participation = contribution.total_damage == 0;

    // Update shard
    shard.total_damage = shard
        .total_damage
        .checked_add(damage_score)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;

    if is_first_participation {
        shard.participant_count = shard
            .participant_count
            .checked_add(1)
            .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    }

    // Initialize contribution account fields on first participation
    if is_first_participation {
        contribution.day_id = player_run.day_id.clone();
        contribution.player = player_run.player;
        contribution.boss_location = shard.boss_location;
        contribution.shard_index = shard.shard_index;
        contribution.bump = bump;
    }

    contribution.total_damage = contribution
        .total_damage
        .checked_add(damage_score)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    contribution.last_hit_at = now;

    // Update player run
    player_run.boss_damage = player_run
        .boss_damage
        .checked_add(damage_score)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;

    Ok(SubmitBossDamageOutcome {
        shard_total_damage: shard.total_damage,
        participant_count: shard.participant_count,
        player_total_damage: contribution.total_damage,
        is_first_participation,
    })
}

fn validate_claim_boss_participation_nft(
    dungeon: &DailyDungeon,
    boss_location_key: Pubkey,
    contribution: &PlayerBossContribution,
    nft_claim: &BossNftClaim,
    player_pubkey: Pubkey,
) -> Result<()> {
    // Boss must be defeated (dungeon status allows claim after boss is beaten)
    require!(
        dungeon.status == DungeonStatus::Open || dungeon.status == DungeonStatus::Completed,
        PackrunError::DungeonNotOpen
    );

    // Player must have contributed at least MINIMUM_BOSS_DAMAGE
    require!(
        contribution.total_damage >= MINIMUM_BOSS_DAMAGE,
        PackrunError::InsufficientBossDamage
    );

    // Player must not have already claimed for this day
    require!(
        !nft_claim.claimed(),
        PackrunError::BossNftAlreadyClaimed
    );

    // Contribution must belong to this player
    require!(
        contribution.player == player_pubkey,
        PackrunError::InvalidBossContribution
    );

    // Contribution must match this boss
    require!(
        contribution.boss_location == boss_location_key,
        PackrunError::InvalidBossContribution
    );

    Ok(())
}

fn apply_claim_boss_participation_nft(
    nft_claim: &mut BossNftClaim,
    dungeon: &DailyDungeon,
    boss_location_key: Pubkey,
    contribution: &PlayerBossContribution,
    player_pubkey: Pubkey,
    now: i64,
) -> Result<()> {
    nft_claim.day_id = dungeon.day_id.clone();
    nft_claim.player = player_pubkey;
    nft_claim.boss_location = boss_location_key;
    nft_claim.player_damage = contribution.total_damage;
    nft_claim.shard_index = contribution.shard_index;
    nft_claim.claimed_at = now;

    Ok(())
}

impl BossNftClaim {
    /// Returns true if this claim account has been initialized (claimed).
    pub fn claimed(&self) -> bool {
        self.claimed_at != 0
    }
}

fn validate_claim_daily_reward(
    _dungeon: &DailyDungeon,
    player_run: &PlayerRun,
    daily_reward_claim: &DailyRewardClaim,
    player_pubkey: Pubkey,
    dungeon_key: Pubkey,
) -> Result<()> {
    // Immediate reward: claimable as soon as player has entered the dungeon.
    // No end_ts check needed – the settlement NFT mint will gate on end_ts.

    // Player must have an active run
    require!(player_run.active, PackrunError::PlayerRunNotActive);

    // Player must not have already claimed
    require!(
        !daily_reward_claim.claimed(),
        PackrunError::DailyRewardAlreadyClaimed
    );

    // Player run must belong to this player
    require!(
        player_run.player == player_pubkey,
        PackrunError::InvalidPlayerRun
    );

    // Player run must belong to this dungeon
    require!(
        player_run.daily_dungeon == dungeon_key,
        PackrunError::InvalidPlayerRun
    );

    Ok(())
}

/// Compute the reward tier a player qualifies for based on their run performance.
///
/// Tiers are evaluated from highest (Legendary) to lowest (Common).
/// If no tier is met, falls back to Common (entry reward — claimable immediately
/// upon entering the dungeon, even with 0 cleared locations).
fn compute_daily_reward_tier(
    dungeon: &DailyDungeon,
    player_run: &PlayerRun,
) -> Result<RewardTier> {
    let cleared = player_run.cleared_locations;
    let boss_damage = player_run.boss_damage;

    // Legendary: deterministic low-probability hash threshold.
    // Hash(day_id || player || boss_damage || cleared_locations) must have
    // the first 2 bytes (as u16) < LEGENDARY_THRESHOLD (out of u16::MAX).
    // This gives roughly a 1-in-256 chance (~0.39%) when threshold = 256.
    const LEGENDARY_THRESHOLD: u16 = 256;
    if cleared >= 12 && boss_damage >= 1500 {
        let hash_input = {
            let mut buf = Vec::with_capacity(
                dungeon.day_id.len() + 32 + 8 + 4,
            );
            buf.extend_from_slice(dungeon.day_id.as_bytes());
            buf.extend_from_slice(player_run.player.as_ref());
            buf.extend_from_slice(&boss_damage.to_le_bytes());
            buf.extend_from_slice(&cleared.to_le_bytes());
            buf
        };
        let hash_result = solana_sha256_hasher::hash(&hash_input);
        let threshold = u16::from_le_bytes([
            hash_result.to_bytes()[0],
            hash_result.to_bytes()[1],
        ]);
        if threshold < LEGENDARY_THRESHOLD {
            return Ok(RewardTier::Legendary);
        }
    }

    // Epic: cleared_locations >= 12 and boss_damage >= 1500
    if cleared >= 12 && boss_damage >= 1500 {
        return Ok(RewardTier::Epic);
    }

    // Rare: cleared_locations >= 8 and boss_damage >= 500
    if cleared >= 8 && boss_damage >= 500 {
        return Ok(RewardTier::Rare);
    }

    // Uncommon: cleared_locations >= 3
    if cleared >= 3 {
        return Ok(RewardTier::Uncommon);
    }

    // Common: any active player run (entry reward – claimable immediately
    // upon entering the dungeon, even with 0 cleared locations).
    Ok(RewardTier::Common)
}

fn apply_claim_daily_reward(
    daily_reward_claim: &mut DailyRewardClaim,
    dungeon: &DailyDungeon,
    reward_tier: RewardTier,
    player_pubkey: Pubkey,
    now: i64,
) -> Result<()> {
    daily_reward_claim.day_id = dungeon.day_id.clone();
    daily_reward_claim.player = player_pubkey;
    daily_reward_claim.reward_pool = Pubkey::default(); // No reward pool in MVP
    daily_reward_claim.reward_tier = reward_tier;
    daily_reward_claim.amount = 0; // No amount in MVP
    daily_reward_claim.claimed_at = now;

    Ok(())
}

impl DailyRewardClaim {
    /// Returns true if this claim account has been initialized (claimed).
    pub fn claimed(&self) -> bool {
        self.claimed_at != 0
    }
}

fn compute_boss_shard_index(player_pubkey: Pubkey, shard_count: u16) -> u16 {
    let hash = solana_sha256_hasher::hash(player_pubkey.as_ref());
    let hash_prefix = u16::from_le_bytes([hash.to_bytes()[0], hash.to_bytes()[1]]);
    hash_prefix % shard_count
}

fn compute_restock_epoch(opened_at: i64, current_time: i64, interval: i64) -> Result<u64> {
    if interval <= 0 {
        return Ok(0);
    }
    if current_time < opened_at {
        return Ok(0);
    }
    let elapsed = current_time
        .checked_sub(opened_at)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    if elapsed < 0 {
        return Ok(0);
    }
    let epoch = (elapsed as u64).checked_div(interval as u64)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    Ok(epoch)
}

fn compute_available_stock(
    base_stock: u16,
    restock_epoch: u64,
    sold_count: u64,
    max_stock: u16,
) -> Result<u64> {
    if base_stock == 0 || max_stock == 0 {
        return Ok(0);
    }
    let restock_size = base_stock as u64;
    let lifetime_supply = restock_size
        .checked_mul(restock_epoch.checked_add(1).ok_or(error!(PackrunError::ArithmeticOverflow))?)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    let unsold_supply = if sold_count >= lifetime_supply {
        0u64
    } else {
        lifetime_supply
            .checked_sub(sold_count)
            .ok_or(error!(PackrunError::ArithmeticOverflow))?
    };
    Ok(unsold_supply.min(max_stock as u64))
}

fn compute_shop_price(
    base_price: u64,
    restock_epoch: u64,
    sold_count: u64,
) -> Result<u64> {
    let restock_increase = (restock_epoch as u64)
        .checked_mul(DEFAULT_RESTOCK_PRICE_INCREASE_BPS)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    let sold_increase = sold_count
        .checked_mul(DEFAULT_SOLD_PRICE_INCREASE_BPS)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    let multiplier_bps = BPS_DENOMINATOR
        .checked_add(restock_increase)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?
        .checked_add(sold_increase)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    let price_numer = base_price
        .checked_mul(multiplier_bps)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    // Ceiling division: (numerator + denominator - 1) / denominator
    let price = price_numer
        .checked_add(BPS_DENOMINATOR.checked_sub(1).ok_or(error!(PackrunError::ArithmeticOverflow))?)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(error!(PackrunError::ArithmeticOverflow))?;
    Ok(price)
}

fn apply_clear_enemy_state(
    enemy: &mut EnemyLocation,
    player_run: &mut PlayerRun,
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

    let rare_eligibility_points_awarded =
        compute_rare_eligibility_points(enemy.clear_count, enemy.valuable_clear_cap);
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

fn compute_rare_eligibility_points(clear_count: u64, valuable_clear_cap: u16) -> u32 {
    if valuable_clear_cap == 0 || clear_count >= valuable_clear_cap as u64 {
        return 0;
    }

    DEFAULT_RARE_ELIGIBILITY_POINTS_PER_CLEAR
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
    require!(
        spec.poi_id_hash == poi_id_hash(&spec.poi_id),
        PackrunError::PoiIdHashMismatch
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
        json.push_str(&slot.base_stock.to_string());
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

fn poi_id_hash(poi_id: &str) -> [u8; 32] {
    hash(poi_id.as_bytes()).to_bytes()
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
    #[msg("poi_id_hash does not match poi_id.")]
    PoiIdHashMismatch,
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
    #[msg("location is not a shop.")]
    LocationIsNotShop,
    #[msg("shop account is invalid.")]
    InvalidShopAccount,
    #[msg("shop item slot configuration is invalid.")]
    InvalidShopItemSlot,
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
    #[msg("shop item slot has insufficient stock.")]
    InsufficientStock,
    #[msg("expected price does not match the computed price.")]
    PriceMismatch,
    #[msg("player has exceeded the per-wallet daily purchase limit for this item.")]
    PurchaseLimitExceeded,
    #[msg("damage_score must be greater than zero.")]
    InvalidDamageScore,
    #[msg("damage_score exceeds the maximum allowed per submission.")]
    DamageScoreExceeded,
    #[msg("shard_index does not match the player's assigned shard.")]
    ShardIndexMismatch,
    #[msg("player has exceeded the boss submission limit for this daily dungeon.")]
    BossSubmissionLimitExceeded,
    #[msg("location is not a boss location.")]
    LocationIsNotBoss,
    #[msg("boss damage shard account is invalid.")]
    InvalidBossDamageShard,
    #[msg("player boss contribution account is invalid.")]
    InvalidBossContribution,
    #[msg("boss location account is invalid.")]
    InvalidBossLocation,
    #[msg("player has not dealt enough damage to claim the boss NFT.")]
    InsufficientBossDamage,
    #[msg("player has already claimed the boss NFT for this daily dungeon.")]
    BossNftAlreadyClaimed,
    #[msg("daily dungeon has not ended yet.")]
    DungeonNotEnded,
    #[msg("player has already claimed the daily reward for this dungeon.")]
    DailyRewardAlreadyClaimed,
    #[msg("player run does not satisfy any reward tier condition.")]
    DailyRewardTierNotMet,
    #[msg("player run not found for this day and player.")]
    PlayerRunNotFound,
    #[msg("location is not a treasure.")]
    LocationIsNotTreasure,
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
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 10_000);

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
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 10_000);

        assert!(validate_enter_dungeon(&dungeon, "2026-04-25", 3_000).is_err());
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
    fn rejects_location_spec_with_mismatched_poi_id_hash() {
        let mut spec = test_enemy_location_spec();
        spec.poi_id_hash = [0; 32];

        assert!(validate_location_spec_input(&spec).is_err());
    }

    #[test]
    fn long_poi_id_location_pda_uses_hash_seed_within_seed_limits() {
        let mut spec = test_enemy_location_spec();
        spec.poi_id = "enemy-location-id-longer-than-32-bytes".to_string();
        spec.poi_id_hash = poi_id_hash(&spec.poi_id);
        let seeds: [&[u8]; 3] = [
            LOCATION_SEED,
            spec.day_id.as_bytes(),
            spec.poi_id_hash.as_ref(),
        ];

        assert!(spec.poi_id.as_bytes().len() > 32);
        assert!(validate_location_spec_input(&spec).is_ok());
        assert!(seeds.iter().all(|seed| seed.len() <= 32));
        let _ = Pubkey::find_program_address(&seeds, &crate::ID);
    }

    #[test]
    fn detail_account_pdas_use_hash_seed_within_seed_limits() {
        let mut spec = test_enemy_location_spec();
        spec.poi_id = "detail-location-id-longer-than-32-bytes".to_string();
        spec.poi_id_hash = poi_id_hash(&spec.poi_id);

        assert!(spec.poi_id.as_bytes().len() > 32);
        for detail_seed in [ENEMY_LOCATION_SEED, SHOP_SEED, BOSS_LOCATION_SEED] {
            let seeds: [&[u8]; 3] = [
                detail_seed,
                spec.day_id.as_bytes(),
                spec.poi_id_hash.as_ref(),
            ];
            assert!(seeds.iter().all(|seed| seed.len() <= 32));
            let _ = Pubkey::find_program_address(&seeds, &crate::ID);
        }
    }

    #[test]
    fn validates_init_shop_item_slot_input() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 10_000);
        let location = test_shop_location_account();
        let shop = test_shop_account(Pubkey::default());
        let slot = test_shop_item_slot_spec();

        assert!(validate_init_shop_item_slot(
            &dungeon,
            &location,
            &shop,
            Pubkey::default(),
            "2026-04-25",
            "shop-1",
            poi_id_hash("shop-1"),
            1,
            &slot,
            1_500,
        )
        .is_ok());
    }

    #[test]
    fn rejects_shop_item_slot_when_stock_config_is_invalid() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_shop_location_account();
        let shop = test_shop_account(Pubkey::default());
        let mut slot = test_shop_item_slot_spec();
        slot.base_stock = 0;

        assert!(validate_init_shop_item_slot(
            &dungeon,
            &location,
            &shop,
            Pubkey::default(),
            "2026-04-25",
            "shop-1",
            poi_id_hash("shop-1"),
            1,
            &slot,
            1_500,
        )
        .is_err());
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

        let outcome = apply_clear_enemy_state(&mut enemy, &mut player_run, 1_500).unwrap();

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
        assert_eq!(
            player_run.rare_eligibility_points,
            DEFAULT_RARE_ELIGIBILITY_POINTS_PER_CLEAR
        );
    }

    #[test]
    fn spoofed_high_score_does_not_exceed_low_risk_rare_cap() {
        let mut enemy = test_enemy_location();
        let mut player_run = test_player_run();
        let spoofed_performance = PlayerPerformanceSummary {
            damage_dealt: u32::MAX,
            damage_taken: 0,
            flawless: true,
            score: u32::MAX,
            turns_taken: 1,
        };

        let _ = spoofed_performance;
        let outcome = apply_clear_enemy_state(&mut enemy, &mut player_run, 1_500).unwrap();

        assert_eq!(
            outcome.rare_eligibility_points_awarded,
            DEFAULT_RARE_ELIGIBILITY_POINTS_PER_CLEAR
        );
        assert_eq!(
            player_run.rare_eligibility_points,
            DEFAULT_RARE_ELIGIBILITY_POINTS_PER_CLEAR
        );
    }

    #[test]
    fn clear_after_valuable_clear_cap_awards_zero_rare_eligibility() {
        let mut enemy = test_enemy_location();
        enemy.clear_count = DEFAULT_VALUABLE_CLEAR_CAP as u64 - 1;
        let mut player_run = test_player_run();

        let outcome = apply_clear_enemy_state(&mut enemy, &mut player_run, 1_500).unwrap();

        assert_eq!(enemy.clear_count, DEFAULT_VALUABLE_CLEAR_CAP as u64);
        assert_eq!(player_run.common_loot_count, 1);
        assert_eq!(outcome.rare_eligibility_points_awarded, 0);
        assert_eq!(player_run.rare_eligibility_points, 0);
    }

    // ── buy_item tests ──────────────────────────────────────────────────────

    #[test]
    fn buy_item_succeeds_with_valid_inputs() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 10_000);
        let location = test_shop_location_account();
        let shop_key = Pubkey::default();
        let slot = test_shop_item_slot_account();
        let player_run = test_player_run();
        // opened_at=1_000, now=1_500, interval=3_600 → restock_epoch=0
        // base_stock=3, sold_count=0, max_stock=5 → available=3
        // base_price=25, restock_epoch=0, sold_count=0 → price=25
        let price = compute_shop_price(25, 0, 0).unwrap();
        assert_eq!(price, 25);

        assert!(validate_buy_item(
            &dungeon, &location, shop_key, &slot, &player_run, 0, price, 1_500,
        )
        .is_ok());
    }

    #[test]
    fn buy_item_fails_when_dungeon_not_open() {
        let dungeon = test_dungeon(DungeonStatus::Pending, 1_000, 2_000);
        let location = test_shop_location_account();
        let shop_key = Pubkey::default();
        let slot = test_shop_item_slot_account();
        let player_run = test_player_run();

        assert!(validate_buy_item(
            &dungeon, &location, shop_key, &slot, &player_run, 0, 25, 1_500,
        )
        .is_err());
    }

    #[test]
    fn buy_item_fails_when_location_is_not_shop() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_enemy_location_account();
        let shop_key = Pubkey::default();
        let slot = test_shop_item_slot_account();
        let player_run = test_player_run();

        assert!(validate_buy_item(
            &dungeon, &location, shop_key, &slot, &player_run, 0, 25, 1_500,
        )
        .is_err());
    }

    #[test]
    fn buy_item_fails_when_player_run_not_active() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_shop_location_account();
        let shop_key = Pubkey::default();
        let slot = test_shop_item_slot_account();
        let mut player_run = test_player_run();
        player_run.active = false;

        assert!(validate_buy_item(
            &dungeon, &location, shop_key, &slot, &player_run, 0, 25, 1_500,
        )
        .is_err());
    }

    #[test]
    fn buy_item_fails_when_insufficient_stock() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_shop_location_account();
        let shop_key = Pubkey::default();
        // sold_count >= lifetime supply (base_stock=3, restock_epoch=0 → lifetime=3)
        let slot = test_shop_item_slot_account_with_sold(3);
        let player_run = test_player_run();

        assert!(validate_buy_item(
            &dungeon, &location, shop_key, &slot, &player_run, 0, 25, 1_500,
        )
        .is_err());
    }

    #[test]
    fn buy_item_fails_when_price_mismatch() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_shop_location_account();
        let shop_key = Pubkey::default();
        let slot = test_shop_item_slot_account();
        let player_run = test_player_run();

        // expected_price=99 but computed price=25
        assert!(validate_buy_item(
            &dungeon, &location, shop_key, &slot, &player_run, 0, 99, 1_500,
        )
        .is_err());
    }

    #[test]
    fn buy_item_fails_when_purchase_limit_exceeded() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_shop_location_account();
        let shop_key = Pubkey::default();
        let slot = test_shop_item_slot_account();
        let mut player_run = test_player_run();
        // per_wallet_daily_limit=2, so items_purchased=2 should fail
        player_run.items_purchased = 2;

        assert!(validate_buy_item(
            &dungeon, &location, shop_key, &slot, &player_run, 0, 25, 1_500,
        )
        .is_err());
    }

    #[test]
    fn buy_item_applies_state_correctly() {
        let mut slot = test_shop_item_slot_account();
        let mut player_run = test_player_run();
        let previous_sold = slot.sold_count;
        let previous_items = player_run.items_purchased;

        apply_buy_item_state(&mut slot, &mut player_run, 1_500).unwrap();

        assert_eq!(slot.sold_count, previous_sold + 1);
        assert_eq!(
            player_run.items_purchased,
            previous_items + DEFAULT_ITEMS_PURCHASED_PER_BUY
        );
    }

    #[test]
    fn compute_restock_epoch_returns_zero_before_opened() {
        assert_eq!(compute_restock_epoch(1_000, 500, 3_600).unwrap(), 0);
    }

    #[test]
    fn compute_restock_epoch_returns_zero_for_non_positive_interval() {
        assert_eq!(compute_restock_epoch(1_000, 1_500, 0).unwrap(), 0);
        assert_eq!(compute_restock_epoch(1_000, 1_500, -1).unwrap(), 0);
    }

    #[test]
    fn compute_restock_epoch_counts_elapsed_intervals() {
        // opened_at=1_000, now=1_500, interval=100 → elapsed=500 → epoch=5
        assert_eq!(compute_restock_epoch(1_000, 1_500, 100).unwrap(), 5);
    }

    #[test]
    fn compute_available_stock_returns_full_after_restock() {
        // base_stock=3, restock_epoch=1 (2 batches), sold=0, max_stock=5
        // lifetime=3*2=6, unsold=6, min(6,5)=5
        assert_eq!(compute_available_stock(3, 1, 0, 5).unwrap(), 5);
    }

    #[test]
    fn compute_available_stock_returns_zero_when_sold_out() {
        // base_stock=3, restock_epoch=0 (1 batch), sold=3, max_stock=5
        // lifetime=3, unsold=0
        assert_eq!(compute_available_stock(3, 0, 3, 5).unwrap(), 0);
    }

    #[test]
    fn compute_shop_price_increases_with_restocks_and_sales() {
        // base_price=100, restock_epoch=1, sold_count=2
        // multiplier = 10_000 + 1*1200 + 2*400 = 12_000
        // price = ceil(100 * 12_000 / 10_000) = ceil(120) = 120
        assert_eq!(compute_shop_price(100, 1, 2).unwrap(), 120);
    }

    #[test]
    fn compute_shop_price_increases_after_restock() {
        // base_price=25, restock_epoch=1, sold_count=0
        // multiplier = 10_000 + 1*1200 + 0 = 11_200
        // price = ceil(25 * 11_200 / 10_000) = ceil(28) = 28
        assert_eq!(compute_shop_price(25, 1, 0).unwrap(), 28);
    }

    #[test]
    fn restock_recovers_stock_and_increases_price() {
        // Simulate: slot opens at t=0, interval=100, base_stock=3, max_stock=5
        // At t=50: restock_epoch=0, available=3, price=25
        // Player buys 3 → sold_count=3, available=0
        // At t=150: restock_epoch=1 (one restock happened), available=min(3*2-3,5)=3
        //   price = ceil(25 * (10_000 + 1*1200 + 3*400) / 10_000)
        //   = ceil(25 * (10_000 + 1200 + 1200) / 10_000)
        //   = ceil(25 * 12_400 / 10_000) = ceil(31) = 31
        let _slot = test_shop_item_slot_account();
        // After first restock epoch (t=150)
        let restock_epoch = compute_restock_epoch(0, 150, 100).unwrap();
        assert_eq!(restock_epoch, 1);

        let available = compute_available_stock(3, restock_epoch, 3, 5).unwrap();
        assert_eq!(available, 3);

        let price = compute_shop_price(25, restock_epoch, 3).unwrap();
        assert_eq!(price, 31);
    }

    // ── submit_boss_damage tests ────────────────────────────────────────────

    #[test]
    fn submit_boss_damage_succeeds_with_valid_inputs() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 10_000);
        let location = test_boss_location_account();
        let player_run = test_player_run();
        let player_pubkey = Pubkey::default();
        let expected_shard = compute_boss_shard_index(player_pubkey, 8);
        let shard = test_boss_damage_shard(expected_shard);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            player_pubkey,
            Pubkey::default(),
            8,
            500,
            1_500,
        )
        .is_ok());
    }

    #[test]
    fn submit_boss_damage_fails_when_dungeon_not_open() {
        let dungeon = test_dungeon(DungeonStatus::Pending, 1_000, 2_000);
        let location = test_boss_location_account();
        let player_run = test_player_run();
        let shard = test_boss_damage_shard(0);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            Pubkey::default(),
            Pubkey::default(),
            8,
            500,
            1_500,
        )
        .is_err());
    }

    #[test]
    fn submit_boss_damage_fails_when_damage_score_zero() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_boss_location_account();
        let player_run = test_player_run();
        let shard = test_boss_damage_shard(0);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            Pubkey::default(),
            Pubkey::default(),
            8,
            0,
            1_500,
        )
        .is_err());
    }

    #[test]
    fn submit_boss_damage_fails_when_damage_score_exceeds_max() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_boss_location_account();
        let player_run = test_player_run();
        let shard = test_boss_damage_shard(0);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            Pubkey::default(),
            Pubkey::default(),
            8,
            MAX_BOSS_DAMAGE_PER_SUBMISSION + 1,
            1_500,
        )
        .is_err());
    }

    #[test]
    fn submit_boss_damage_fails_when_shard_index_mismatch() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_boss_location_account();
        let player_run = test_player_run();
        // shard_index=1 but player's hash % 8 = 0
        let shard = test_boss_damage_shard(1);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            Pubkey::default(),
            Pubkey::default(),
            8,
            500,
            1_500,
        )
        .is_err());
    }

    #[test]
    fn submit_boss_damage_fails_when_location_is_not_boss() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_enemy_location_account();
        let player_run = test_player_run();
        let shard = test_boss_damage_shard(0);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            Pubkey::default(),
            Pubkey::default(),
            8,
            500,
            1_500,
        )
        .is_err());
    }

    #[test]
    fn submit_boss_damage_fails_when_player_run_not_active() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_boss_location_account();
        let mut player_run = test_player_run();
        player_run.active = false;
        let shard = test_boss_damage_shard(0);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            Pubkey::default(),
            Pubkey::default(),
            8,
            500,
            1_500,
        )
        .is_err());
    }

    #[test]
    fn submit_boss_damage_fails_when_submission_limit_exceeded() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let location = test_boss_location_account();
        let mut player_run = test_player_run();
        // Simulate MAX_BOSS_SUBMISSIONS_PER_PLAYER submissions already made
        player_run.boss_damage =
            MAX_BOSS_DAMAGE_PER_SUBMISSION * MAX_BOSS_SUBMISSIONS_PER_PLAYER as u64;
        let shard = test_boss_damage_shard(0);
        let contribution = test_boss_contribution();

        assert!(validate_submit_boss_damage(
            &dungeon,
            &location,
            &player_run,
            &shard,
            &contribution,
            Pubkey::default(),
            Pubkey::default(),
            8,
            500,
            1_500,
        )
        .is_err());
    }

    #[test]
    fn submit_boss_damage_applies_state_correctly() {
        let mut shard = test_boss_damage_shard(0);
        let mut contribution = test_boss_contribution();
        let mut player_run = test_player_run();
        let damage_score = 500;
        let now = 1_500;

        let outcome = apply_submit_boss_damage(
            &mut shard,
            &mut contribution,
            &mut player_run,
            damage_score,
            now,
            246,
        )
        .unwrap();

        assert_eq!(shard.total_damage, damage_score);
        assert_eq!(shard.participant_count, 1);
        assert_eq!(contribution.total_damage, damage_score);
        assert_eq!(contribution.last_hit_at, now);
        assert_eq!(player_run.boss_damage, damage_score);
        assert!(outcome.is_first_participation);
        assert_eq!(outcome.shard_total_damage, damage_score);
        assert_eq!(outcome.participant_count, 1);
        assert_eq!(outcome.player_total_damage, damage_score);
    }

    #[test]
    fn submit_boss_damage_accumulates_damage_on_second_submission() {
        let mut shard = test_boss_damage_shard(0);
        let mut contribution = test_boss_contribution();
        let mut player_run = test_player_run();
        let now = 1_500;

        // First submission
        apply_submit_boss_damage(&mut shard, &mut contribution, &mut player_run, 500, now, 246).unwrap();

        // Second submission
        let outcome = apply_submit_boss_damage(
            &mut shard,
            &mut contribution,
            &mut player_run,
            300,
            now + 100,
            246,
        )
        .unwrap();

        assert_eq!(shard.total_damage, 800);
        assert_eq!(shard.participant_count, 1); // still 1 participant
        assert_eq!(contribution.total_damage, 800);
        assert_eq!(contribution.last_hit_at, now + 100);
        assert_eq!(player_run.boss_damage, 800);
        assert!(!outcome.is_first_participation);
    }

    #[test]
    fn submit_boss_damage_multiple_players_increment_participant_count() {
        let mut shard = test_boss_damage_shard(0);
        let mut player1_contribution = test_boss_contribution();
        let mut player1_run = test_player_run();
        let now = 1_500;

        // Player 1 submits
        apply_submit_boss_damage(
            &mut shard,
            &mut player1_contribution,
            &mut player1_run,
            500,
            now,
            246,
        )
        .unwrap();
        assert_eq!(shard.participant_count, 1);

        // Player 2 submits (different contribution account)
        let mut player2_contribution = test_boss_contribution();
        let mut player2_run = test_player_run();
        apply_submit_boss_damage(
            &mut shard,
            &mut player2_contribution,
            &mut player2_run,
            300,
            now,
            246,
        )
        .unwrap();
        assert_eq!(shard.participant_count, 2);
        assert_eq!(shard.total_damage, 800);
    }

    #[test]
    fn compute_boss_shard_index_returns_valid_range() {
        let player = Pubkey::default();
        let shard_count = 8;

        for _ in 0..100 {
            let index = compute_boss_shard_index(player, shard_count);
            assert!(index < shard_count);
        }
    }

    #[test]
    fn compute_boss_shard_index_is_deterministic() {
        let player = Pubkey::default();
        let shard_count = 8;

        let index1 = compute_boss_shard_index(player, shard_count);
        let index2 = compute_boss_shard_index(player, shard_count);
        assert_eq!(index1, index2);
    }

    // ── claim_boss_participation_nft tests ──────────────────────────────────

    #[test]
    fn claim_boss_nft_succeeds_with_valid_contribution() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut contribution = test_boss_contribution();
        contribution.total_damage = 500;
        contribution.player = Pubkey::default();
        contribution.boss_location = Pubkey::default();
        let nft_claim = BossNftClaim {
            day_id: String::new(),
            player: Pubkey::default(),
            boss_location: Pubkey::default(),
            player_damage: 0,
            shard_index: 0,
            claimed_at: 0,
            bump: 0,
        };

        assert!(validate_claim_boss_participation_nft(
            &dungeon,
            Pubkey::default(),
            &contribution,
            &nft_claim,
            Pubkey::default(),
        )
        .is_ok());
    }

    #[test]
    fn claim_boss_nft_fails_when_dungeon_not_open_or_completed() {
        let dungeon = test_dungeon(DungeonStatus::Pending, 1_000, 2_000);
        let mut contribution = test_boss_contribution();
        contribution.total_damage = 500;
        contribution.player = Pubkey::default();
        contribution.boss_location = Pubkey::default();
        let nft_claim = BossNftClaim {
            day_id: String::new(),
            player: Pubkey::default(),
            boss_location: Pubkey::default(),
            player_damage: 0,
            shard_index: 0,
            claimed_at: 0,
            bump: 0,
        };

        assert!(validate_claim_boss_participation_nft(
            &dungeon,
            Pubkey::default(),
            &contribution,
            &nft_claim,
            Pubkey::default(),
        )
        .is_err());
    }

    #[test]
    fn claim_boss_nft_fails_when_contribution_too_low() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let contribution = test_boss_contribution(); // total_damage = 0
        let nft_claim = BossNftClaim {
            day_id: String::new(),
            player: Pubkey::default(),
            boss_location: Pubkey::default(),
            player_damage: 0,
            shard_index: 0,
            claimed_at: 0,
            bump: 0,
        };

        assert!(validate_claim_boss_participation_nft(
            &dungeon,
            Pubkey::default(),
            &contribution,
            &nft_claim,
            Pubkey::default(),
        )
        .is_err());
    }

    #[test]
    fn claim_boss_nft_fails_when_already_claimed() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut contribution = test_boss_contribution();
        contribution.total_damage = 500;
        contribution.player = Pubkey::default();
        contribution.boss_location = Pubkey::default();
        let nft_claim = BossNftClaim {
            day_id: "2026-04-25".to_string(),
            player: Pubkey::default(),
            boss_location: Pubkey::default(),
            player_damage: 500,
            shard_index: 0,
            claimed_at: 1_500, // already claimed
            bump: 0,
        };

        assert!(validate_claim_boss_participation_nft(
            &dungeon,
            Pubkey::default(),
            &contribution,
            &nft_claim,
            Pubkey::default(),
        )
        .is_err());
    }

    #[test]
    fn claim_boss_nft_fails_when_contribution_player_mismatch() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut contribution = test_boss_contribution();
        contribution.total_damage = 500;
        contribution.player = Pubkey::new_unique(); // different player
        contribution.boss_location = Pubkey::default();
        let nft_claim = BossNftClaim {
            day_id: String::new(),
            player: Pubkey::default(),
            boss_location: Pubkey::default(),
            player_damage: 0,
            shard_index: 0,
            claimed_at: 0,
            bump: 0,
        };

        assert!(validate_claim_boss_participation_nft(
            &dungeon,
            Pubkey::default(),
            &contribution,
            &nft_claim,
            Pubkey::default(),
        )
        .is_err());
    }

    #[test]
    fn claim_boss_nft_applies_state_correctly() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut contribution = test_boss_contribution();
        contribution.total_damage = 500;
        contribution.shard_index = 2;
        contribution.player = Pubkey::default();
        contribution.boss_location = Pubkey::default();
        let mut nft_claim = BossNftClaim {
            day_id: String::new(),
            player: Pubkey::default(),
            boss_location: Pubkey::default(),
            player_damage: 0,
            shard_index: 0,
            claimed_at: 0,
            bump: 0,
        };
        let now = 1_500;

        apply_claim_boss_participation_nft(
            &mut nft_claim,
            &dungeon,
            Pubkey::default(),
            &contribution,
            Pubkey::default(),
            now,
        )
        .unwrap();

        assert_eq!(nft_claim.day_id, "2026-04-25");
        assert_eq!(nft_claim.player, Pubkey::default());
        assert_eq!(nft_claim.boss_location, Pubkey::default());
        assert_eq!(nft_claim.player_damage, 500);
        assert_eq!(nft_claim.shard_index, 2);
        assert_eq!(nft_claim.claimed_at, now);
        assert!(nft_claim.claimed());
    }

    fn test_shop_item_slot_account() -> ShopItemSlotAccount {
        ShopItemSlotAccount {
            shop: Pubkey::default(),
            day_id: "2026-04-25".to_string(),
            poi_id: "shop-1".to_string(),
            poi_id_hash: poi_id_hash("shop-1"),
            slot_index: 0,
            item_id: "potion-common".to_string(),
            reward_tier: RewardTier::Common,
            base_price: 25,
            base_stock: 3,
            max_stock: 5,
            sold_count: 0,
            restock_interval_seconds: 3_600,
            max_restock_count: 2,
            per_wallet_daily_limit: 2,
            opened_at: 1_000,
            bump: 249,
        }
    }

    fn test_shop_item_slot_account_with_sold(sold: u64) -> ShopItemSlotAccount {
        let mut slot = test_shop_item_slot_account();
        slot.sold_count = sold;
        slot
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
            poi_id_hash: poi_id_hash("enemy-1"),
            status: LocationStatus::Available,
            x: 4,
            y: 7,
        }
    }

    fn test_shop_location_account() -> LocationAccount {
        LocationAccount {
            base_config_hash: [4; 32],
            bump: 251,
            daily_dungeon: Pubkey::default(),
            day_id: "2026-04-25".to_string(),
            kind: LocationKind::Shop,
            poi_id: "shop-1".to_string(),
            poi_id_hash: poi_id_hash("shop-1"),
            status: LocationStatus::Available,
            x: 8,
            y: 9,
        }
    }

    fn test_shop_account(location: Pubkey) -> ShopAccount {
        ShopAccount {
            bump: 250,
            day_id: "2026-04-25".to_string(),
            keeper_name: "Mira".to_string(),
            location,
            opened_at: 1_000,
            poi_id: "shop-1".to_string(),
            slot_count: 2,
        }
    }

    fn test_shop_item_slot_spec() -> ShopItemSlotSpecInput {
        ShopItemSlotSpecInput {
            base_stock: 3,
            item_id: "potion-common".to_string(),
            max_restock_count: 2,
            max_stock: 5,
            per_wallet_daily_limit: 2,
            price: 25,
            restock_interval_seconds: 3_600,
            reward_tier: RewardTier::Common,
            slot_id: "shop-1-slot-1".to_string(),
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
            bump: 252,
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
            items_purchased: 0,
            player: Pubkey::default(),
            rare_eligibility_points: 0,
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
            poi_id_hash: poi_id_hash("enemy-1"),
            reward_tier: None,
            shop: None,
            x: 4,
            y: 7,
        }
    }

    fn test_boss_location_account() -> LocationAccount {
        LocationAccount {
            base_config_hash: [5; 32],
            bump: 248,
            daily_dungeon: Pubkey::default(),
            day_id: "2026-04-25".to_string(),
            kind: LocationKind::Boss,
            poi_id: "boss-1".to_string(),
            poi_id_hash: poi_id_hash("boss-1"),
            status: LocationStatus::Available,
            x: 10,
            y: 10,
        }
    }

    fn test_boss_location() -> BossLocation {
        BossLocation {
            location: Pubkey::default(),
            day_id: "2026-04-25".to_string(),
            poi_id: "boss-1".to_string(),
            boss_id: "boss-dragon".to_string(),
            name: "Dragon".to_string(),
            level: 10,
            base_hp: 50_000,
            base_damage: 100,
            reward_tier: RewardTier::Epic,
            bump: 247,
        }
    }

    fn test_boss_damage_shard(shard_index: u16) -> BossDamageShard {
        BossDamageShard {
            day_id: "2026-04-25".to_string(),
            boss_location: Pubkey::default(),
            shard_index,
            total_damage: 0,
            participant_count: 0,
            bump: 247,
        }
    }

    fn test_boss_contribution() -> PlayerBossContribution {
        PlayerBossContribution {
            day_id: "".to_string(),
            player: Pubkey::default(),
            boss_location: Pubkey::default(),
            shard_index: 0,
            total_damage: 0,
            last_hit_at: 0,
            bump: 246,
        }
    }

    // ── claim_daily_reward tests ─────────────────────────────────────────────
    //
    // Note: validate_claim_daily_reward no longer checks end_ts — rewards are
    // claimable immediately upon entering the dungeon. The settlement-period
    // NFT mint carries the end_ts gate instead.

    #[test]
    fn claim_daily_reward_fails_when_player_run_not_active() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut player_run = test_player_run();
        player_run.active = false;
        let claim = test_daily_reward_claim_unclaimed();
        let dungeon_key = Pubkey::default();

        assert!(validate_claim_daily_reward(
            &dungeon,
            &player_run,
            &claim,
            Pubkey::default(),
            dungeon_key,
        )
        .is_err());
    }

    #[test]
    fn claim_daily_reward_fails_when_already_claimed() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let player_run = test_player_run();
        let claim = DailyRewardClaim {
            day_id: "2026-04-25".to_string(),
            player: Pubkey::default(),
            reward_pool: Pubkey::default(),
            reward_tier: RewardTier::Uncommon,
            amount: 0,
            claimed_at: 2_500, // already claimed
            bump: 0,
        };
        let dungeon_key = Pubkey::default();

        assert!(validate_claim_daily_reward(
            &dungeon,
            &player_run,
            &claim,
            Pubkey::default(),
            dungeon_key,
        )
        .is_err());
    }

    #[test]
    fn claim_daily_reward_fails_when_player_mismatch() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut player_run = test_player_run();
        player_run.player = Pubkey::new_unique(); // different player
        let claim = test_daily_reward_claim_unclaimed();
        let dungeon_key = Pubkey::default();

        assert!(validate_claim_daily_reward(
            &dungeon,
            &player_run,
            &claim,
            Pubkey::default(),
            dungeon_key,
        )
        .is_err());
    }

    #[test]
    fn claim_daily_reward_succeeds_with_valid_run() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let player_run = test_player_run();
        let claim = test_daily_reward_claim_unclaimed();
        let dungeon_key = Pubkey::default();

        assert!(validate_claim_daily_reward(
            &dungeon,
            &player_run,
            &claim,
            Pubkey::default(),
            dungeon_key,
        )
        .is_ok());
    }

    // ── compute_daily_reward_tier tests ──────────────────────────────────────

    #[test]
    fn reward_tier_uncommon_with_3_cleared_locations() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut player_run = test_player_run();
        player_run.cleared_locations = 3;

        let tier = compute_daily_reward_tier(&dungeon, &player_run).unwrap();
        assert_eq!(tier, RewardTier::Uncommon);
    }

    #[test]
    fn reward_tier_rare_with_8_cleared_and_500_boss_damage() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut player_run = test_player_run();
        player_run.cleared_locations = 8;
        player_run.boss_damage = 500;

        let tier = compute_daily_reward_tier(&dungeon, &player_run).unwrap();
        assert_eq!(tier, RewardTier::Rare);
    }

    #[test]
    fn reward_tier_rare_requires_both_cleared_and_boss_damage() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut player_run = test_player_run();
        player_run.cleared_locations = 8;
        player_run.boss_damage = 0; // insufficient boss damage for Rare

        let tier = compute_daily_reward_tier(&dungeon, &player_run).unwrap();
        assert_eq!(tier, RewardTier::Uncommon); // falls back to Uncommon
    }

    #[test]
    fn reward_tier_epic_with_12_cleared_and_1500_boss_damage() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut player_run = test_player_run();
        player_run.cleared_locations = 12;
        player_run.boss_damage = 1500;

        let tier = compute_daily_reward_tier(&dungeon, &player_run).unwrap();
        assert_eq!(tier, RewardTier::Epic);
    }

    #[test]
    fn reward_tier_legendary_is_deterministic_for_same_inputs() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut player_run = test_player_run();
        player_run.cleared_locations = 12;
        player_run.boss_damage = 1500;

        let tier1 = compute_daily_reward_tier(&dungeon, &player_run).unwrap();
        let tier2 = compute_daily_reward_tier(&dungeon, &player_run).unwrap();
        // Both calls must return the same tier (deterministic)
        assert_eq!(tier1, tier2);
    }

    #[test]
    fn reward_tier_common_when_no_conditions_met() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 10_000);
        let player_run = test_player_run(); // cleared_locations=0, boss_damage=0

        assert_eq!(
            compute_daily_reward_tier(&dungeon, &player_run).unwrap(),
            RewardTier::Common
        );
    }

    #[test]
    fn reward_tier_2_cleared_locations_falls_back_to_common() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 10_000);
        let mut player_run = test_player_run();
        player_run.cleared_locations = 2;

        assert_eq!(
            compute_daily_reward_tier(&dungeon, &player_run).unwrap(),
            RewardTier::Common
        );
    }

    // ── apply_claim_daily_reward tests ───────────────────────────────────────

    #[test]
    fn apply_claim_daily_reward_sets_fields_correctly() {
        let dungeon = test_dungeon(DungeonStatus::Open, 1_000, 2_000);
        let mut claim = test_daily_reward_claim_unclaimed();
        let now = 3_000;

        apply_claim_daily_reward(
            &mut claim,
            &dungeon,
            RewardTier::Epic,
            Pubkey::default(),
            now,
        )
        .unwrap();

        assert_eq!(claim.day_id, "2026-04-25");
        assert_eq!(claim.player, Pubkey::default());
        assert_eq!(claim.reward_tier, RewardTier::Epic);
        assert_eq!(claim.claimed_at, now);
        assert!(claim.claimed());
    }

    fn test_daily_reward_claim_unclaimed() -> DailyRewardClaim {
        DailyRewardClaim {
            day_id: String::new(),
            player: Pubkey::default(),
            reward_pool: Pubkey::default(),
            reward_tier: RewardTier::Common,
            amount: 0,
            claimed_at: 0,
            bump: 0,
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
