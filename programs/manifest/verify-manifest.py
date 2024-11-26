from enum import Enum
import subprocess
import io
import sys
import datetime
import time
import os
import json
import argparse


class VerificationResult(Enum):
    Verified = 0
    Violated = 1
    Timeout = 2
    UnexpectedError = 3

    def __str__(self):
        return f"{self.name}"

    @staticmethod
    def from_string(result: str) -> 'VerificationResult':
        return VerificationResult[result]

    @staticmethod
    def from_command_result(command_result: subprocess.CompletedProcess[str]) -> 'VerificationResult':
        if command_result.returncode == 0:
            assert ("|Not violated" in command_result.stdout or "No errors found by Prover!" in command_result.stdout), ("The verification terminated successfully, but cannot find the '|Not violated' substring in stdout" + str(command_result.stdout))
            return VerificationResult.Verified
        elif "|Violated" in command_result.stdout:
            # If the return code is not zero, and in the stdout we find `|Violated`,
            # then the verification of the rule failed.
            return VerificationResult.Violated
        elif "|Timeout" in command_result.stdout:
            # If the return code is not zero, and in the stdout we find `|Timeout`,
            # then the verification of the rule failed.
            return VerificationResult.Timeout
        else:
            # If the return code is not zero, but we cannot find `|Violated` in
            # stdout, then we had an unexpected error while calling `just`.
            return VerificationResult.UnexpectedError


class ProverOption:
    '''Option to give to the prover.'''
    pass


class Bmc(ProverOption):
    def __init__(self, n: int):
        self.n = n

    def __str__(self) -> str:
        return f'--loop_iter {self.n}'


class AssumeUnwindCond(ProverOption):
    def __str__(self) -> str:
        return f'--optimistic_loop'


class CargoFeature:
    '''Cargo feature to use when calling `cargo build-sbf`.'''
    pass


class CvtDbMock(CargoFeature):
    def __str__(self) -> str:
        return 'cvt-db-mock'


class Rule:
    def __init__(self, name: str, expected_result: VerificationResult, prover_options: list[ProverOption], cargo_features: list[CargoFeature]):
        self.name = name
        self.expected_result = expected_result
        self.prover_options = prover_options
        self.cargo_features = cargo_features

    def __str__(self) -> str:
        return f"{self.name}"

    @staticmethod
    def list_from_json(rules_config_file_path: str) -> list['Rule']:
        with open(rules_config_file_path, 'r') as f:
            data = json.load(f)

        rules = []
        for rule_data in data['rules']:
            name = rule_data['name']

            # Load expected result
            expected_result_str = rule_data.get('expected_result')
            if expected_result_str not in VerificationResult.__members__:
                raise ValueError(f"Invalid expected result '{expected_result_str}' for rule '{name}'")
            expected_result = VerificationResult.from_string(
                expected_result_str)

            # Load prover options
            prover_options = []
            for option in rule_data['prover_options']:
                if 'bmc' in option:
                    if not isinstance(option['bmc'], int):
                        raise TypeError(f"Invalid type for 'bmc' option in rule '{name}', expected integer")
                    prover_options.append(Bmc(option['bmc']))
                elif 'assumeUnwindCond' in option:
                    if not isinstance(option['assumeUnwindCond'], bool):
                        raise TypeError(f"Invalid type for 'assumeUnwindCond' option in rule '{name}', expected boolean")
                    prover_options.append(AssumeUnwindCond())
                else:
                    raise ValueError(f"Unknown prover option '{option}' in rule '{name}'")

            # Load cargo features
            cargo_features = []
            valid_features = {
                'cvt-db-mock': lambda: CvtDbMock()
            }
            for feature in rule_data['cargo_features']:
                if feature not in valid_features:
                    raise ValueError(f"Unknown cargo feature '{feature}' in rule '{name}'")
                else:
                    cargo_features.append(valid_features[feature]())

            rules.append(Rule(name, expected_result,
                              prover_options, cargo_features))

        return rules


