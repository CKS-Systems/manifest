# Requirements for compilation from Rust to SBF ##

1. Instal Certora CLI

```
pip install certora-cli
```

2. Solana CLI: 2.2.12

```
sh -c "$(curl -sSfL https://release.anza.xyz/v2.2.12/install)"
```

3. Install Certora version of platform-tools 1.41

   Go to https://github.com/Certora/certora-solana-platform-tools?tab=readme-ov-file#installation-of-executables and follow the instructions. 

4. Install `just` https://github.com/casey/just


# Build Solana prover from sources (only available for Certora employees) #

1. Install rustfilt to demangle Rust symbol names

```shell
cargo install rustfilt
```

2. Download https://github.com/Certora/EVMVerifier
3. Switch to branch `jorge/solana-jsm`
4. Follow installation instructions from here https://github.com/Certora/EVMVerifier?tab=readme-ov-file#installation

# Generate SBF file #

1. `cd programs/manifest`
2. `just build-sbf`

# How to run the prover #

## Configuration Parameters for Just ##

Just is controlled by environment variables. These are used to provide location for `certoraRun`, the key for the prover, etc. The easiest way to maintain them is to place them in a file called `.env` somewhere in the ancestor of the `justfile`. This can be at the root of the project, or even in the parent directory shared accross multiple projects. 

A typical `.env` file looks like this:
```
$ cat .env
CERTORA=[LOCATION OF emv.jar]
CERTORA_CLI=certoraRun
CERTORAKEY=[MYKEY]
```

Environment variables can also be used to pass extra options to various build scripts. This is usually only necessary in advanced scenarios.

## Run locally (only available for Certora employees) ##

You need to follow the steps from "Build Solana prover from sources".
Then, type:

1. `cd programs/manifest`
2. `just verify RULE_NAME EXTRA_PROVER_OPTS`

where `RULE_NAME` must be a public Rust function using `#[rule]`, and
`EXTRA_PROVER_OPTS` follows syntax of options passed to the jar
file. For instance, options such as `-bmc 3 -assumeUnwindCond ` that
tells the prover to unroll all loops up to 3 without adding the
"unwinding" assertion.

To verify all the rules locally and check that they return the expected result,
run the `verify-manifest` script located in `programs/manifest`: 

```
cd programs/manifest
./verify-manifest -r rules.json
./verify-manifest -r rules-rb-tree.json
```
Running `verify-manifest` requires `python3` `>= 3.13` 

## Run remotely ##

1. `cd programs/manifest`
2. `just verify-remote RULE_NAME EXTRA_PROVER_OPTS`

where `EXTRA_PROVER_OPTS` follows syntax of options passed to
`CertoraRun`.

After typing the above command, you should see something like this:

```
Connecting to server...
Job submitted to server
Follow your job at https://prover.certora.com
Once the job is completed, the results will be available at https://prover.certora.com/output/26873/37ce3f42dbd9419b942c693c7921652d?anonymousKey=b02ea230da2cf7b5d2681d86361744227668170d
```

If you open that above link then you will see the result of running
the Certora prover.

**VERY IMPORTANT**: both commands `just verify` and `just
verify-remote` will compile the Rust code each time before calling the
Solana prover (i.e., it calls the command `build-sbf`)


## Running locally vs remotely ##

Be aware that `just verify` calls directly the jar file while `just
verify-remote` calls the script `certoraRun`.  Therefore, the option
names can vary.  For instance,

```shell
just verify RULE_NAME -bmc 3 -assumeUnwindCond
```

and

```shell
just verify-remote RULE_NAME --loop_iter 3 --optimistic_loop
```
