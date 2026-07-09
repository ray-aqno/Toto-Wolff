---
name: strangler-pattern-guide
description: Use as reference guide for strangler pattern implementation. Provides patterns and best practices for legacy migrations.
version: 1.0.0
metadata:
  mcpmarket-version: 1.0.0
---
# Strangler Pattern Implementation Guide

**Purpose:** Strategic guide for implementing the strangler pattern to migrate controllers from express-web-api to actions.api.

**Related Documents:**
- **Validation:** [strangler-migration-checklist.md](./reference/strangler-migration-checklist.md)
- **Orchestration:** [strangler-pattern-migration.yaml](./reference/strangler-pattern-migration.yaml)

---

## When to Use Strangler Pattern

Use strangler pattern for:
- ✅ **Active endpoints** with existing frontend usage
- ✅ **Complex business logic** that needs gradual migration
- ✅ **High-risk migrations** requiring rollback capability
- ✅ **Live systems** where downtime isn't acceptable

Skip strangler pattern for:
- Simple CRUD operations that can be rewritten quickly
- Unused or deprecated endpoints
- New features without legacy constraints

---

## Architecture Overview

### Express-Web-API (Legacy)
- .NET Framework Web API controllers
- Command/Manager/Service factory patterns
- JWT authentication with custom attributes
- ServiceResponse<T> wrapper pattern

### Actions.API (Target)
- .NET 6+ Minimal API endpoints
- MediatR Command/Request → Handler pattern
- Multiple authentication schemes
- Direct return types with ApiError exceptions

---

## Implementation Pattern

### Simple Controller Strangling (4 Lines)

```csharp
// Express-Web-API Controller - Generic pattern
public async Task<HttpResponseMessage> YourControllerMethod([FromBody] YourRequestModel requestModel)
{
    var tenant = Features.ResolveTenant(Request.Headers);
    if (await FeatureResolverSingleton.GetIsFeatureEnabledAsync(Features.YourFeatureFlag, tenant))
        return CreateResponseMessage(await strangledService.Value.YourMethod(requestModel));

    return CreateResponseMessage(legacyService.Value.YourMethod(requestModel, EyeShareToken));
}
```

**Real Implementation Example (WorkflowController):**
```csharp
// Express-Web-API Controller - Real example from WorkflowController
public async Task<HttpResponseMessage> StartWorkflowExecution([FromBody] EyeShareWorkflowDesignerModel workflowDesigner)
{
    var tenant = Features.ResolveTenant(Request.Headers);
    if (await FeatureResolverSingleton.GetIsFeatureEnabledAsync(Features.WorkflowStrangle, tenant))
        return CreateResponseMessage(await strangledService.Value.StartWorkflowExecution(workflowDesigner));

    return CreateResponseMessage(legacyService.Value.StartWorkflowExecution(workflowDesigner, EyeShareToken));
}
```

### Controller Setup Pattern

```csharp
// Generic pattern for any controller
public class YourController : ApiBaseController
{
    private Lazy<YourLegacyService> legacyService;
    private Lazy<YourStrangledService> strangledService;  // Handles actions.api communication

    public YourController()
    {
        legacyService = new Lazy<YourLegacyService>(() => {
            var token = TokenManager.GetTokenInfo();
            return new YourLegacyService(token, new DalService(token));
        });
        strangledService = new Lazy<YourStrangledService>(() => new YourStrangledService(ControllerContext));
    }
}
```

**Real Implementation Example (WorkflowController):**
```csharp
public class WorkflowController : ApiBaseController
{
    private Lazy<EyeShareWorkflowService> legacyService;
    private Lazy<WorkflowService> strangledService;  // Handles actions.api communication

    public WorkflowController()
    {
        legacyService = new Lazy<EyeShareWorkflowService>(() => {
            var token = TokenManager.GetTokenInfo();
            return new EyeShareWorkflowService(token, new DalService(token));
        });
        strangledService = new Lazy<WorkflowService>(() => new WorkflowService(ControllerContext));
    }
}
```

---

## Actions.API Implementation

### Clean Endpoint Pattern
```csharp
// Actions.API - Generic pattern (no strangler terminology)
app.MapPost("/api/YourController/yourMethod", 
    async (YourRequest request, IMediator mediator) =>
    {
        var result = await mediator.Send(request);
        return Results.Ok(result);
    }).RequireAuthorization();
```

### Request/Handler/Service Pattern
```csharp
// Generic request/response models
public record YourRequest : IRequest<YourResponse>
{
    public YourDataModel Data { get; init; }
}

public class YourRequestHandler : IRequestHandler<YourRequest, YourResponse>
{
    public async Task<YourResponse> Handle(YourRequest request, CancellationToken cancellationToken)
    {
        return await _service.YourMethodAsync(request.Data);
    }
}
```

**Real Implementation Example (WorkflowController):**
```csharp
// Actions.API - No strangler terminology
app.MapPost("/api/Workflow/startExecution", 
    async (StartWorkflowExecutionRequest request, IMediator mediator) =>
    {
        var result = await mediator.Send(request);
        return Results.Ok(result);
    }).RequireAuthorization();

public record StartWorkflowExecutionRequest : IRequest<WorkflowExecutionResponse>
{
    public EyeShareWorkflowDesignerModel WorkflowDesigner { get; init; }
}

public class StartWorkflowExecutionHandler : IRequestHandler<StartWorkflowExecutionRequest, WorkflowExecutionResponse>
{
    public async Task<WorkflowExecutionResponse> Handle(StartWorkflowExecutionRequest request, CancellationToken cancellationToken)
    {
        return await _service.StartWorkflowExecutionAsync(request.WorkflowDesigner);
    }
}
```

---

## TDD Implementation Process

