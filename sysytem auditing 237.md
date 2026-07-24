# System Auditing 237

This document audits the current analysis engine in this repository from the moment a script enters the workspace until the final report is produced.

It reflects the live baseline after the hybrid cleanup work:
- The active runtime path is the multi-pass analysis engine in `apps/worker/src/pipeline.ts` and `apps/worker/src/multiPassJudge.ts`.
- Historical hybrid folders and labels were removed from the live worker path.
- Prompt bodies live in source files and markdown prompt packs, while the database stores prompt versions, hashes, job snapshots, findings, memory artifacts, and reports.

## Executive Summary

The system is split into four stages:
1. Upload and script registration in Supabase functions.
2. Extraction and chunking into `analysis_jobs` and `analysis_chunks`.
3. Worker execution with router + multi-pass judge + optional memory layers.
4. Aggregation into `analysis_findings` and `analysis_reports`.

The original analysis engine is still fundamentally a multi-pass detector per script chunk. The pass framework is what drives the real analysis, not the removed hybrid folder.

## End-To-End Flow

### 1) Upload

File upload starts in [`supabase/functions/upload/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency/rawwi-film-mainNew/supabase/functions/upload/index.ts).

What it does:
- Requires auth.
- Creates a signed upload URL in the `scripts` bucket.
- Returns a URL that the frontend can use to upload the script file directly to Supabase Storage.
- Rewrites the returned URL origin for the current deployment environment when needed.

What is stored here:
- No analysis happens yet.
- The uploaded file is only the input asset for the next stages.

### 2) Script Registration

Script metadata is managed in [`supabase/functions/scripts/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/scripts/index.ts).

What it does:
- Creates or updates script rows.
- Accepts fields like `story_summary`, `script_summary_pdf_url`, `has_security_scenes`, and `security_content_attachment_url`.
- Can create quick-analysis records.
- Can trigger extraction after a script is created or updated.

Important storage note:
- The script table is the source of truth for the uploaded document metadata.
- The extraction pipeline expects the extra columns above to exist; if they are missing, the script endpoints fail with 500s.

### 3) Extraction Job Creation

The extraction step is in [`supabase/functions/extract/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/extract/index.ts).

What it does:
- Loads the uploaded file from the `scripts` bucket, with legacy support for `uploads`.
- Normalizes and cleans the text.
- Splits the script into `analysis_chunks`.
- Creates an `analysis_jobs` row.
- Writes a `config_snapshot` with prompt versions and hashes.
- Records the analysis memory mode from `app_settings.analysis_memory_mode`.

What gets stored:
- `analysis_jobs`
- `analysis_chunks`
- prompt versions and hashes inside `analysis_jobs.config_snapshot`

This is the first point where the analysis engine becomes an explicit job in the database.

### 4) Worker Pickup

The worker entry point is [`apps/worker/src/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/index.ts).

What it does:
- Polls for pending work.
- Handles extraction jobs and analysis jobs.
- Sends chunk work into the analysis pipeline.
- Logs runtime config and job signatures.

The worker is the place where the actual analysis model prompts are assembled and executed.

### 5) Pipeline Dispatch

[`apps/worker/src/pipelineRunner.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20raawi-film-mainNew/apps/worker/src/pipelineRunner.ts) decides which pipeline version is used.

Current behavior:
- The current runtime path is the baseline pipeline.
- The chunk analysis work is handed to `processChunkJudgeV1` in `apps/worker/src/pipeline.ts`.
- The pipeline still runs multi-pass detection for every chunk.

## Prompt Inventory

### Shared Prompt Constants

These files hold the shared system messages and prompt version metadata:
- [`apps/worker/src/aiConstants.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/aiConstants.ts)
- [`supabase/functions/_shared/aiConstants.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/_shared/aiConstants.ts)

They define:
- `PROMPT_VERSIONS`
- `ROUTER_SYSTEM_MSG`
- `JUDGE_SYSTEM_MSG`
- `REPAIR_SYSTEM_MSG`
- `AUDITOR_SYSTEM_MSG`
- `RATIONALE_ONLY_SYSTEM_MSG`
- lexicon injection helpers

These prompts are not stored in the database as full text. Instead:
- Their versions are written into job snapshots.
- Their SHA hashes are recorded for traceability.
- The worker and Supabase functions both use the same shared source-of-truth strings.

### Multi-Pass Prompt Builders

The pass-specific detection prompts live in:
- [`apps/worker/src/multiPassJudge.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/multiPassJudge.ts)