class VerificationRunner:
    def __init__(self):
        self.had_error = False

    def verify_all(self, rules: list[Rule]):
        logfile_name = VerificationRunner.generate_logfile_name()
        with open(logfile_name, 'w') as logfile:
            for (index, rule) in enumerate(rules):
                print(f'[{index+1:2}/{len(rules)}] {rule.name} ... ', end='')
                self.verify_rule(logfile, rule)
        VerificationRunner.clean()
        if self.had_error:
            sys.exit(1)

    def verify_rule(self, logfile: io.TextIOWrapper, rule: Rule):
        sys.stdout.flush()
        command = VerificationRunner.build_command(rule)
        try:
            start_time = time.time()
            verification_result = self.run_verification(command, logfile, rule)
            end_time = time.time()  # Record the end time
            elapsed_time = end_time - start_time  # Calculate the elapsed time
            self.check_verification_result(
                verification_result, rule.expected_result, command, elapsed_time)
        except FileNotFoundError:
            print(f"Failed to run command: `{command}`")

    @staticmethod
    def build_command(rule: Rule) -> str:
        command = f'just verify-remote {rule.name}'
        for option in rule.prover_options:
            command += f' {option}'
        return command

    def run_verification(self, command: str, logfile: io.TextIOWrapper, rule: Rule) -> VerificationResult:
        verification_env = VerificationRunner.build_verification_env(rule)
        # Run the verifier and capure the output.
        command_result = subprocess.run(
            command.split(), check=False, text=True, capture_output=True, env=verification_env)
        VerificationRunner.log_output(
            logfile, rule.name, command, command_result)
        return VerificationResult.from_command_result(command_result)

    @staticmethod
    def build_verification_env(rule: Rule) -> dict[str, str]:
        # Start with the current environment variables
        verification_env = os.environ.copy()
        cargo_features = ''
        for feature in rule.cargo_features:
            cargo_features += f' {feature}'
        verification_env["CARGO_FEATURES"] = cargo_features
        return verification_env

    def check_verification_result(self, verification_result: VerificationResult, expected_result: VerificationResult, command: str, elapsed_seconds: float) -> None:
        # Assert that we did not have an unexpected error (i.e., compilation
        # error), since all the rules should be verified or not verified.
        assert verification_result != VerificationResult.UnexpectedError, \
            f"Had unexpected error running `{command}`"

        # A timeout is an unexpected event
        assert verification_result != VerificationResult.Timeout, \
            f"Had a timeout event running `{command}`"

        if verification_result == expected_result:
            print(f'ok ({elapsed_seconds:.2f}s)')
        else:
            print(f'error ({elapsed_seconds:.2f}s)')
            print(f'\tExpected result: {expected_result}')
            print(f'\tActual result:   {verification_result}')
            self.had_error = True

    @staticmethod
    def generate_logfile_name() -> str:
        current_time = datetime.datetime.now()
        return current_time.strftime("log_verification_%Y-%m-%d_%H:%M:%S")

    @staticmethod
    def log_output(logfile: io.TextIOWrapper, rule_name: str, command: str, command_result: subprocess.CompletedProcess[str]) -> None:
        print(f'---- Rule {rule_name} ----', file=logfile)
        print(f'Command: `{command}`', file=logfile)
        print(f'Return code: {command_result.returncode}', file=logfile)
        print(f'Stdout:', file=logfile)
        print(command_result.stdout, file=logfile)
        print(f'Stderr:', file=logfile)
        print(command_result.stderr, file=logfile)

    @staticmethod
    def clean() -> None:
        ''' Call `just clean`. '''
        subprocess.run(["just", "clean"], check=True, capture_output=True)


# Parse the CLI options
parser = argparse.ArgumentParser(
    description="Run the rules as specified in a JSON configuration file")
parser.add_argument(
    "-r", "--rules",
    help="Path to the JSON configuration file with the rules specification.",
    type=str,
    default="rules.json"
)
args = parser.parse_args()

rules = Rule.list_from_json(args.rules)
runner = VerificationRunner()
runner.verify_all(rules)
