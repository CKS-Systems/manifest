# Settings for devs that want to run the jar locally
# Importing justfile must define the following variables
# sbf_file -- location of .so file to verify

import "build.just"
import "certoraSolanaProver.just"
import "../envs/cvlr_envs.just"

# java executable
export JAVA := env_var_or_default("JAVA", "java")
# optimization level, 0 by default
export TAC_OPT_LEVEL := env_var_or_default("TAC_OPT_LEVEL", "0")

# location of prover jar
emv_jar := "$CERTORA/emv.jar"

# Usage: verify name_of_rule extra_options
verify RULE *OPTS: build-sbf 
		mkdir -p certora_out
		cd certora_out && ${JAVA} -ea -Xmx8g \
		-Dtopic.spec -Dlevel.sbf=${CERTORA_VERBOSE:-info} \
		-Dverbose.times -Dcvt.simple.parallel -Djava.awt.headless=true \
		-jar {{ emv_jar }} \
		-deleteSMTFile false -graphDrawLimit 2000 \
		{{ sbf_file }} \
		-unsatCoresForAllAsserts true \
		-solanaInlining {{ inliner_cfg }} \
		-solanaSummaries {{ summaries_cfg }} \
		-solanaOptimisticJoin true \
		-solanaOptimisticOverlaps true \
		-solanaOptimisticMemcpyPromotion true \
		-solanaOptimisticMemcmp true \
		-solanaOptimisticNoMemmove true \
		-solanaAggressiveGlobalDetection true \
		-solanaSlicerIter 6 \
		-solanaEnablePTAPseudoCanonicalize false \
		-solanaRemoveCFGDiamonds true \
		-solanaPrintDevMsg true \
		-solanaSkipCallRegInst true \
		-solanaPrintAnalyzedToDot \
		-solanaTACMathInt true \
		-solanaTACOptimize ${TAC_OPT_LEVEL} \
		-solanaStackSize 8192 \
		-solanaEntrypoint {{ RULE }} \
		{{ OPTS }} 

# Usage: vacuity name_of_rule extra_options
vacuity RULE *OPTS: (build-sbf "certora-vacuity") 
		mkdir -p certora_out
		cd certora_out && ${JAVA} -ea -Xmx8g \
		-Dtopic.spec -Dlevel.sbf=${CERTORA_VERBOSE:-info} \
		-Dverbose.times -Dcvt.simple.parallel -Djava.awt.headless=true \
		-jar {{ emv_jar }} \
		-deleteSMTFile false -graphDrawLimit 2000 \
		{{ sbf_file }} \
		-solanaInlining {{ inliner_cfg }} \
		-solanaSummaries {{ summaries_cfg }} \
		-solanaOptimisticJoin true \
		-solanaOptimisticOverlaps true \
		-solanaOptimisticMemcpyPromotion true \
		-solanaOptimisticMemcmp true \
		-solanaOptimisticNoMemmove true \
		-solanaAggressiveGlobalDetection true \
		-solanaSlicerIter 6 \
		-solanaEnablePTAPseudoCanonicalize false \
		-solanaRemoveCFGDiamonds true \
		-solanaPrintDevMsg true \
		-solanaSkipCallRegInst true \
		-solanaPrintAnalyzedToDot \
		-solanaTACOptimize ${TAC_OPT_LEVEL} \
		-solanaStackSize 8192 \
		-solanaEntrypoint {{ RULE }} \
		{{ OPTS }} 