That file contains the inline pass builders:
- `buildGlossaryPrompt`
- `buildInsultsPrompt`
- `buildViolencePrompt`
- `buildSexualContentPrompt`
- `buildDrugsPrompt`
- `buildDiscriminationPrompt`
- `buildWomenPrompt`
- `buildNationalSecurityPrompt`
- `buildExtremismPrompt`
- `buildMisinformationPrompt`
- `buildInternationalPrompt`

### Prompt Packs on Disk

The modular prompt content is stored as markdown files and loaded by the prompt packs.

V3 prompt pack:
- [`apps/worker/src/v3PromptPack.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/v3PromptPack.ts)
- Loads markdown from `docs/V3 prompts/`

V3 files:
- `01_religious_fundamentals.md`
- `02_political_leadership.md`
- `03_national_security.md`
- `04_historical_unreliable.md`
- `05_society_identity.md`
- `06_children_crime.md`
- `07_drugs_alcohol.md`
- `08_child_disability_harm.md`
- `09_inappropriate_sexual_content.md`
- `10_explicit_sexual_scenes.md`
- `11_profanity.md`
- `12_women_abuse.md`
- `13_family_values.md`
- `14_parents_abuse.md`
- `15_elderly_abuse.md`
- `16_bullying.md`
- `17_other.md`

V4 prompt pack:
- [`apps/worker/src/v4PromptPack.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/v4PromptPack.ts)
- Loads markdown from `docs/V4 prompts/`

V4 files:
- `01_religious_fundamentals.md`
- `02_state_leadership.md`
- `03_national_security.md`
- `04_historical_documentary_reliability.md`
- `05_society_identity_generalization.md`
- `06_children_crime_security.md`
- `07_drugs_alcohol_manufacture.md`
- `08_child_disability_harm.md`
- `09_lgbtq_positive_advocacy.md`
- `10_explicit_sexual_scenes.md`
- `11_profanity.md`
- `12_other.md`

## Pass Structure

### Total Pass Count

The exact pass count depends on the active violation-system version:
- Legacy mode: 11 passes.
- V3 subject mode: 18 passes total.
- V4 subject mode: 13 passes total.

