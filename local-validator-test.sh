#!/bin/bash

# Start a local validator
solana-test-validator > /dev/null 2>&1 &
echo "Started test validator, sleeping for 15 seconds before starting"
sleep 15

# Save the pid so we can kill it at the end
TEST_VALIDATOR_PID=$!

cargo build-sbf
echo "Rebuilt program"

echo "Setting solana config to localnet"
solana config set --url l

solana program deploy target/deploy/manifest.so
solana program deploy target/deploy/wrapper.so
echo "Deployed manifest and wrapper"

yarn test
echo "Done with client tests"

kill -9 $TEST_VALIDATOR_PID

echo "Cleaning up ledger"
rm -rf test-ledger