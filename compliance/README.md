# Manifest Sanctions Compliance Specification

## Overview
This document outlines the technical specification for implementing sanctions compliance in the Manifest protocol. The system is designed to ensure that users interacting with Manifest are compliant with sanctions requirements while maintaining protocol performance and scalability.

## Background
- Trading firms may require OFAC compliance capabilities for their involvement with Manifest
- Traditional on-chain blacklist approaches are not scalable due to Solana account storage limitations
- A compliance system is needed at account creation time

## System Architecture

### Option 1: Sanctions Compliance Program (SCP)

#### Components
1. **Sanctions Compliance Program (SCP)**
   - Maintained by Sanctions Compliance Provider as an on-chain oracle
   - Creates and manages proof of compliance accounts
   - Uses API access to sanctions lists for real-time compliance checking

2. **Proof of Compliance Account**
   - Created at a PDA derived from user's wallet address
   - Represents attestation of sanctions compliance
   - Created prior to any Manifest interaction

#### Flow
1. User initiates account creation with Manifest
2. SCP verifies wallet against sanctions lists
3. If compliant, SCP creates a Proof of Compliance account
4. Manifest checks for existence of Proof of Compliance account during wrapper creation
5. Account creation proceeds only if Proof of Compliance exists

### Option 2: Signature-Based Compliance

#### Components
1. **Sanctions Compliance Provider Signer**
   - Off-chain service maintaining sanctions list access
   - Signs account creation transactions for compliant wallets

2. **Additional Signer Check**
   - Implemented in Manifest wrapper creation
   - Verifies Sanctions Compliance Provider signature

#### Flow
1. User initiates account creation
2. Request sent to Sanctions Compliance Provider service
3. Sanctions Compliance Provider checks wallet against sanctions lists
4. If compliant, Sanctions Compliance Provider signs the creation transaction
5. Manifest verifies signature during wrapper creation

## Technical Implementation Details

### Proof of Compliance Account Structure
```rust
pub struct ProofOfCompliance {
    pub wallet: Pubkey,
    pub attestor: Pubkey,
}
```

### Verification Requirements
- Proof of Compliance must exist at expected PDA
- Account must be created by authorized Sanctions Compliance Provider program

## Compliance Considerations
- System provides clear path for OFAC-compliant interaction
- Alternative paths may exist but are not officially supported
- Compliance verification occurs at account creation only
- No ongoing transaction monitoring required

## Recommendations
1. Implement Option 1 (SCP) if Sanctions Compliance Provider can maintain on-chain program
   - More scalable
   - Better suited for general-purpose use
   - Cleaner implementation

2. Fall back to Option 2 (Signature) if only API access is available
   - Simpler implementation
   - Requires less infrastructure from Sanctions Compliance Provider
   - May have higher operational overhead due to uptime requirements

## Integration Notes
- System to be implemented at wrapper creation level
- No need for per-transaction compliance checks
- Sanctions Compliance Provider integration details to be finalized based on chosen approach

## Open Questions
1. Will a Sanctions Compliance Provider maintain an on-chain program or provide only API access?
2. Will Sanctions Compliance Provider provide signatures on their responses that can be used to prove that a response came from them?
3. What are the specific requirements for compliance above any beyond OFAC?

## Next Steps
1. Confirm Sanctions Compliance Provider integration approach
2. Finalize technical implementation details
3. Review with trading legal team
4. Begin implementation of chosen approach