The active set is exposed through `DETECTION_PASSES` in [`apps/worker/src/multiPassJudge.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/multiPassJudge.ts).

### Legacy 11-Pass Detector

These are the core passes in the baseline detector:
1. `glossary` - normalize terminology and collect lexicon anchors.
2. `insults` - detect profanity, insults, bullying, and direct abuse.
3. `violence` - detect physical harm, threats, and violent acts.
4. `sexual_content` - detect sexual scenes or explicit sexual material.
5. `drugs_alcohol` - detect drug use, alcohol use, and related behavior.
6. `discrimination_incitement` - detect hate, discrimination, or incitement.
7. `women` - detect abuse or harmful treatment targeting women.
8. `national_security` - detect state-security or sensitive security content.
9. `extremism_banned_groups` - detect extremist references or banned groups.
10. `misinformation` - detect unreliable, false, or misleading claims.
11. `international_relations` - detect politically sensitive or relationship-related content.

### What Each Pass Does In Practice

Each pass:
- Builds a pass-specific prompt.
- Appends the article list selected for that chunk.
- Appends the chunk text.
- Optionally appends a per-pass user prompt addition.
- Calls the judge model.
- Parses JSON output.
- Repairs malformed JSON if needed.
- Tags the findings with `detection_pass`.

### V3 and V4 Subject Expansion

When the active violation system is V3 or V4, the detector uses `glossary + subject prompts`.

That means the system is not only checking the broad 11 legacy categories. It also runs deeper subject prompts such as:
- religious fundamentals
- political/state leadership
- historical reliability
- society/identity generalization
- children/crime/security
- drugs/alcohol manufacture
- child disability harm
- explicit sexual scenes
- profanity
- women abuse
- family values
- parents abuse
- elderly abuse
- bullying
- other

The subject list is versioned by the prompt pack:
- V3 has 17 subject definitions.
- V4 has 12 subject definitions.

## Prompt Execution Flow

### Router

The router prompt is built in `apps/worker/src/openai.ts`.

Inputs:
- the chunk text
- candidate GCAM articles
- the system router prompt

Purpose:
- Select which GCAM articles are relevant to the chunk.
- Reduce the amount of article context sent to the judge.

### Judge

The judge prompt is also built in `apps/worker/src/openai.ts`.

Inputs:
- selected article snippets
- chunk text
- the judge system prompt
- any pass-specific prompt additions

Purpose:
- Detect all applicable violations.
- Return structured JSON findings.

### Repair

If the judge output is broken JSON, `REPAIR_SYSTEM_MSG` is used to repair the response.

Purpose:
- Return valid JSON only.
- Preserve the analysis result when parsing fails.

### Auditor and Rationale

The worker also contains:
- `AUDITOR_SYSTEM_MSG`
- `RATIONALE_ONLY_SYSTEM_MSG`

These support downstream audit or rationale-only flows. They are part of the prompt library, even if not every path uses them on every run.

## Memory System

### Memory Mode Source

Memory mode is controlled by `analysis_memory_mode` in the `app_settings` table.

The relevant code paths are:
- [`supabase/functions/settings/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/settings/index.ts)
- [`supabase/functions/extract/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/extract/index.ts)
- [`supabase/functions/tasks/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/tasks/index.ts)

Supported values:
- `memory1`
- `memory2`

### Memory1

Memory1 is the baseline mode.

What it does:
- Uses the standard chunk text and prompt context.
- Does not persist the richer memory artifacts.

### Memory2

Memory2 adds a staged memory layer on top of the baseline detector.

The code lives in:
- [`apps/worker/src/pipelineV2.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/pipelineV2.ts)
- [`apps/worker/src/pipelineV2/contextMemory.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/pipelineV2/contextMemory.ts)
- [`apps/worker/src/pipelineV2/sceneMemory.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/pipelineV2/sceneMemory.ts)
- [`apps/worker/src/pipelineV2/scriptMemory.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/pipelineV2/scriptMemory.ts)
- [`apps/worker/src/pipelineV2/stagedMemory2.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/pipelineV2/stagedMemory2.ts)
- [`apps/worker/src/pipelineV2/memory2Persistence.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/pipelineV2/memory2Persistence.ts)

What the memory stack does:
- `contextMemory` captures nearby text and local dialogue hints.
- `sceneMemory` tracks the current and adjacent scene context.
- `scriptMemory` builds a broader script-level memory and may use a cached script summary.
- `stagedMemory2` merges the memory pieces into a budgeted prompt context.
- `memory2Persistence` stores the memory artifacts when the job is in `memory2` mode.

### Memory Persistence Tables

Memory-related persistence goes into:
- `analysis_script_summaries`
- `analysis_memory_units`
- `analysis_memory_traces`

Meaning:
- The memory system is not just in-process context.
- It also leaves an audit trail in the database for inspection and debugging.

## Final Report

### Findings Persistence

Findings are stored in `analysis_findings`.

