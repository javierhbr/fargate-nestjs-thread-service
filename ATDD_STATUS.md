# ATDD Setup Status

## ✅ Completed

1. **Cucumber & TypeScript Configuration**
   - ✅ Installed @cucumber/cucumber
   - ✅ Created cucumber.config.js
   - ✅ Created tsconfig.cucumber.json
   - ✅ Configured ts-node for TypeScript compilation
   - ✅ Set up test directory structure

2. **In-Memory Adapters** (7/7 Complete)
   - ✅ InMemoryJobRepositoryAdapter
   - ✅ InMemoryExportApiAdapter
   - ✅ InMemoryFileStorageAdapter
   - ✅ InMemoryMessageQueueAdapter
   - ✅ InMemoryWorkerPoolAdapter
   - ✅ InMemoryEventPublisherAdapter
   - ✅ InMemoryStepFunctionsAdapter

3. **Test Infrastructure**
   - ✅ Cucumber World class (ExportJobWorld)
   - ✅ Before/After hooks
   - ✅ Test context management

4. **Feature Files**
   - ✅ start-export-job.feature (6 scenarios)
   - ✅ complete-job.feature (6 scenarios)
   - ✅ end-to-end-export-workflow.feature (5 scenarios)

5. **Step Definitions** (Created but need fixes)
   - ✅ start-export-job-steps.ts
   - ✅ complete-job-steps.ts
   - ✅ end-to-end-steps.ts

6. **Documentation**
   - ✅ Main README
   - ✅ Quick Start Guide
   - ✅ Architecture Documentation
   - ✅ TODO roadmap

## ⚠️ Needs Fixing

### 1. Assertion Library Syntax

**Issue**: Step definitions use Jest-style assertions (`toBe`, `toBeDefined`) but Chai has different syntax.

**Jest syntax (current)**:
```typescript
expect(value).toBe(expected);
expect(value).toBeDefined();
expect(value).toBeGreaterThan(0);
expect(value).toContain('text');
```

**Chai syntax (needed)**:
```typescript
expect(value).to.equal(expected);
expect(value).to.not.be.undefined;
expect(value).to.be.greaterThan(0);
expect(value).to.include('text');
```

**Files to fix**:
- `test/acceptance/step-definitions/start-export-job-steps.ts`
- `test/acceptance/step-definitions/complete-job-steps.ts`
- `test/acceptance/step-definitions/end-to-end-steps.ts`

### 2. Domain Entity Usage

**Issue**: `ExportJobEntity` has a private constructor and needs to be created via factory method.

**Current (incorrect)**:
```typescript
const job = new ExportJobEntity(jobId, exportId, userId, jobState);
```

**Correct**:
```typescript
const job = ExportJobEntity.create({
  jobId,
  exportId,
  userId,
  jobState,
  metadata: {},
  maxPollingAttempts: 120,
  pollingIntervalMs: 5000,
});
```

**File to fix**:
- `test/acceptance/step-definitions/complete-job-steps.ts` (line 55)

### 3. JobStatusVO Usage

**Issue**: `JobStatusVO.DOWNLOADING` doesn't exist - it's a factory method.

**Current (incorrect)**:
```typescript
status: JobStatusVO.DOWNLOADING
```

**Correct**:
```typescript
status: JobStatusVO.downloading().value  // or just use the string 'DOWNLOADING'
```

**File to fix**:
- `test/acceptance/step-definitions/complete-job-steps.ts` (line 60)

### 4. Read-only Property

**Issue**: `taskToken` is readonly and cannot be assigned after creation.

**Current (incorrect)**:
```typescript
job.taskToken = taskToken;
```

**Correct**: Include taskToken in the factory method:
```typescript
const job = ExportJobEntity.create({
  ...props,
  taskToken,
});
```

**File to fix**:
- `test/acceptance/step-definitions/complete-job-steps.ts` (line 97)

## 🔧 Quick Fixes

### Option 1: Run Simple Test (Recommended for Now)

A simple working test exists at `test/acceptance/features/simple-test.feature`.

To see the ATDD infrastructure working:

```bash
# Run just the simple test (once fixed)
TS_NODE_PROJECT=tsconfig.cucumber.json npx cucumber-js test/acceptance/features/simple-test.feature --require 'test/acceptance/**/*.ts' --require-module ts-node/register
```

### Option 2: Fix All Step Definitions

Create a helper script to convert all assertions:

```bash
# Convert toBe() to .to.equal()
# Convert toBeDefined() to .to.not.be.undefined
# Convert toBeGreaterThan() to .to.be.greaterThan()
# Convert toContain() to .to.include()
# Convert toBeNull() to .to.be.null
```

### Option 3: Use Node's Assert (Simpler)

Replace Chai with Node's built-in `assert`:

```typescript
import { strict as assert } from 'assert';

// Instead of: expect(value).toBe(expected)
assert.equal(value, expected);

// Instead of: expect(value).toBeDefined()
assert.ok(value !== undefined);

// Instead of: expect(value).toBeGreaterThan(0)
assert.ok(value > 0);
```

## 📝 Next Steps

### Immediate (to get tests running):

1. **Fix simple-test-steps.ts** - Update Chai assertions
2. **Run simple test** - Verify infrastructure works
3. **Fix one complete feature** - Start with start-export-job
4. **Gradually fix remaining features**

### Alternative Approach:

1. **Use Node assert** - Simpler, no library issues
2. **Fix domain entity creation** - Use factory methods correctly
3. **Run all tests** - Verify end-to-end

## 🎯 Current Working Command

```bash
# This shows Cucumber is working and loading files:
TS_NODE_PROJECT=tsconfig.cucumber.json npx cucumber-js \
  test/acceptance/features/simple-test.feature \
  --require 'test/acceptance/**/*.ts' \
  --require-module ts-node/register
```

Output shows TypeScript compilation errors, which means:
- ✅ Cucumber is finding feature files
- ✅ Cucumber is loading step definitions
- ✅ TypeScript is compiling
- ⚠️ Need to fix syntax errors

## 📦 Current Dependencies

```json
{
  "@cucumber/cucumber": "^12.4.0",
  "@cucumber/pretty-formatter": "^2.4.1",
  "chai": "^4.5.0",
  "@types/chai": "^5.2.3",
  "ts-node": "^10.9.2",
  "tsconfig-paths": "^4.2.0"
}
```

## 🚀 Success Criteria

Tests will be fully working when:

1. All assertions use correct Chai syntax
2. Domain entities created via factory methods
3. Value objects used correctly
4. All TypeScript errors resolved
5. Tests run with `npm run test:atdd`

## 💡 Recommendation

**For immediate success**: Fix the `simple-test` to demonstrate the infrastructure works, then document the Chai syntax patterns for future feature development.

**For complete setup**: Create a helper file with common assertion patterns that abstract away the assertion library, making it easy to swap libraries if needed.

Example helper:
```typescript
// test/acceptance/support/assertions.ts
export const assertions = {
  equals: (actual: any, expected: any) => expect(actual).to.equal(expected),
  defined: (value: any) => expect(value).to.not.be.undefined,
  greaterThan: (actual: number, expected: number) => expect(actual).to.be.greaterThan(expected),
  includes: (actual: string, expected: string) => expect(actual).to.include(expected),
};
```

This way, step definitions can use a consistent API regardless of the underlying library.
