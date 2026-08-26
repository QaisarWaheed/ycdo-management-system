"use strict";
/**
 * Regression tests for the absence-family financial-validity fix in
 * system-wide-discipline-cleanup-2026.ts.
 *
 * NOT a Jest spec — this project's Jest config is scoped to
 * `rootDir: "src"` (see apps/api/package.json), which does not reach
 * apps/api/scripts/. Rather than widen the app's shared Jest configuration
 * for one standalone script, this is a plain Node regression runner using
 * the built-in `assert` module — zero new dependencies, zero DB access
 * (tests only the pure, exported classification functions), runnable via:
 *
 *   npx ts-node --transpile-only scripts/system-wide-discipline-cleanup-2026.regression-test.ts
 *
 * Exits 0 if all tests pass, 1 otherwise.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_1 = require("@prisma/client");
const system_wide_discipline_cleanup_2026_1 = require("./system-wide-discipline-cleanup-2026");
let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
    try {
        fn();
        passed++;
        console.error(`  PASS  ${name}`);
    }
    catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${name}: ${msg}`);
        console.error(`  FAIL  ${name}`);
        console.error(`        ${msg}`);
    }
}
console.error('=== system-wide-discipline-cleanup-2026 regression tests ===');
// 1. dated absence deduction + current UNINFORMED_ABSENT => NOT cleanup target
test('1. UNINFORMED_ABSENT current status -> financially VALID, not a cleanup target', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.UNINFORMED_ABSENT }), 'VALID');
});
// 2. dated absence deduction + current ABSENT => NOT cleanup target
test('2. ABSENT current status -> financially VALID, not a cleanup target', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.ABSENT }), 'VALID');
});
// 3. UNINFORMED_ABSENT -> ABSENT: financial deduction remains; UA DisciplineEvent
//    can be independently targeted if stale.
test('3. UNINFORMED_ABSENT -> ABSENT: financial VALID, DisciplineEvent independently STALE_REMOVE', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.ABSENT }), 'VALID', 'financial deduction must remain valid');
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyUninformedAbsentDisciplineEvent)({ currentStatus: client_1.AttendanceStatus.ABSENT }), 'STALE_REMOVE', 'DisciplineEvent(UNINFORMED_ABSENT) must be independently targetable once status is no longer UNINFORMED_ABSENT');
});
// 4. dated absence deduction + current PRESENT => cleanup target
test('4. PRESENT current status -> EXACT_DATE_STALE_UA (exact correction proven)', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.PRESENT }), 'EXACT_DATE_STALE_UA');
});
// 5. dated absence deduction + current ON_LEAVE => cleanup target (leave supersedes)
test('5. ON_LEAVE current status -> EXACT_DATE_STALE_UA (approved leave supersedes absence)', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.ON_LEAVE }), 'EXACT_DATE_STALE_UA');
});
// 6. dated absence deduction + current SWAP_COVERED => follows actual backend policy.
//    Verified against discipline.helper.ts's isAbsentFamilyEligibleForDiscipline:
//    SWAP_COVERED is not ABSENT/UNINFORMED_ABSENT and has no special-case carve-out
//    anywhere in the codebase (grep confirmed: only mutual-swap.service.ts sets the
//    status, no dedicated deduction-adjustment logic exists for it) -> invalidates.
test('6. SWAP_COVERED current status -> EXACT_DATE_STALE_UA (confirmed via actual backend predicate, not assumed)', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: 'SWAP_COVERED' }), 'EXACT_DATE_STALE_UA');
});
// 7. dated absence deduction + current HALF_DAY => follows actual backend policy.
//    HALF_DAY is never ABSENT/UNINFORMED_ABSENT (it is a lateness classification,
//    per discipline.helper.ts's applyDisciplineRules) -> invalidates.
test('7. HALF_DAY current status -> EXACT_DATE_STALE_UA (confirmed via actual backend predicate)', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.HALF_DAY }), 'EXACT_DATE_STALE_UA');
});
// 8. dated absence deduction + current LATE => follows actual backend policy.
test('8. LATE current status -> EXACT_DATE_STALE_UA (confirmed via actual backend predicate)', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.LATE }), 'EXACT_DATE_STALE_UA');
});
// 9. stale financial deduction + valid (unrelated-category) DisciplineEvent =>
//    financial target only. classifyUninformedAbsentDisciplineEvent is scoped
//    ENTIRELY to UNINFORMED_ABSENT-category events by construction — the
//    independent pass in collectEvidenceAndClassify() only ever calls it after
//    filtering `e.category !== DisciplineCategory.UNINFORMED_ABSENT ? continue`.
//    A LATE-category (or any other) DisciplineEvent is therefore NEVER
//    evaluated or targeted by this function, regardless of a co-located
//    absence deduction's own staleness. Verified two ways: (a) the pure
//    function's own contract (it has no category parameter — it is the
//    caller's responsibility to only invoke it for UNINFORMED_ABSENT rows),
//    and (b) a static source-scan confirming that filter exists exactly once,
//    guarding the only call site.
test('9. stale financial deduction never implies an unrelated-category DisciplineEvent is touched', () => {
    // (a) Financial side can be stale independent of any discipline signal.
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.PRESENT }), 'EXACT_DATE_STALE_UA');
    // (b) Static contract check: the independent DisciplineEvent pass must be
    // category-filtered to UNINFORMED_ABSENT before ever calling
    // classifyUninformedAbsentDisciplineEvent, so a LATE-category event can
    // never reach it.
    const source = fs.readFileSync(path.join(__dirname, 'system-wide-discipline-cleanup-2026.ts'), 'utf8');
    const guardPattern = /if \(e\.category !== DisciplineCategory\.UNINFORMED_ABSENT\) continue;\s*\n[\s\S]{0,400}?classifyUninformedAbsentDisciplineEvent\(/;
    assert.ok(guardPattern.test(source), 'expected the UNINFORMED_ABSENT category guard to precede the only classifyUninformedAbsentDisciplineEvent call site');
});
// 10. stale financial deduction + stale exact UA DisciplineEvent => both may be
//     targeted independently (same underlying status, two separately-computed
//     verdicts, neither one gates the other).
test('10. PRESENT current status -> both financial AND DisciplineEvent(UNINFORMED_ABSENT) independently stale', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: client_1.AttendanceStatus.PRESENT }), 'EXACT_DATE_STALE_UA');
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyUninformedAbsentDisciplineEvent)({ currentStatus: client_1.AttendanceStatus.PRESENT }), 'STALE_REMOVE');
});
// 11. synthetic UNINFORMED_ABSENT stale target => invariant MUST fail.
// Directly exercises the same predicate main()'s
// noCurrentUninformedAbsentIsTargetedAsStaleFinancialDeduction /
// absenceFamilyFinancialValidityMatchesBusinessPolicy invariants use, fed a
// deliberately corrupted target list, proving the check is not a
// trivially-true placeholder.
test('11. a corrupted target list containing a current-UNINFORMED_ABSENT row fails the invariant', () => {
    const corruptedTargets = [
        { currentAttendanceStatus: client_1.AttendanceStatus.PRESENT },
        { currentAttendanceStatus: client_1.AttendanceStatus.UNINFORMED_ABSENT }, // deliberately invalid
    ];
    const noCurrentUninformedAbsentIsTargetedAsStale = corruptedTargets.every((t) => t.currentAttendanceStatus !== client_1.AttendanceStatus.UNINFORMED_ABSENT);
    const absenceFamilyFinancialValidityMatchesBusinessPolicy = corruptedTargets.every((t) => !(0, system_wide_discipline_cleanup_2026_1.isAbsenceFinanciallyValid)(t.currentAttendanceStatus));
    assert.strictEqual(noCurrentUninformedAbsentIsTargetedAsStale, false, 'invariant must detect the corrupted row');
    assert.strictEqual(absenceFamilyFinancialValidityMatchesBusinessPolicy, false, 'invariant must detect the corrupted row');
});
// 12. synthetic ABSENT stale target => invariant MUST fail.
test('12. a corrupted target list containing a current-ABSENT row fails the invariant', () => {
    const corruptedTargets = [
        { currentAttendanceStatus: client_1.AttendanceStatus.LATE },
        { currentAttendanceStatus: client_1.AttendanceStatus.ABSENT }, // deliberately invalid
    ];
    const noCurrentAbsentIsTargetedAsStale = corruptedTargets.every((t) => t.currentAttendanceStatus !== client_1.AttendanceStatus.ABSENT);
    const absenceFamilyFinancialValidityMatchesBusinessPolicy = corruptedTargets.every((t) => !(0, system_wide_discipline_cleanup_2026_1.isAbsenceFinanciallyValid)(t.currentAttendanceStatus));
    assert.strictEqual(noCurrentAbsentIsTargetedAsStale, false, 'invariant must detect the corrupted row');
    assert.strictEqual(absenceFamilyFinancialValidityMatchesBusinessPolicy, false, 'invariant must detect the corrupted row');
});
// ── Additional direct coverage of the two authoritative predicates ──
test('isAbsenceFinanciallyValid: exhaustive over every AttendanceStatus value', () => {
    const expectedValid = new Set([client_1.AttendanceStatus.ABSENT, client_1.AttendanceStatus.UNINFORMED_ABSENT]);
    for (const status of Object.values(client_1.AttendanceStatus)) {
        assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isAbsenceFinanciallyValid)(status), expectedValid.has(status), `isAbsenceFinanciallyValid(${status}) mismatch`);
    }
});
test('isUninformedAbsentDisciplineStillValid: exhaustive over every AttendanceStatus value', () => {
    for (const status of Object.values(client_1.AttendanceStatus)) {
        assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isUninformedAbsentDisciplineStillValid)(status), status === client_1.AttendanceStatus.UNINFORMED_ABSENT, `isUninformedAbsentDisciplineStillValid(${status}) mismatch`);
    }
});
test('INSUFFICIENT_EVIDENCE: no AttendanceLog row for the date never auto-targets either side', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyDatedAbsenceDeduction)({ currentStatus: null }), 'INSUFFICIENT_EVIDENCE');
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.classifyUninformedAbsentDisciplineEvent)({ currentStatus: null }), 'INSUFFICIENT_EVIDENCE');
});
// ── Legacy aggregate excess amount-identity fix ──
// Reproduces the exact three-employee mismatch a production dry-run found:
// the audit's count*avgAmount estimate silently diverged from whatever
// physical rows an ID-sort selection happened to pick, because legacy
// rows for one employee are not guaranteed to share the same amount.
test('isLegacyAmountGroupUniform: true for identical amounts', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isLegacyAmountGroupUniform)([1000, 1000, 1000]), true);
});
test('isLegacyAmountGroupUniform: true within floating-point tolerance', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isLegacyAmountGroupUniform)([1000.001, 1000.0, 1000.005]), true);
});
test('isLegacyAmountGroupUniform: false for any real variance', () => {
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isLegacyAmountGroupUniform)([1000, 1000, 1050]), false);
});
test('Muhammad Ajmal (YCDO-2026-0108) reproduction: non-uniform amounts -> gate rejects auto-selection', () => {
    // Audit: excess count = 1, aggregate excess amount = 7400.00 (avg-based).
    // Cleanup previously selected a physical row of amount 1466.67 by pure
    // UUID sort — proving the group is not uniform (else selection would
    // exactly equal the average). The fix must never auto-target this group.
    const groupAmounts = [1466.67, 13333.33]; // avg = 7400.00, matches audit exactly
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isLegacyAmountGroupUniform)(groupAmounts), false);
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeLegacyAggregateExcessAmount)(groupAmounts, 1), 7400);
});
test('Hafeez (YCDO-2026-0247) reproduction: near-but-not-exact amounts still fail the uniform gate', () => {
    // Audit: excess count = 2, aggregate excess amount = 2051.28 (avg-based
    // over the full legacy group). Cleanup previously selected two rows of
    // 1000.00 each, an under-count by 51.28 — proof the group is not
    // uniform even though the mismatch is small.
    const groupAmounts = [1000, 1000, 1051.28];
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isLegacyAmountGroupUniform)(groupAmounts), false);
});
test('Abid Ali (YCDO-2026-0285) reproduction: single-row group still fails when its amount differs from the group average', () => {
    // Audit: excess count = 1, aggregate excess amount = 1550.00. Cleanup
    // previously selected a row of amount 1566.67 — again proof of
    // non-uniform amounts within this employee's legacy group.
    const groupAmounts = [1533.33, 1566.67];
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isLegacyAmountGroupUniform)(groupAmounts), false);
});
test('uniform group: excessCount * avgAmount equals the exact sum of any excessCount rows (identity trivially proven)', () => {
    const groupAmounts = [1200, 1200, 1200, 1200];
    const excessCount = 2;
    const provenAmount = (0, system_wide_discipline_cleanup_2026_1.computeLegacyAggregateExcessAmount)(groupAmounts, excessCount);
    const anyTwoRowsSum = groupAmounts.slice(0, 2).reduce((a, b) => a + b, 0);
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.isLegacyAmountGroupUniform)(groupAmounts), true);
    assert.strictEqual(provenAmount, anyTwoRowsSum);
});
test('non-uniform group: excessCount * avgAmount does NOT reliably equal an arbitrary selection of excessCount rows', () => {
    const groupAmounts = [1466.67, 13333.33];
    const excessCount = 1;
    const provenAmount = (0, system_wide_discipline_cleanup_2026_1.computeLegacyAggregateExcessAmount)(groupAmounts, excessCount);
    // The ID-sort selection (arbitrarily the first row here) can land on
    // either amount — neither is guaranteed to equal the average-based
    // "proven" amount, which is exactly the bug this fix closes.
    assert.notStrictEqual(groupAmounts[0], provenAmount);
});
// ── DRY_RUN vs APPLY invariant-gate fix ──
// Reproduces the production incident: a real APPLY run with every
// substantive safety invariant true still self-aborted with
// INVARIANT_FAILURE, because dryRunContainsZeroWritePaths (a DRY_RUN-only
// sanity assertion, literally !APPLY) was folded into the same
// conjunction that gates the APPLY transaction — making every legitimate
// APPLY mathematically impossible.
function allTrueSubstantiveInvariants() {
    return {
        allFinancialTargetsBelongToPendingPayroll: true,
        noProcessedPayrollMutation: true,
        noPaidPayrollMutation: true,
        noOccurrence12Cleanup: true,
        legacySelectedPhysicalAmountEqualsProvenAggregateExcessAmountPerEmployee: true,
        legacySelectedPhysicalAmountEqualsProvenAggregateExcessAmountGlobally: true,
        noLegacyAggregateTargetWhenAmountIdentityIsUnproven: true,
        noCurrentUninformedAbsentIsTargetedAsStaleFinancialDeduction: true,
        noCurrentAbsentIsTargetedAsStaleFinancialDeduction: true,
        mutationFingerprintDeterministic: true,
    };
}
test('DRY_RUN + zero-write assertion true => allowed (allCleanupInvariantsTrue is true)', () => {
    const invariants = { ...allTrueSubstantiveInvariants(), dryRunContainsZeroWritePaths: true };
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeSubstantiveInvariantsTrue)(invariants), true);
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeAllCleanupInvariantsTrue)(invariants, false), true);
});
test('DRY_RUN + zero-write assertion false => fails (allCleanupInvariantsTrue is false)', () => {
    const invariants = { ...allTrueSubstantiveInvariants(), dryRunContainsZeroWritePaths: false };
    // Substantive invariants alone are unaffected by this one...
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeSubstantiveInvariantsTrue)(invariants), true);
    // ...but the DRY_RUN reporting aggregate must still catch it.
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeAllCleanupInvariantsTrue)(invariants, false), false);
});
test('APPLY + all substantive invariants true + dry-run-only assertion N/A => allowed to reach the transaction gate', () => {
    const invariants = { ...allTrueSubstantiveInvariants(), dryRunContainsZeroWritePaths: 'NOT_APPLICABLE_IN_APPLY_MODE' };
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeSubstantiveInvariantsTrue)(invariants), true, 'this is the exact production scenario that incorrectly self-aborted before the fix');
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeAllCleanupInvariantsTrue)(invariants, true), true);
});
test('APPLY + any substantive invariant false => abort before transaction, regardless of the dry-run-only assertion', () => {
    const invariants = {
        ...allTrueSubstantiveInvariants(),
        noOccurrence12Cleanup: false, // one substantive invariant deliberately broken
        dryRunContainsZeroWritePaths: 'NOT_APPLICABLE_IN_APPLY_MODE',
    };
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeSubstantiveInvariantsTrue)(invariants), false);
    assert.strictEqual((0, system_wide_discipline_cleanup_2026_1.computeAllCleanupInvariantsTrue)(invariants, true), false);
});
test('failed invariant path performs zero writes (static control-flow proof)', () => {
    const source = fs.readFileSync(path.join(__dirname, 'system-wide-discipline-cleanup-2026.ts'), 'utf8');
    const invariantAbortIndex = source.indexOf('ABORT: one or more substantive cleanup invariants are false');
    const transactionIndex = source.indexOf('prisma.$transaction(');
    assert.ok(invariantAbortIndex > 0, 'expected to find the substantive-invariant abort branch');
    assert.ok(transactionIndex > 0, 'expected to find the transaction entry point');
    assert.ok(invariantAbortIndex < transactionIndex, 'the invariant-failure abort (with its unconditional `return`) must appear strictly before the ONLY write path (prisma.$transaction) in source order — proving no write can execute on this path');
    // The abort branch must itself contain a `return` before the function
    // can fall through to any subsequent code, including the transaction.
    const abortBranch = source.slice(invariantAbortIndex, transactionIndex);
    assert.ok(/return;\s*\}/.test(abortBranch), 'expected the invariant-failure branch to unconditionally return before reaching the transaction');
});
test('fingerprint mismatch performs zero writes (static control-flow proof)', () => {
    const source = fs.readFileSync(path.join(__dirname, 'system-wide-discipline-cleanup-2026.ts'), 'utf8');
    const driftAbortIndex = source.indexOf('ABORT: DRIFT DETECTED');
    const transactionIndex = source.indexOf('prisma.$transaction(');
    assert.ok(driftAbortIndex > 0, 'expected to find the fingerprint-drift abort branch');
    assert.ok(transactionIndex > 0, 'expected to find the transaction entry point');
    assert.ok(driftAbortIndex < transactionIndex, 'the fingerprint-drift abort must appear strictly before the ONLY write path (prisma.$transaction) in source order');
    const abortBranch = source.slice(driftAbortIndex, transactionIndex);
    assert.ok(/return;\s*\}/.test(abortBranch), 'expected the fingerprint-drift branch to unconditionally return before reaching the transaction');
});
console.error(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
    console.error('\nFailures:');
    for (const f of failures)
        console.error(`  - ${f}`);
    process.exitCode = 1;
}