Relevant code paths:
- [`apps/worker/src/pipeline.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/pipeline.ts)
- [`apps/worker/src/aggregation.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/aggregation.ts)
- [`supabase/functions/findings/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/findings/index.ts)

What happens:
- Findings are upserted into `analysis_findings`.
- Aggregates are recomputed.
- Findings are sorted, deduped, and attached to the report model.

### Report Assembly

The final report is assembled in:
- [`apps/worker/src/aggregation.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/aggregation.ts)
- [`supabase/functions/reports/index.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/supabase/functions/reports/index.ts)

What it stores:
- `analysis_reports.summary_json`
- `analysis_reports.report_html`
- counts and severity totals
- review state
- job/script linkage

When the pipeline finishes and no chunks are left pending, aggregation builds the final summary and marks the job complete.

## Traceability And Debugging

The system keeps traceability in several places:
- `analysis_jobs.config_snapshot`
- `analysis_execution_signatures`
- `analysis_memory_traces`
- `analysis_script_summaries`
- `analysis_reports.summary_json`

This means the analysis is reproducible enough to answer:
- which prompt version ran
- which hash was used
- which engine version was selected
- which memory mode was active
- which pass produced the finding

## What Is Not Active

These are not part of the live runtime path after cleanup:
- `methodology-v3` folder logic
- `policyV1` folder logic
- old hybrid branch labels in the active worker path

Important clarification:
- `v3` and `v4` are not the removed hybrid system.
- They are prompt-pack versions used by the same live multi-pass engine.
- The removed system was the old folder-based hybrid architecture, not these prompt versions.

The engine that remains active is the baseline multi-pass detector with optional memory2 staging, not the removed hybrid folder structure.

## OpenAI Contract

This is the exact shape of what the worker sends and receives.

### Router Request

Code path:
- [`apps/worker/src/openai.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/openai.ts)

Sent to OpenAI:
- `system`: `routerSystemPrompt || ROUTER_SYSTEM_MSG`
- `user`: list of candidate articles + chunk text + instruction to return `candidate_articles`
- `response_format`: `json_object`

Returned JSON shape:
```json
{
  "candidate_articles": [
    { "article_id": 1, "confidence": 0.92 }
  ],
  "notes_ar": "optional"
}
```

### Judge Request

