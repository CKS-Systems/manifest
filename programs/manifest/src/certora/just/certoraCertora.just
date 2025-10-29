# This just file is imported in any directory that contains Certora Prover conf files
set dotenv-load

export CERTORA_SOLANA_CLI := env_var_or_default("CERTORA_SOLANA_CLI", "certoraSolanaProver")

certora RULE: 
    ${CERTORA_SOLANA_CLI} run.conf --rule {{ RULE }} --msg {{ RULE }}

certora-conf CONF *OPTS: 
	${CERTORA_SOLANA_CLI} {{ file_name(CONF) }} {{ OPTS }}

clean:
    rm -rf .certora_internal