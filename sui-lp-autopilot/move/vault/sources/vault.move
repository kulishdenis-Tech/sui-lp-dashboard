/// Protected LP Vault capability model.
/// OPERATOR: LP ops only (after Cetus wiring). OWNER: withdraw / emergency / revoke.
module autopilot_vault::vault;

use std::vector;
use sui::event;
use sui::object::{Self, UID, ID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

public struct OwnerCap has key, store {
    id: UID,
}

public struct OperatorCap has key, store {
    id: UID,
    vault_id: ID,
    active: bool,
}

public struct Vault has key {
    id: UID,
    owner: address,
    allowed_pool: ID,
    allowed_package: ID,
    emergency_stop: bool,
    buy_max_bin: u32,
    sell_min_bin: u32,
    position_ids: vector<ID>,
}

public struct VaultCreated has copy, drop {
    vault_id: ID,
    owner: address,
}

public struct EmergencyStopEvt has copy, drop {
    vault_id: ID,
}

public fun create_vault(
    allowed_pool: ID,
    allowed_package: ID,
    buy_max_bin: u32,
    sell_min_bin: u32,
    ctx: &mut TxContext,
): (Vault, OwnerCap) {
    let id = object::new(ctx);
    let vault_id = object::uid_to_inner(&id);
    let owner = tx_context::sender(ctx);
    let vault = Vault {
        id,
        owner,
        allowed_pool,
        allowed_package,
        emergency_stop: false,
        buy_max_bin,
        sell_min_bin,
        position_ids: vector::empty(),
    };
    event::emit(VaultCreated { vault_id, owner });
    (vault, OwnerCap { id: object::new(ctx) })
}

public fun share_vault(vault: Vault) {
    transfer::share_object(vault);
}

public fun transfer_owner_cap(cap: OwnerCap, to: address) {
    transfer::public_transfer(cap, to);
}

public fun mint_operator_cap(vault: &Vault, _owner: &OwnerCap, ctx: &mut TxContext): OperatorCap {
    assert!(!vault.emergency_stop, E_EMERGENCY);
    OperatorCap {
        id: object::new(ctx),
        vault_id: object::id(vault),
        active: true,
    }
}

public fun transfer_operator_cap(cap: OperatorCap, to: address) {
    transfer::public_transfer(cap, to);
}

public fun emergency_stop(vault: &mut Vault, _owner: &OwnerCap) {
    vault.emergency_stop = true;
    event::emit(EmergencyStopEvt { vault_id: object::id(vault) });
}

public fun clear_emergency(vault: &mut Vault, _owner: &OwnerCap) {
    vault.emergency_stop = false;
}

public fun revoke_operator(op: &mut OperatorCap, vault: &Vault, _owner: &OwnerCap) {
    assert!(op.vault_id == object::id(vault), E_WRONG_VAULT);
    op.active = false;
}

public fun assert_buy_bins(vault: &Vault, bins: &vector<u32>) {
    let mut i = 0;
    let n = vector::length(bins);
    while (i < n) {
        let b = *vector::borrow(bins, i);
        assert!(b <= vault.buy_max_bin, E_HARD_BUY);
        i = i + 1;
    };
}

public fun assert_sell_bins(vault: &Vault, bins: &vector<u32>) {
    let mut i = 0;
    let n = vector::length(bins);
    while (i < n) {
        let b = *vector::borrow(bins, i);
        assert!(b >= vault.sell_min_bin, E_HARD_SELL);
        i = i + 1;
    };
}

public fun assert_operator(vault: &Vault, op: &OperatorCap) {
    assert!(op.active, E_OP_INACTIVE);
    assert!(op.vault_id == object::id(vault), E_WRONG_VAULT);
    assert!(!vault.emergency_stop, E_EMERGENCY);
}

public fun assert_pool(vault: &Vault, pool_id: ID) {
    assert!(pool_id == vault.allowed_pool, E_POOL);
}

public fun owner_of(vault: &Vault): address {
    vault.owner
}

public fun is_emergency(vault: &Vault): bool {
    vault.emergency_stop
}

const E_EMERGENCY: u64 = 1;
const E_OP_INACTIVE: u64 = 2;
const E_WRONG_VAULT: u64 = 3;
const E_HARD_BUY: u64 = 4;
const E_HARD_SELL: u64 = 5;
const E_POOL: u64 = 6;
