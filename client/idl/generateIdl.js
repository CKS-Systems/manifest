const bs58 = require('bs58');
const keccak256 = require('keccak256');
const path = require('path');
const fs = require('fs');
const {
  rustbinMatch,
  confirmAutoMessageConsole,
} = require('@metaplex-foundation/rustbin');
const { spawnSync } = require('child_process');

const idlDir = __dirname;
const rootDir = path.join(__dirname, '..', '..', '.crates');

async function main() {
  console.log('Root dir address:', rootDir);
  ['manifest', 'wrapper'].map(async (programName) => {
    const programDir = path.join(
      __dirname,
      '..',
      '..',
      'programs',
      programName,
    );
    const cargoToml = path.join(programDir, 'Cargo.toml');
    console.log('Cargo.Toml address:', cargoToml);

    const rustbinConfig = {
      rootDir,
      binaryName: 'shank',
      binaryCrateName: 'shank-cli',
      libName: 'shank',
      dryRun: false,
      cargoToml,
    };
    // Uses rustbin from https://github.com/metaplex-foundation/rustbin
    const { fullPathToBinary: shankExecutable } = await rustbinMatch(
      rustbinConfig,
      confirmAutoMessageConsole,
    );
    spawnSync(shankExecutable, [
      'idl',
      '--out-dir',
      idlDir,
      '--crate-root',
      programDir,
    ]);
    modifyIdlCore(programName);
  });
}

function genLogDiscriminator(programIdString, accName) {
  return keccak256(
    Buffer.concat([
      Buffer.from(bs58.default.decode(programIdString)),
      Buffer.from('manifest::logs::'),
      Buffer.from(accName),
    ]),
  ).subarray(0, 8);
}

function modifyIdlCore(programName) {
  console.log('Adding arguments to IDL for', programName);
  const generatedIdlPath = path.join(idlDir, `${programName}.json`);
  let idl = require(generatedIdlPath);

  // Shank does not understand the type alias.
  idl = findAndReplaceRecursively(idl, { defined: 'DataIndex' }, 'u32');

  // Since we are not using anchor, we do not have the event macro, and that
  // means we need to manually insert events into idl.
  idl.events = [];

  if (programName == 'manifest') {
    // generateClient does not handle events
    // https://github.com/metaplex-foundation/shank/blob/34d3081208adca8b6b2be2b77db9b1ab4a70f577/shank-idl/src/file.rs#L185
    // so dont remove from accounts
    for (const idlAccount of idl.accounts) {
      if (idlAccount.name.includes('Log')) {
        const event = {
          name: idlAccount.name,
          discriminator: [
            ...genLogDiscriminator(idl.metadata.address, idlAccount.name),
          ],
          fields: idlAccount.type.fields,
        };
        idl.events.push(event);
      }
    }

    for (const idlAccount of idl.accounts) {
      if (idlAccount.type && idlAccount.type.fields) {
        idlAccount.type.fields = idlAccount.type.fields.map((field) => {
          if (field.type.defined == 'PodBool') {
            field.type = 'bool';
          }
          if (field.type.defined == 'f64') {
            field.type = 'FixedSizeUint8Array';
          }
          return field;
        });
      }
      if (idlAccount.name == "QuoteAtomsPerBaseAtom") {
        idlAccount.type.fields[0].type = "u128";
      }
    }

    for (const instruction of idl.instructions) {
      switch (instruction.name) {
        case 'CreateMarket': {
          // Create market does not have params
          break;
        }
        case 'ClaimSeat': {
          // Claim seat does not have params
          break;
        }
        case 'Deposit': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'DepositParams',
            },
          });
          break;
        }
        case 'Withdraw': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'WithdrawParams',
            },
          });
          break;
        }
        case 'PlaceOrder': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'PlaceOrderParams',
            },
          });
          break;
        }
        case 'CancelOrder': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'CancelOrderParams',
            },
          });
          break;
        }
        case 'Swap': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'SwapParams',
            },
          });
          break;
        }
        case 'BatchUpdate': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'BatchUpdateParams',
            },
          });
          break;
        }
        case 'Expand': {
          break;
        }
        case 'GlobalCreate': {
          break;
        }
        case 'GlobalAddTrader': {
          break;
        }
        case 'GlobalClaimSeat': {
          break;
        }
        case 'GlobalCleanOrder': {
          break;
        }
        case 'GlobalDeposit': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'GlobalDepositParams',
            },
          });
          break;
        }
        default: {
          console.log(instruction);
          throw new Error('Unexpected instruction');
        }
      }
    }
  } else if (programName == 'wrapper') {
    // Solita does not support f64
    // https://github.com/metaplex-foundation/beet/issues/48
    for (const idlType of idl.types) {
      if (idlType.type && idlType.type.fields) {
        idlType.type.fields = idlType.type.fields.map((field) => {
          if (field.name == 'price') {
            field.type = 'FixedSizeUint8Array';
          }
          return field;
        });
      }
    }
    idl.types.push({
      name: 'DepositParams',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'amountAtoms',
            type: 'u64',
          },
        ],
      },
    });
    idl.types.push({
      name: 'WithdrawParams',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'amountAtoms',
            type: 'u64',
          },
        ],
      },
    });
    idl.types.push({
      name: 'OrderType',
      type: {
        kind: 'enum',
        variants: [
          {
            name: 'Limit',
          },
          {
            name: 'ImmediateOrCancel',
          },
          {
            name: 'PostOnly',
          },
          {
            name: 'Global',
          },
        ],
      },
    });

    for (const idlType of idl.types) {
      if (idlType.type && idlType.type.fields) {
        idlType.type.fields = idlType.type.fields.map((field) => {
          if (field.type.defined == 'PodBool') {
            field.type = 'bool';
          }
          if (field.type.defined == 'f64') {
            field.type = 'FixedSizeUint8Array';
          }
          return field;
        });
      }
    }

    for (const instruction of idl.instructions) {
      switch (instruction.name) {
        case 'CreateWrapper': {
          break;
        }
        case 'ClaimSeat': {
          // Claim seat does not have params
          break;
        }
        case 'Deposit': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'DepositParams',
            },
          });
          break;
        }
        case 'Withdraw': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'WithdrawParams',
            },
          });
          break;
        }
        case 'BatchUpdate': {
          instruction.args.push({
            name: 'params',
            type: {
              defined: 'WrapperBatchUpdateParams',
            },
          });
          break;
        }
        case 'Expand': {
          break;
        }
        default: {
          console.log(instruction);
          throw new Error('Unexpected instruction');
        }
      }
    }
  } else {
    throw new Error('Unexpected program name');
  }
  fs.writeFileSync(generatedIdlPath, JSON.stringify(idl, null, 2));
}

function isObject(x) {
  return x instanceof Object;
}

function isArray(x) {
  return x instanceof Array;
}

/**
 * @param {*} target Target can be anything
 * @param {*} find val to find
 * @param {*} replaceWith val to replace
 * @returns the target with replaced values
 */
function findAndReplaceRecursively(target, find, replaceWith) {
  if (!isObject(target)) {
    if (target === find) {
      return replaceWith;
    }
    return target;
  } else if (
    isObject(find) &&
    JSON.stringify(target) === JSON.stringify(find)
  ) {
    return replaceWith;
  }
  if (isArray(target)) {
    return target.map((child) => {
      return findAndReplaceRecursively(child, find, replaceWith);
    });
  }
  return Object.keys(target).reduce((carry, key) => {
    const val = target[key];
    carry[key] = findAndReplaceRecursively(val, find, replaceWith);
    return carry;
  }, {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});