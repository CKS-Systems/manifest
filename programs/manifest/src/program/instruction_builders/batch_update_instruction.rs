use crate::{
    program::{
        batch_update::{BatchUpdateParams, CancelOrderParams, PlaceOrderParams},
        ManifestInstruction,
    },
    validation::{get_global_address, get_global_vault_address, get_vault_address},
};
use borsh::BorshSerialize;
use hypertree::DataIndex;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

// Token programs are needed for global orders with token22. Only include if
// this is global or could match with global. Defaults to normal token program.
pub fn batch_update_instruction(
    market: &Pubkey,
    payer: &Pubkey,
    trader_index_hint: Option<DataIndex>,
    cancels: Vec<CancelOrderParams>,
    orders: Vec<PlaceOrderParams>,
    base_mint_opt: Option<Pubkey>,
    base_mint_token_program_opt: Option<Pubkey>,
    quote_mint_opt: Option<Pubkey>,
    quote_mint_token_program_opt: Option<Pubkey>,
) -> Instruction {
    let mut account_metas: Vec<AccountMeta> = vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new(*market, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ];
    for (mint_opt, token_program_opt) in [
        (base_mint_opt, base_mint_token_program_opt),
        (quote_mint_opt, quote_mint_token_program_opt),
    ] {
        if let Some(mint) = mint_opt {
            let (global, _) = get_global_address(&mint);
            let (global_vault, _) = get_global_vault_address(&mint);
            let (market_vault, _) = get_vault_address(market, &mint);
            let mut global_account_metas: Vec<AccountMeta> = vec![
                AccountMeta::new(mint, false),
                AccountMeta::new(global, false),
                AccountMeta::new(global_vault, false),
                AccountMeta::new(market_vault, false),
            ];
            if token_program_opt.is_none()
                || token_program_opt.is_some_and(|f| f == spl_token::id())
            {
                global_account_metas.push(AccountMeta::new(spl_token::id(), false));
            } else {
                global_account_metas.push(AccountMeta::new(spl_token_2022::id(), false));
            }
            account_metas.extend(global_account_metas);
        }
    }

    Instruction {
        program_id: crate::id(),
        accounts: account_metas,
        data: [
            ManifestInstruction::BatchUpdate.to_vec(),
            BatchUpdateParams::new(trader_index_hint, cancels, orders)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    }
}