### Phase 1: Capture Real Behavior
1. **Test live endpoint** with authentication
2. **Capture JSON responses** for all scenarios
3. **Document authentication method** (password grant, client credentials)
4. **Record performance baseline**

### Express-Web-API Authentication Pattern
The express-web-api uses a specific authentication flow that differs from standard OAuth2:

```powershell
# Authenticate to express-web-api
$authResponse = Invoke-RestMethod -Uri "http://localhost:52928/api/Auth/token" -Method Post -Body @{
    grant_type = "password"
    client_id = "<YOUR_CLIENT_ID>"
    username = "<YOUR_USERNAME>"
    password = "<YOUR_PASSWORD>"
} -ContentType "application/x-www-form-urlencoded"

# Extract token - IMPORTANT: uses 'token' field, not 'access_token'
$token = $authResponse.token

# Use in API calls
$headers = @{
    'Authorization' = "Bearer $token"
    'Content-Type' = 'application/json'
}

# Test endpoint
$response = Invoke-RestMethod -Uri "http://localhost:52928/Api/{controller}/{method}" -Method Get -Headers $headers
```

**Key Authentication Details:**
- **Endpoint:** `http://localhost:52928/api/Auth/token`
- **Method:** POST
- **Content-Type:** `application/x-www-form-urlencoded`
- **Token Field:** `token` (not `access_token`)
- **Authorization Header:** `Bearer {token}`

### Phase 2: Create Tests (RED)
1. **Create integration tests** in actions.api test suite
2. **Use captured responses** as expected results
3. **Ensure tests fail** before implementation
4. **Follow existing test patterns** (ActionsApiFactory, DatabaseFixture)

### Phase 3: Implement (GREEN)
1. **Build minimal implementation** to pass tests
2. **Preserve exact behavior** from captured responses
3. **Follow actions.api patterns** (Request/Handler/Service)
4. **Integrate with existing auth/db**

### Phase 4: Strangler Integration
1. **Modify express-web-api controller** with feature flag
2. **Set up lazy-loaded services**
3. **Enable gradual traffic switching**
4. **Test dual-path validation**

---

## Key Integration Points

### Authentication
- **Express-web-api:** JWT via custom attributes
- **Actions.api:** Multiple schemes (JWT/MasterToken/TenantToken)
- **Bridge:** Service layer handles auth forwarding

### Database Context
- **Express-web-api:** Custom DbContext patterns
- **Actions.api:** TenantDbContext with IDbContextResolver
- **Migration:** Update entity mappings and queries

### Response Formats
- **Express-web-api:** ServiceResponse<T> wrapper
- **Actions.api:** Direct Results pattern
- **Bridge:** CreateResponseMessage() unifies response format

### Feature Flags
- **Location:** Express-web-api controllers only
- **Pattern:** FeatureResolverSingleton.GetIsFeatureEnabledAsync
- **Scope:** Per-tenant or per-user switching

---

## Success Criteria

✅ **Feature flag routing works** between legacy and new systems
✅ **Response behavior identical** to captured baseline
✅ **All tests pass** in actions.api integration suite
✅ **No regressions** in existing functionality
✅ **Performance maintains** or exceeds baseline
✅ **Rollback capability** tested and verified

---

## Quick Reference

**For Implementation:**
1. Follow the 4-line controller pattern from WorkflowController
2. Use lazy-loaded services for performance
3. Keep actions.api implementation clean (no strangler references)
4. Test with real captured data, not mock responses

**For Validation:**
- Use [strangler-migration-checklist.md](./reference/strangler-migration-checklist.md) for systematic verification

**For Process:**
- Follow [strangler-pattern-migration.yaml](./reference/strangler-pattern-migration.yaml) workflow orchestration

---

## Signal Loop Protocol

Before generating a migration plan, query `/vault/signal` to load active governance verdicts.
Three branches — handle all three before writing the plan:

| Endpoint result | Meaning | Plan stamp |
|---|---|---|
| ECONNREFUSED (port closed) | Server not running — cold start | `cold-start` |
| 200 + `[]` (empty array) | Server up, no active signals | `cold-start` |
| 200 + non-empty array | Active signals loaded | `loop-informed` |

**Cold-start** — proceed with plan generation. Do NOT claim loop influence. Stamp the plan header:
```
session_verdicts: []
loop_informed: false
```

**Loop-informed** — the plan MUST cite every consumed verdict ID as structured output in the plan header:
```
session_verdicts: ["adr-0005-ordercontroller-auth-extraction"]
loop_informed: true
```

After plan generation, run `checkProvenance(citedIds, sessionIds)`:
- `ok: true` — provenance verified; continue to tiered veto
- `ok: false` — cited IDs not in session response; plan is rejected (do not write to vault)

**Tiered veto (active — runs after provenance passes):**

Call the `score_confidence` MCP tool (POST to the MCP server) with `{ records, now }` where `records` is the full array returned by `/vault/signal` and `now` is today's date in `YYYY-MM-DD` format. This is a deterministic tool call — not prose reasoning.

| Tier | Condition | Action |
|------|-----------|--------|
| `HIGH` | ≥2 distinct in-date records, all patterns known, Jaccard≥0.5 | Proceed — write plan to vault automatically |
| `LOW` | Any clause fails (novel pattern, expired record, count < 2, Jaccard < 0.5) | **HALT** — do not write plan; surface disqualifiers to user and request a ruling via `/council` |

When tier is LOW, output the disqualifiers verbatim:
```
TIERED VETO — LOW confidence. Plan write halted.
Disqualifiers:
  - <disqualifier 1>
  - <disqualifier 2>
Run /council to issue a fresh ruling before retrying.
```

When tier is HIGH, stamp the plan header with `confidence_tier: HIGH` before vault write.
