<!-- Powered by PRISM™ System -->

# Strangler Pattern Migration Checklist

**Purpose:** Validation checklist for strangler pattern migration steps.

**Related Resources:**
- **Skill Documentation:** [Strangler Pattern Guide SKILL.md](../SKILL.md)

**Instructions:** Mark `[x]` for completed, `[N/A]` if not applicable.

---

## ✅ Phase 1: Behavior Capture

### Endpoint Discovery
- [ ] Live endpoint URL identified and accessible
- [ ] Frontend code analyzed for actual endpoint usage
- [ ] Authentication method discovered (password grant/client credentials)
- [ ] Valid test credentials obtained

### Response Capture
- [ ] Successful authentication achieved with live endpoint
- [ ] Complete JSON responses captured for valid scenarios
- [ ] Error responses captured (401, 403, 404, 500)
- [ ] Performance baseline recorded
- [ ] Response files saved for test creation

---

## ✅ Phase 2: Test Creation

### Integration Test Setup
- [ ] Test file created in actions.api Integration.Tests/Endpoints/
- [ ] ActionsApiFactory, DatabaseFixture, SmtpFixture integrated
- [ ] Collection attribute added for test isolation
- [ ] Proper authentication setup using GetJwtBearerToken()

### Test Coverage
- [ ] Happy path tests created using captured responses
- [ ] Error scenario tests created for each captured error
- [ ] Test data fixtures created in TestEnvironment/Data/
- [ ] All tests initially fail (RED state confirmed)

---

## ✅ Phase 3: Implementation

### Actions.API Endpoint
- [ ] Minimal API endpoint created with proper route
- [ ] Request/Response models defined
- [ ] Handler created following MediatR pattern
- [ ] Service implementation created
- [ ] Validator created using AbstractValidator<T>

### Registration
- [ ] Endpoint registered in EndpointRegistrar.cs
- [ ] Services registered in ServiceRegistrar.cs
- [ ] Database entities mapped if needed
- [ ] Authentication/authorization configured

### Test Validation
- [ ] All integration tests pass (GREEN state)
- [ ] Response format matches captured behavior exactly
- [ ] Performance meets or exceeds baseline
- [ ] No regressions in existing test suite

---

## ✅ Phase 4: Strangler Integration

### Express-Web-API Controller
- [ ] Feature flag added to Features enum
- [ ] Lazy-loaded services setup in controller constructor
- [ ] 4-line strangling pattern implemented in target method
- [ ] CreateResponseMessage() wrapping maintained for both paths

### Service Layer
- [ ] Strangled service created to communicate with actions.api
- [ ] HTTP client configuration for actions.api calls
- [ ] Authentication forwarding implemented
- [ ] Error handling and fallback logic tested

---

## ✅ Phase 5: Validation

### Dual-Path Testing
- [ ] Feature flag ON: Routes to actions.api successfully
- [ ] Feature flag OFF: Routes to legacy system successfully
- [ ] Response equivalence verified between both paths
- [ ] Performance impact acceptable for HTTP forwarding

### Production Readiness
- [ ] Full integration test suite passes
- [ ] No regressions in existing functionality
- [ ] Feature flag rollback tested and working
- [ ] Monitoring and logging configured

---

## ✅ Phase 6: Completion

### Deployment
- [ ] Feature flag deployed and configurable per tenant
- [ ] Gradual rollout plan executed
- [ ] Production monitoring shows healthy metrics
- [ ] User acceptance testing completed

### Cleanup (Future)
- [ ] Legacy endpoint marked for deprecation
- [ ] Migration metrics documented
- [ ] Team knowledge transfer completed
- [ ] Documentation updated