Code path:
- [`apps/worker/src/openai.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/openai.ts)

Sent to OpenAI:
- `system`: `judgeSystemPrompt || JUDGE_SYSTEM_MSG`
- `user`: selected article payload + chunk text + hard formatting rules + optional pass-specific addition
- `response_format`: `json_object`

Returned JSON shape:
```json
{
  "findings": [
    {
      "article_id": 5,
      "atom_id": "5-2",
      "canonical_atom": "DISCRIMINATION",
      "intensity": 3,
      "context_impact": 2,
      "legal_sensitivity": 3,
      "audience_risk": 3,
      "title_ar": "مخالفة محتوى",
      "description_ar": "",
      "severity": null,
      "confidence": 0.87,
      "is_interpretive": false,
      "rationale_ar": "..."
    }
  ]
}
```

Notes:
- `severity` is not required from the model; the backend computes it.
- `evidence_snippet` and `location` are also part of the parsed schema.
- The worker accepts a damaged JSON response and can run a repair pass.

### Repair Request

If the judge JSON is broken, the worker uses `REPAIR_SYSTEM`.

Returned shape:
```json
{
  "findings": []
}
```

### Auditor Request

The auditor path uses:
- `AUDITOR_SYSTEM_MSG`

Returned shape:
```json
{
  "assessments": [
    {
      "canonical_finding_id": "uuid",
      "title_ar": "مخالفة محتوى",
      "final_ruling": "violation",
      "rationale_ar": "..."
    }
  ]
}
```

## Exact Prompt Sources By Version

### v2

`v2` is the baseline analysis engine label used by the worker and task snapshot.

What it uses:
- Shared system prompts from [`apps/worker/src/aiConstants.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/aiConstants.ts)
- The multi-pass pass builders in [`apps/worker/src/multiPassJudge.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/multiPassJudge.ts)

v2 passes:
- `glossary`
- `insults`
- `violence`
- `sexual_content`
- `drugs_alcohol`
- `discrimination_incitement`
- `women`
- `national_security`
- `extremism_banned_groups`
- `misinformation`
- `international_relations`

Prompt construction for each v2 pass:
- system prompt: shared judge prompt
- user prompt: selected article payload + chunk text + mandatory JSON instructions + any pass-specific addition

### v3

`v3` is a prompt-pack version of the same multi-pass engine.

What it uses:
- [`apps/worker/src/v3PromptPack.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/v3PromptPack.ts)
- markdown files in `docs/V3 prompts/`
- pass builders in [`apps/worker/src/multiPassJudge.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/multiPassJudge.ts)

v3 prompt files:
- `01_religious_fundamentals.md`
- `02_political_leadership.md`
- `03_national_security.md`
- `04_historical_unreliable.md`
- `05_society_identity.md`
- `06_children_crime.md`
- `07_drugs_alcohol.md`
- `08_child_disability_harm.md`
- `09_inappropriate_sexual_content.md`
- `10_explicit_sexual_scenes.md`
- `11_profanity.md`
- `12_women_abuse.md`
- `13_family_values.md`
- `14_parents_abuse.md`
- `15_elderly_abuse.md`
- `16_bullying.md`
- `17_other.md`

v3 output:
- Same JSON judge contract.
- Each pass returns `{ "findings": [] }` or a `findings` array with the schema above.

### v4

`v4` is another prompt-pack version of the same multi-pass engine.

What it uses:
- [`apps/worker/src/v4PromptPack.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/v4PromptPack.ts)
- markdown files in `docs/V4 prompts/`
- pass builders in [`apps/worker/src/multiPassJudge.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/multiPassJudge.ts)

v4 prompt files:
- `01_religious_fundamentals.md`
- `02_state_leadership.md`
- `03_national_security.md`
- `04_historical_documentary_reliability.md`
- `05_society_identity_generalization.md`
- `06_children_crime_security.md`
- `07_drugs_alcohol_manufacture.md`
- `08_child_disability_harm.md`
- `09_lgbtq_positive_advocacy.md`
- `10_explicit_sexual_scenes.md`
- `11_profanity.md`
- `12_other.md`

v4 output:
- Same JSON judge contract.
- Same `findings` array shape.

## Violation Context Map

This is the missing layer between the filename and the analysis meaning: what each pass is actually trying to detect.

### v2 Context Map

| Pass | Context | What the prompt is looking for |
|---|---|---|
| `glossary` | Lexicon-driven exact-match scanning | A literal match against forbidden terms and their derivatives, with no interpretation. |
| `insults` | Verbal abuse and humiliation | Direct insults, degrading nicknames, contempt, mockery, and clear verbal put-downs. |
| `violence` | Physical harm and threats | Threats, assault, bodily harm, weapon use, or any clear violent act. |
| `sexual_content` | Sexual material | Sexual scenes, explicit sexual language, or clear sexualized content. |
| `drugs_alcohol` | Substance-related content | Drug use, alcohol use, possession, promotion, or related substance references. |
| `discrimination_incitement` | Hate and exclusion | Discrimination, incitement, prejudice, or derogatory treatment of protected groups. |
| `women` | Abuse targeting women | Insults, coercion, humiliation, violence, or degrading treatment directed at women. |
| `national_security` | State and security sensitivity | Security-sensitive political or state content, threats to order, or highly sensitive national matters. |
| `extremism_banned_groups` | Extremism and banned entities | Praise, support, mention, or normalization of extremist or banned groups. |
| `misinformation` | False or unreliable claims | Misleading, historically unreliable, or factually dubious content. |
| `international_relations` | Diplomatic and foreign-relations sensitivity | Foreign policy, external relations, and politically sensitive international references. |

### v3 Context Map

`v3` adds a subject-oriented layer on top of the same multi-pass engine. Each subject has a dedicated prompt file and a narrow meaning.

| Subject | Prompt file | Context |
|---|---|---|
| `v3_01_religious_fundamentals` | `01_religious_fundamentals.md` | Direct religious offense, disrespect, or attack on religious fundamentals. |
| `v3_02_political_leadership` | `02_political_leadership.md` | Content that insults or attacks leadership, authority, or political figures. |
| `v3_03_national_security` | `03_national_security.md` | Security-sensitive content involving the state, threats, conflict, or destabilizing references. |
| `v3_04_historical_unreliable` | `04_historical_unreliable.md` | Historical claims that are unreliable, distorted, or unsupported. |
| `v3_05_society_identity` | `05_society_identity.md` | Harmful generalizations or insults about society, identity, or national character. |
| `v3_06_children_crime` | `06_children_crime.md` | Criminal behavior involving children or content that pushes children toward crime. |
| `v3_07_drugs_alcohol` | `07_drugs_alcohol.md` | Drug/alcohol references, especially promotion or normalization. |
| `v3_08_child_disability_harm` | `08_child_disability_harm.md` | Harm, abuse, or ridicule targeting children or people with disabilities. |
| `v3_09_inappropriate_sexual_content` | `09_inappropriate_sexual_content.md` | Sexual content that is inappropriate even if not fully explicit. |
| `v3_10_explicit_sexual_scenes` | `10_explicit_sexual_scenes.md` | Explicit sexual scenes or clearly graphic sexual material. |
| `v3_11_profanity` | `11_profanity.md` | Profane or vulgar language. |
| `v3_12_women_abuse` | `12_women_abuse.md` | Abuse, humiliation, coercion, or violence directed at women. |
| `v3_13_family_values` | `13_family_values.md` | Content that undermines family values or family integrity. |
| `v3_14_parents_abuse` | `14_parents_abuse.md` | Abuse, disrespect, or degradation of parents. |
| `v3_15_elderly_abuse` | `15_elderly_abuse.md` | Abuse, disrespect, or humiliation of elderly people. |
| `v3_16_bullying` | `16_bullying.md` | Mockery, harassment, intimidation, or harsh peer abuse. |
| `v3_17_other` | `17_other.md` | Any remaining violation that fits the v3 framework but not a named subject. |

### v4 Context Map

`v4` is the newer subject-pack variant. It keeps the same multi-pass structure but reframes the subjects for the film-commission regulation language.

| Subject | Prompt file | Context |
|---|---|---|
| `v4_01_religious_fundamentals` | `01_religious_fundamentals.md` | Offense against Islamic fundamentals or religious principles. |
| `v4_02_state_leadership` | `02_state_leadership.md` | Insults or attacks on the state, leadership, or ruling authority. |
| `v4_03_national_security` | `03_national_security.md` | Threats or sensitive content affecting national security. |
| `v4_04_historical_documentary_reliability` | `04_historical_documentary_reliability.md` | Documentary or historical material that is unreliable or misleading. |
| `v4_05_society_identity_generalization` | `05_society_identity_generalization.md` | Negative generalizations or insults about Saudi society or identity. |
| `v4_06_children_crime_security` | `06_children_crime_security.md` | Crime, security, or harmful content directed at children. |
| `v4_07_drugs_alcohol_manufacture` | `07_drugs_alcohol_manufacture.md` | Teaching, manufacturing, or facilitating drugs or alcohol. |
| `v4_08_child_disability_harm` | `08_child_disability_harm.md` | Violence, humiliation, or abuse against children or people with disabilities. |
| `v4_09_lgbtq_positive_advocacy` | `09_lgbtq_positive_advocacy.md` | Positive advocacy or promotion of LGBTQ-related behavior. |
| `v4_10_explicit_sexual_scenes` | `10_explicit_sexual_scenes.md` | Explicit sexual scenes or graphic sexual depiction. |
| `v4_11_profanity` | `11_profanity.md` | Profane or vulgar speech. |
| `v4_12_other` | `12_other.md` | Other violations covered by the regulation but not covered by the named subjects. |

## Exact Chunk Payload

For every chunk, the judge receives:
1. The selected GCAM article blocks.
2. The chunk text itself.
3. The global offsets for the chunk.
4. The shared formatting rules.
5. Any pass-specific text overlay or subject prompt section.
6. A final instruction to return JSON only.

That means the model never receives a bare chunk alone. It always receives:
- article context
- the chunk
- strict output rules
- version-specific prompt content

## Version Relationship Note

- `v2` is the baseline multi-pass engine label.
- `v3` and `v4` are prompt-pack versions inside the same multi-pass engine.
- The removed hybrid system was the old folder-based `methodology-v3` / `policyV1` path, not these prompt versions.

## Exact Prompt Bundle

This is the exact structure the worker sends to OpenAI for every judge pass.

### Common Judge Shape

For every pass, the worker sends:
1. `system`: the judge system prompt.
2. `user`: article payload + chunk text + fixed formatting rules + pass-specific rules.
3. `response_format`: `json_object`.

The article payload is always the selected GCAM materials for that pass, rendered as:
- `المادة {id}: {title_ar}`
- the full Arabic article text
- any atom lines attached to that article

The chunk payload is always the current chunk text with offsets.

### v2 Exact Bundle

`v2` uses the shared judge prompt from [`apps/worker/src/aiConstants.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20rawwi-film-mainNew/apps/worker/src/aiConstants.ts) and the inline pass builders in [`apps/worker/src/multiPassJudge.ts`](/D:/Waheed/MypProjects/raawi%20emergency%20raawi-film-mainNew/apps/worker/src/multiPassJudge.ts).

