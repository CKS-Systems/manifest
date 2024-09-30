#!/bin/bash

cargo build-sbf
echo "Rebuilt program"

# Start a local validator
solana-test-validator --bpf-program MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms target/deploy/manifest.so --bpf-program UMnFStVeG1ecZFc2gc5K3vFy3sMpotq8C91mXBQDGwh target/deploy/ui_wrapper.so --bpf-program wMNFSTkir3HgyZTsB7uqu3i7FA73grFCptPXgrZjksL target/deploy/wrapper.so  >/dev/null 2>&1 &
echo "Started test validator, sleeping for 15 seconds before starting"
sleep 15

# Save the pid so we can kill it at the end
TEST_VALIDATOR_PID=$!

echo "Setting solana config to localnet"
solana config set --url l

yarn test
echo "Done with client tests"

kill -9 $TEST_VALIDATOR_PID

echo "Cleaning up ledger"
rm -rf test-ledger