use crate::{
    market_vault_seeds_with_bump,
    program::{batch_expand_market, get_dynamic_account, get_mut_dynamic_account, invoke_signed},
    require_rejecting,
    state::MarketFixed,
    validation::{
        next_account_info, to_program_error, AccountViewExt, ManifestAccountInfo, Program, Signer,
        TokenAccountInfo, TokenProgram,
    },
};
use pinocchio::{
    account::AccountView,
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};
use solana_program::{pubkey, pubkey::Pubkey};
use spl_token_2022::{
    extension::{transfer_fee::TransferFeeAmount, BaseStateWithExtensions, StateWithExtensions},
    state::Account,
};

#[cfg(not(feature = "test"))]
pub const DEFRAG_COLLECTOR: Pubkey = pubkey!("B6dmr2UAn2wgjdm3T4N1Vjd8oPYRRTguByW7AEngkeL6");
#[cfg(feature = "test")]
pub const DEFRAG_COLLECTOR: Pubkey = pubkey!("2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ");

pub(crate) fn process_defrag(
    _program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // Up to two little endian u32 budgets, so each step can be run on its own
    // and any single transaction kept affordable:
    //
    //   (empty)                     unbounded relocations, every empty seat
    //   [relocations]               that many relocations, every empty seat
    //   [relocations, seats]        that many relocations, that many seats
    //
    // An explicit zero disables its step rather than meaning unbounded, so an
    // operator whose computed budget rounds down to zero gets less work than
    // asked for, never more. `[0, 0]` collects excess lamports and truncates
    // the existing free tail while touching no entry, which is also the run
    // that cannot invalidate a client's cached index. A market too large to
    // compact in one transaction is compacted by repeating a bounded run; each
    // leaves a valid market no larger than it started.
    require_rejecting!(
        matches!(data.len(), 0 | 4 | 8),
        ProgramError::InvalidInstructionData,
        "Defrag takes an optional u32 relocation budget and an optional u32 seat budget"
    )?;
    let budget = |at: usize| -> Option<u32> {
        data.get(at..at + 4)
            .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()))
    };
    let limit: Option<u32> = budget(0);
    let seat_limit: Option<u32> = budget(4);
    let iter = &mut accounts.iter();
    let collector = Signer::new_payer_rejecting(next_account_info(iter)?)?;
    require_rejecting!(
        *collector.pubkey() == DEFRAG_COLLECTOR,
        ProgramError::InvalidArgument,
        "Invalid collector"
    )?;
    let market = ManifestAccountInfo::<MarketFixed>::new(next_account_info(iter)?)?;
    let base_vault = next_account_info(iter)?;
    let quote_vault = next_account_info(iter)?;
    let base_program = TokenProgram::new(next_account_info(iter)?)?;
    let quote_program = TokenProgram::new(next_account_info(iter)?)?;
    let _system = Program::new(
        next_account_info(iter)?,
        &solana_sdk_ids::system_program::id(),
    )?;
    require_rejecting!(
        market.info.is_writable() && base_vault.is_writable() && quote_vault.is_writable(),
        ProgramError::InvalidAccountData,
        "Defrag accounts must be writable"
    )?;
    let fixed = *market.get_fixed()?;
    for (vault, program, mint, key) in [
        (
            base_vault,
            &base_program,
            fixed.get_base_mint(),
            fixed.get_base_vault(),
        ),
        (
            quote_vault,
            &quote_program,
            fixed.get_quote_mint(),
            fixed.get_quote_vault(),
        ),
    ] {
        TokenAccountInfo::new_with_owner_and_key(vault, mint, key, key)?;
        require_rejecting!(
            vault.owner_pubkey() == *program.pubkey(),
            ProgramError::IncorrectProgramId,
            "Wrong vault token program"
        )?;
    }
    // CPI transfers happen before direct market-lamport changes, so each CPI
    // observes balanced account lamports. WSOL principal and its reserve stay.
    // Only Token-2022 supports withdrawing excess lamports on mainnet. Classic
    // Token vaults retain their excess until closure; ProgramTest's bundled
    // p-token replacement supports more instructions than the deployed program.
    for (vault, program, mint, bump) in [
        (
            base_vault,
            &base_program,
            fixed.get_base_mint(),
            fixed.get_base_vault_bump(),
        ),
        (
            quote_vault,
            &quote_program,
            fixed.get_quote_mint(),
            fixed.get_quote_vault_bump(),
        ),
    ] {
        if *program.pubkey() != spl_token_2022::id() {
            continue;
        }
        let native = StateWithExtensions::<Account>::unpack(&vault.try_borrow()?)
            .map_err(to_program_error)?
            .base
            .is_native
            .is_some();
        let minimum = Rent::get()?.try_minimum_balance(vault.data_len())?;
        if !native && vault.lamports() > minimum {
            let ix = spl_token_2022_interface::instruction::withdraw_excess_lamports(
                program.pubkey(),
                vault.pubkey(),
                collector.pubkey(),
                vault.pubkey(),
                &[],
            )
            .map_err(to_program_error)?;
            invoke_signed(
                &ix,
                &[vault, collector.info, program.info],
                market_vault_seeds_with_bump!(market.pubkey(), mint, bump),
            )?;
        }
    }
    let missing = {
        let data = market.try_borrow()?;
        let state = get_dynamic_account::<MarketFixed>(&data);
        state.free_blocks_short_of_n(2).unwrap_or(0)
    };
    if missing != 0 {
        batch_expand_market(&collector, &market, missing)?;
    }
    let size = {
        let mut data = market.try_borrow_mut()?;
        get_mut_dynamic_account::<MarketFixed>(&mut data).defragment_with(limit, seat_limit)?
    };
    // Empty vaults may be closed only when no token/extension claims remain.
    let empty = size == crate::state::MARKET_FIXED_SIZE + 2 * crate::state::MARKET_BLOCK_SIZE;
    let mut closable = empty;
    for vault in [base_vault, quote_vault] {
        let data = vault.try_borrow()?;
        let account = StateWithExtensions::<Account>::unpack(&data).map_err(to_program_error)?;
        closable &= account.base.amount == 0;
        if let Ok(fees) = account.get_extension::<TransferFeeAmount>() {
            closable &= u64::from(fees.withheld_amount) == 0;
        }
        // Unknown or confidential extension state needs its own retirement
        // policy. Supported market vault extensions carry no other balances.
        for extension in account.get_extension_types().map_err(to_program_error)? {
            use spl_token_2022::extension::ExtensionType;
            closable &= matches!(
                extension,
                ExtensionType::TransferFeeAmount
                    | ExtensionType::TransferHookAccount
                    | ExtensionType::PausableAccount
                    | ExtensionType::ImmutableOwner
            );
        }
    }
    if closable {
        for (vault, program, mint, bump) in [
            (
                base_vault,
                &base_program,
                fixed.get_base_mint(),
                fixed.get_base_vault_bump(),
            ),
            (
                quote_vault,
                &quote_program,
                fixed.get_quote_mint(),
                fixed.get_quote_vault_bump(),
            ),
        ] {
            let ix = spl_token_2022_interface::instruction::close_account(
                program.pubkey(),
                vault.pubkey(),
                collector.pubkey(),
                vault.pubkey(),
                &[],
            )
            .map_err(to_program_error)?;
            invoke_signed(
                &ix,
                &[vault, collector.info, program.info],
                market_vault_seeds_with_bump!(market.pubkey(), mint, bump),
            )?;
        }
        let balance = collector
            .lamports()
            .checked_add(market.lamports())
            .ok_or(ProgramError::ArithmeticOverflow)?;
        collector.info.set_lamports(balance);
        market.info.close()?;
        return Ok(());
    }
    market.info.resize(size)?;
    let minimum = Rent::get()?.try_minimum_balance(size)?;
    let excess = market.lamports().saturating_sub(minimum);
    let destination = collector
        .lamports()
        .checked_add(excess)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    market.info.set_lamports(market.lamports() - excess);
    collector.info.set_lamports(destination);
    Ok(())
}