What we tell OpenAI in v2:
- “Here are the relevant GCAM articles.”
- “Here is the chunk of script text.”
- “Use the shared GCAM judge rules.”
- “Return JSON only.”
- “Only keep findings that match this pass.”

Per-pass intent in v2:
- `glossary`: match exact forbidden lexicon terms and derivatives only.
- `insults`: find direct verbal insults and humiliation.
- `violence`: find threats or bodily harm.
- `sexual_content`: find sexual content or strong sexual implication.
- `drugs_alcohol`: find drugs, alcohol, intoxication, or promotion/use.
- `discrimination_incitement`: find discrimination or incitement.
- `women`: find abuse or degradation specifically targeting women.
- `national_security`: find threat, destabilization, or security-sensitive conduct.
- `extremism_banned_groups`: find support, praise, or justification for extremist/banned groups.
- `misinformation`: find claims presented as fact but likely false or misleading.
- `international_relations`: find hostility, insult, or incitement tied to nations or peoples.

### v3 Exact Bundle

`v3` uses:
- the shared judge prompt
- the v3 shared overlay from `docs/V3 prompts/shared_overview.md`
- the pass overlay markdown in `docs/V3 prompts/*.md`
- the subject prompt section for the active subject

What we tell OpenAI in v3:
- “Apply the v3 shared rules.”
- “Use the subject-specific markdown for this violation.”
- “Use nearby scene/story memory to resolve short evidence.”
- “Do not invent speaker, target, or relationship.”
- “Prefer the most specific label and avoid duplicates.”
- “Return JSON only.”

