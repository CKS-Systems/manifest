use std::mem::size_of;

use crate::{
    logs::{emit_stack, GlobalCreateLog},
    state::GlobalFixed,
    utils::create_account,
    validation::{get_global_address, get_global_vault_address, loaders::GlobalCreateContext},
};
use hypertree::get_mut_helper;
use pinocchio::{
    account_info::{AccountInfo, Ref},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeAccount3;
use solana_program::{program_pack::Pack, rent::Rent, sysvar::Sysvar};
use spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, PodStateWithExtensions},
    pod::PodMint,
    state::Account,
};

pub(crate) fn process_global_create(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    {
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
            let (_global_key, global_bump) = get_global_address(global_mint.info.key());
            CreateAccount {
                from: &payer,
                to: &global.info,
                lamports: Rent::get()
                    .map_err(|_| ProgramError::InvalidAccountData)?
                    .minimum_balance(size_of::<GlobalFixed>() as usize),
                space: size_of::<GlobalFixed>() as u64,
                owner: &crate::id().to_bytes(),
            }
            .invoke_signed(&[pinocchio::signer!(b"global", global_mint.info.key().as_ref(), &[global_bump])]);

            // Setup the empty market
            let empty_global_fixed: GlobalFixed =
                GlobalFixed::new_empty(&global_mint.as_ref().key());
            assert_eq!(global.info.data_len(), size_of::<GlobalFixed>());

            let global_bytes: &mut [u8] = &mut global.info.try_borrow_mut_data()?[..];
            *get_mut_helper::<GlobalFixed>(global_bytes, 0_u32) = empty_global_fixed;

            // Global does not require a permanent free block for swapping.
        }

        // Make the global vault.
        {
            // We dont have to deserialize the mint, just check the owner.
            let is_mint_22: bool = *global_mint.info.owner() == spl_token_2022::id().to_bytes();
            let token_program_for_mint: Pubkey = if is_mint_22 {
                spl_token_2022::id().to_bytes()
            } else {
                spl_token::id().to_bytes()
            };

            let (_global_vault_key, global_vault_bump) =
                get_global_vault_address(global_mint.info.key());
            let global_vault_seeds: Vec<Vec<u8>> = vec![
                b"global-vault".to_vec(),
                global_mint.info.key().as_ref().to_vec(),
                vec![global_vault_bump],
            ];
            let rent: Rent = Rent::get().map_err(|_| ProgramError::InvalidAccountData)?;

            if is_mint_22 {
                todo!()
            } else {
                let space: usize = spl_token::state::Account::LEN;
                CreateAccount {
                    from: &payer,
                    to: global_vault.info,
                    lamports: rent.minimum_balance(space),
                    space: space as u64,
                    owner: &token_program_for_mint,
                }
                .invoke()?;
                InitializeAccount3 {
                    account: global_vault.info,
                    mint: global_mint.info,
                    owner: global_vault.info.key(),
                }
                .invoke()?;
            }
        }

        emit_stack(GlobalCreateLog {
            global: *global.info.key(),
            creator: *payer.key(),
        })?;
    }

    Ok(())
}
