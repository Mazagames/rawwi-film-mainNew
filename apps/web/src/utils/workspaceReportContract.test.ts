import assert from 'node:assert/strict';
import { resolvePolledReportId, validateSelectedReport } from './workspaceReportContract';

assert.equal(resolvePolledReportId(undefined), null);
assert.equal(resolvePolledReportId(null), null);
assert.equal(resolvePolledReportId({}), null);
assert.equal(resolvePolledReportId({ id: '  ' }), null);
assert.equal(resolvePolledReportId({ id: 'report-1' }), 'report-1');

const report = { id: 'report-1', jobId: 'job-1', scriptId: 'script-1', versionId: 'version-1' };
assert.equal(validateSelectedReport(report), report);
assert.throws(() => validateSelectedReport(null), /Selected report is missing report\.id/);
assert.throws(() => validateSelectedReport({ id: 'report-1' }), /Selected report is missing jobId/);
assert.throws(() => validateSelectedReport({ id: '  ', jobId: 'job-1' }), /Selected report is missing report\.id/);
assert.throws(() => validateSelectedReport({ id: 'report-1', jobId: 'job-1', scriptId: 'script-1' }), /Selected report is missing versionId/);

console.log('✓ Workspace report contract handles absent polling reports and validates selected report identity');