For v3, the prompt bundle is:
`shared_overview.md` + specific pass markdown + shared judge prompt + article payload + chunk text + strict JSON rules.

Per-subject intent in v3:
- `v3_01_religious_fundamentals`: direct offense against religion or religious fundamentals.
- `v3_02_political_leadership`: attack on leadership or political authority.
- `v3_03_national_security`: threat or hostility tied to national security.
- `v3_04_historical_unreliable`: unreliable or misleading historical content.
- `v3_05_society_identity`: insults or negative generalization about society or identity.
- `v3_06_children_crime`: crime directed at children or content pushing children toward crime.
- `v3_07_drugs_alcohol`: drugs/alcohol references, use, or promotion.
- `v3_08_child_disability_harm`: harm or ridicule targeting children or people with disabilities.
- `v3_09_inappropriate_sexual_content`: sexual content that is inappropriate but not necessarily explicit.
- `v3_10_explicit_sexual_scenes`: explicit sexual scenes.
- `v3_11_profanity`: profanity and vulgar speech.
- `v3_12_women_abuse`: abuse or degradation of women.
- `v3_13_family_values`: content that undermines family values.
- `v3_14_parents_abuse`: abuse or disrespect toward parents.
- `v3_15_elderly_abuse`: abuse or disrespect toward elderly people.
- `v3_16_bullying`: harassment, mockery, intimidation, or harsh bullying.
- `v3_17_other`: other v3-aligned violations that do not fit a named subject.

