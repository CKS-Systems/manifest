const { Solita } = require('@metaplex-foundation/solita');
const { spawnSync } = require('child_process');
const path = require('path');
const idlDir = __dirname;

async function main() {
  ['manifest', 'wrapper'].forEach((programName) => {
    const sdkDir = path.join(__dirname, '..', 'ts', 'src', programName);
    const accountsPath = path.join(sdkDir, 'accounts/*');
    const typesPath = path.join(sdkDir, 'types/*');

    console.log('Generating TypeScript SDK to %s', sdkDir);
    // Use a previously generated idl instead of all at once in this script
    // https://github.com/metaplex-foundation/solita because we need to add args
    // to instructions after shank runs.
    const generatedIdlPath = path.join(idlDir, `${programName}.json`);

    console.log('Using IDL at %s', generatedIdlPath);
    const idl = require(generatedIdlPath);
    const gen = new Solita(idl, { formatCode: true });

    gen.renderAndWriteTo(sdkDir).then(() => {
      console.log('Running prettier on generated files...');
      spawnSync('prettier', ['--write', sdkDir, '--trailing-comma all'], {
        stdio: 'inherit',
      });
      // Fix the fact that floats are not supported by beet.
      spawnSync(
        'sed',
        ['-i', "'s/FixedSizeUint8Array/fixedSizeUint8Array(8)/g'", typesPath],
        { stdio: 'inherit', shell: true, windowsVerbatimArguments: true },
      );
      if (programName == 'manifest') {
        spawnSync(
          'sed',
          [
            '-i',
            "'s/FixedSizeUint8Array/fixedSizeUint8Array(8)/g'",
            accountsPath,
          ],
          { stdio: 'inherit', shell: true, windowsVerbatimArguments: true },
        );
      }

      spawnSync(
        'cd ../../ && yarn format',
        ['--write', ' --config package.json', '--trailing-comma'],
        { stdio: 'inherit' },
      );

      // TODO: Also do the wrapper constant.
      // Make sure the client has the correct fixed header size. Copy any
      // other constants over as needed.
      spawnSync(
        "ORIGINAL_LINE=$(awk '/export const FIXED_MANIFEST_HEADER_SIZE: number = [-.0-9]+;/' client/ts/src/constants.ts); " +
          'NEW_LINE=$(echo "export const FIXED_MANIFEST_HEADER_SIZE: number = ")$(awk \'/pub const MARKET_FIXED_SIZE: usize = [-.0-9]+;/\' programs/manifest/src/state/constants.rs | tr -d -c 0-9)$(echo ";"); ' +
          'sed --debug -i "s/${ORIGINAL_LINE}/${NEW_LINE}/" client/ts/src/constants.ts',
        [],
        { stdio: 'inherit' },
      );
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
