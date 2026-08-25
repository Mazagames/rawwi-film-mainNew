import assert from 'node:assert/strict';
import { getPublicAnalysisErrorMessage } from './raawiAiError';

assert.equal(getPublicAnalysisErrorMessage('429 no credits remaining'), 'GPU Overheat');
assert.equal(getPublicAnalysisErrorMessage('Gemini model not found'), 'AI service temporarily unavailable.');
assert.equal(getPublicAnalysisErrorMessage('request timed out'), 'Server is busy, please try again later.');
assert.equal(getPublicAnalysisErrorMessage('Analysis cancelled by user.'), 'Analysis stopped.');
assert.equal(getPublicAnalysisErrorMessage('ordinary error'), 'ordinary error');

console.log('✓ analysis errors map to safe user-facing messages');