### v4 Exact Bundle

`v4` uses:
- the shared judge prompt
- the v4 shared overlay from `docs/V4 prompts/shared_overview.md`
- the subject prompt section for the active subject
- the markdown files in `docs/V4 prompts/*.md`

What we tell OpenAI in v4:
- “Apply the v4 operational rules.”
- “Do not return findings unless the snippet itself proves the violation.”
- “Use the exact evidence snippet and short rationale.”
- “Keep the finding under the exact subject only.”
- “Return JSON only.”

For v4, the prompt bundle is:
`shared_overview.md` + subject markdown + shared judge prompt + article payload + chunk text + strict JSON rules.

Per-subject intent in v4:
- `v4_01_religious_fundamentals`: offense against Islamic fundamentals.
- `v4_02_state_leadership`: attack on the state or leadership.
- `v4_03_national_security`: security-sensitive threat or destabilization.
- `v4_04_historical_documentary_reliability`: misleading or unreliable historical/documentary material.
- `v4_05_society_identity_generalization`: harmful generalization or insult against Saudi society or identity.
- `v4_06_children_crime_security`: crime, security, or harmful conduct aimed at children.
- `v4_07_drugs_alcohol_manufacture`: teaching or facilitating drugs/alcohol manufacture or use.
- `v4_08_child_disability_harm`: abuse or ridicule of children or people with disabilities.
- `v4_09_lgbtq_positive_advocacy`: positive advocacy or promotion of LGBTQ behavior.
- `v4_10_explicit_sexual_scenes`: explicit sexual scenes.
- `v4_11_profanity`: profanity and vulgar language.
- `v4_12_other`: other regulation-based violations not covered by the named subjects.

### Exact Return Contract

OpenAI is instructed to return JSON only.

Router returns:
```json
{ "candidate_articles": [ { "article_id": 1, "confidence": 0.92 } ], "notes_ar": "optional" }
```

Judge returns:
```json
{ "findings": [ ... ] }
```

If nothing is found:
```json
{ "findings": [] }
```

If the JSON is broken, the worker can ask OpenAI to repair it, but the target is still the same JSON structure.

## Bottom Line

If you want the shortest accurate description of the system:
- Upload creates a signed storage object.
- Script endpoints register metadata and trigger extraction.
- Extraction creates `analysis_jobs` and `analysis_chunks`.
- The worker runs router + multi-pass judge over every chunk.
- Prompt bodies come from source files and markdown prompt packs.
- Memory1 is baseline.
- Memory2 adds staged context and database persistence.
- Findings are written to `analysis_findings`.
- Reports are assembled in `analysis_reports`.

That is the analysis engine as it exists in this repo right now.
