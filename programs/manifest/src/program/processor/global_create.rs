use std::mem::size_of;

use crate::{
    logs::{emit_stack, GlobalCreateLog},
    program::invoke,
    state::GlobalFixed,
    utils::create_account,
    validation::{get_global_address, get_global_vault_address, loaders::GlobalCreateContext},
};
use hypertree::{get_mut_helper, trace};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_pack::Pack, pubkey::Pubkey,
    rent::Rent, sysvar::Sysvar,
};

pub(crate) fn process_global_create(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    {
        trace!("process_global_create accs={accounts:?}");
        let global_create_context: GlobalCreateContext = GlobalCreateContext::load(accounts)?;

        let GlobalCreateContext {
            payer,
            global,
            system_program,
            global_mint,
            global_vault,
            token_program,
        } = global_create_context;

        // Make the global account.
        {
            let (_global_key, global_bump) = get_global_address(global_mint.info.key);
            let global_seeds: Vec<Vec<u8>> = vec![
                b"global".to_vec(),
                global_mint.info.key.as_ref().to_vec(),
                vec![global_bump],
            ];
            create_account(
                payer.as_ref(),
                global.as_ref(),
                system_program.as_ref(),
                &crate::id(),
                &Rent::get()?,
                size_of::<GlobalFixed>() as u64,
                global_seeds,
            )?;

            // Setup the empty market
            let empty_global_fixed: GlobalFixed = GlobalFixed::new_empty(&global_mint.as_ref().key);
            assert_eq!(global.info.data_len(), size_of::<GlobalFixed>());

            let global_bytes: &mut [u8] = &mut global.info.try_borrow_mut_data()?[..];
            *get_mut_helper::<GlobalFixed>(global_bytes, 0_u32) = empty_global_fixed;

            // Global does not require a permanent free block for swapping.
        }

        // Make the global vault.
        {
            // We dont have to deserialize the mint, just check the owner.
            let is_mint_22: bool = *global_mint.info.owner == spl_token_2022::id();
            let token_program_for_mint: Pubkey = if is_mint_22 {
                spl_token_2022::id()
            } else {
                spl_token::id()
            };

            let (_global_vault_key, global_vault_bump) =
                get_global_vault_address(global_mint.info.key);
            let global_vault_seeds: Vec<Vec<u8>> = vec![
                b"global-vault".to_vec(),
                global_mint.info.key.as_ref().to_vec(),
                vec![global_vault_bump],
            ];
            create_account(
                payer.as_ref(),
                global_vault.as_ref(),
                system_program.as_ref(),
                &token_program_for_mint,
                &Rent::get()?,
                spl_token::state::Account::LEN as u64,
                global_vault_seeds,
            )?;
            if is_mint_22 {
                invoke(
                    &spl_token_2022::instruction::initialize_account3(
                        &spl_token_2022::id(),
                        global_vault.as_ref().key,
                        global_mint.info.key,
                        global_vault.as_ref().key,
                    )?,
                    &[
                        payer.as_ref().clone(),
                        global_vault.as_ref().clone(),
                        global_mint.as_ref().clone(),
                        token_program.as_ref().clone(),
                    ],
                )?;
            } else {
                invoke(
                    &spl_token::instruction::initialize_account3(
                        &spl_token::id(),
                        global_vault.as_ref().key,
                        global_mint.info.key,
                        global_vault.as_ref().key,
                    )?,
                    &[
                        payer.as_ref().clone(),
                        global_vault.as_ref().clone(),
                        global_mint.as_ref().clone(),
                        token_program.as_ref().clone(),
                    ],
                )?;
            }
        }

        emit_stack(GlobalCreateLog {
            global: *global.info.key,
            creator: *payer.key,
        })?;
    }

    Ok(())
}
