//! Manifest is a limit order book exchange on the Solana blockchain.
//!

pub mod logs;
pub mod program;
pub mod quantities;
pub mod state;
pub mod utils;
pub mod validation;

#[cfg(feature = "certora")]
pub mod certora;

use hypertree::trace;
use program::{
    batch_update::process_batch_update, claim_seat::process_claim_seat,
    create_market::process_create_market, deposit::process_deposit,
    expand_market::process_expand_market, global_add_trader::process_global_add_trader,
    global_clean::process_global_clean, global_create::process_global_create,
    global_deposit::process_global_deposit, global_evict::process_global_evict,
    global_withdraw::process_global_withdraw, process_swap, withdraw::process_withdraw,
    delegate_market::process_delegate_market,
    commit_market::process_commit_market,
    undelegate_market::process_undelegate_market,
    ManifestInstruction,
};
use solana_program::{
    account_info::AccountInfo, declare_id, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

use crate::program::commit_and_undelegate_market::process_commit_and_undelegate_market;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "manifest",
    project_url: "https://manifest.trade",
    contacts: "email:britt@cks.systems",
    policy: "",
    preferred_languages: "en",
    source_code: "https://github.com/CKS-Systems/manifest",
    auditors: ""
}

// Overview of some economic disincentive security assumptions. There are
// multiple ways to spam and cause hassle for honest traders. The strategy to
// combat the different ways largely relies on economic assumptions that by
// making it prohibitively expensive to grief honest traders.
//
// Denial of service through many small orders.
// Because each regular order requires funds to be placed on the market as well
// as possibly rent to expand an account, an attacker would have some associated
// cost. Particularly important is the cost of growing the market. If this
// happens, honest actors should simply create a new market and the rent that
// the attacker posted is irretrievable, thus making the attack only a temporary
// nuissance. If the market is full and no new seats can be claimed, the same
// mitigation applies.
//
// CU exhaustion
// Clients are expected to manage CU estimates on their own. There should not be
// a way to make a stuck market because an honest actor can reduce their size
// and take orders in their way. The gas cost to place the orders is nearly the
// same as to match through them, and the cleaner gets the reward of plus EV
// trades.
//
// Global order spam
// If a bad actor were to place many orders that were not backed across many
// markets, there is an added gas as well as input accounts cost for honest
// actors cancelling or matching them. To combat this, there is a gas prepayment
// of 5_000 lamports per order. Because of this, if there is ever multiple
// unbacked or expired global orders, it is now profitable for a 3rd party to
// run a cleanup job and claim the gas prepayment.
//
// Global seat squatting
// Because global accounts cannot be thrown away and started anew like markets,
// there needs to be a gating to who can use the bytes in the account. Also,
// there is a good reason to keep the account size small as it costs more CU to
// allow large accounts. To address this, there is a cap on the number of
// traders who can have a seat on a global account. To prevent squatting and
// guarantee that they are actually used, there is a mechanism for eviction. To
// evict someone and free up a seat, the evictor needs to deposit more than the
// lowest depositor to evict them. The evictee gets their tokens back, but their
// global orders are now unbacked and could have their gas prepayment claimed.
// This is a risk that global traders take when they leave themselves vulnerable
// to be evicted by keeping a low balance. There is a concern of a flash loan
// being able to evict many seats in one transaction. This however is protected
// by solana account limits because each evictee gets their tokens withdrawn, so
// an account is needed per eviction, and that will quickly run into the solana
// transaction limit before an attacker is able to clear a substantial number of
// seats in one transaction.

declare_id!("FASTz9tarYt7xR67mA2zDtr15iQqjsDoU4FxyUrZG8vb");

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    let instruction: ManifestInstruction =
        ManifestInstruction::try_from(*tag).or(Err(ProgramError::InvalidInstructionData))?;

    trace!("Instruction: {:?}", instruction);

    match instruction {
        ManifestInstruction::CreateMarket => {
            process_create_market(program_id, accounts, data)?;
        }
        ManifestInstruction::ClaimSeat => {
            process_claim_seat(program_id, accounts, data)?;
        }
        ManifestInstruction::Deposit => {
            process_deposit(program_id, accounts, data)?;
        }
        ManifestInstruction::Withdraw => {
            process_withdraw(program_id, accounts, data)?;
        }
        ManifestInstruction::Swap => {
            process_swap(program_id, accounts, data)?;
        }
        ManifestInstruction::SwapV2 => {
            process_swap(program_id, accounts, data)?;
        }
        ManifestInstruction::Expand => {
            process_expand_market(program_id, accounts, data)?;
        }
        ManifestInstruction::BatchUpdate => {
            process_batch_update(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalCreate => {
            process_global_create(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalAddTrader => {
            process_global_add_trader(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalDeposit => {
            process_global_deposit(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalWithdraw => {
            process_global_withdraw(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalEvict => {
            process_global_evict(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalClean => {
            process_global_clean(program_id, accounts, data)?;
        }
        ManifestInstruction::DelegateMarket => {
            process_delegate_market(program_id,accounts,data)?;
        }
        ManifestInstruction::CommitMarket => {
            process_commit_market(program_id,accounts,data)?;
        }
        ManifestInstruction::CommitAndUndelgate => {
            process_commit_and_undelegate_market(program_id, accounts, data)?;
        }
        ManifestInstruction::UnDelegateMarket => {
            // Extract PDA seeds from market account for undelegation
            let market_account = &accounts[0]; // delegated_market is first account
            let market_data = market_account.try_borrow_data()?;
            
            // Read base mint (32 bytes starting at offset 16)
            let base_mint_bytes = &market_data[16..48];
            let base_mint = Pubkey::new_from_array(base_mint_bytes.try_into().unwrap());
            
            // Read quote mint (32 bytes starting at offset 48)
            let quote_mint_bytes = &market_data[48..80];
            let quote_mint = Pubkey::new_from_array(quote_mint_bytes.try_into().unwrap());
            
            // Prepare PDA seeds
            let pda_seeds: Vec<Vec<u8>> = vec![
                b"market".to_vec(),
                base_mint.to_bytes().to_vec(),
                quote_mint.to_bytes().to_vec(),
            ];
            
            process_undelegate_market(program_id, accounts, pda_seeds)?;
        }
    }

    Ok(())
}
