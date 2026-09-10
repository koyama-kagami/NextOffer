# Implementation contracts

Root owns this document. Imports use `@nextoffer/core` / `@nextoffer/ai`.

## Core

Export `Kind = 'knowledge' | 'jobs' | 'resumes' | 'interviews'` and `RecordMap`.
All records: id:string, schemaVersion:1, revision:number, createdAt:string, updatedAt:string.
- Knowledge: title:string, content:string, tags:string[].
- Job: company:string, title:string, jd:string, url:string, location:string, status:'saved'|'applied'|'test'|'interview'|'offer'|'closed', deadline:string (date or empty), interviewAt:string (ISO offset or empty), notes:string, resumeId:string, resumeVersion:number|null.
- Resume: title:string, source:string, version:number.
- Interview: title:string, jobId:string, resumeId:string, resumeVersion:number|null, contextSnapshot:string, mode:'mock'|'real', status:'active'|'completed', messages:{id:string,role:'interviewer'|'candidate',content:string}[], review:Review|null. Core pins resumeVersion on association; AI saves contextSnapshot on first call for reuse.
- Review: summary:string, strengths:string[], improvements:string[], dimensions:{name:'技术知识'|'项目深度'|'问题分析'|'表达结构',score:number|null,evidence:string[]}[], rubricVersion:1.
- Profile: name:string, email:string, phone:string, education:string, experience:string, skills:string, updatedAt:string, revision:number.

`new Workspace(root:string)`; `.root`; async `.init():Promise<void>` idempotent;
`.list<K extends Kind>(kind:K):Promise<RecordMap[K][]>`;
`.get<K extends Kind>(kind:K,id:string):Promise<RecordMap[K]>`;
`.save<K extends Kind>(kind:K,input:Partial<RecordMap[K]>):Promise<RecordMap[K]>` defaults fields, requires revision when id supplied, validates;
`.remove(kind:Kind,id:string,revision:number):Promise<void>`;
`.profile():Promise<Profile>` and `.saveProfile(input:Partial<Profile>):Promise<Profile>`;
`.search(query:string):Promise<SearchHit[]>` where SearchHit={id,title,excerpt,score,paragraph:number};
`.importKnowledge(name:string,bytes:Uint8Array):Promise<Knowledge>` supports .md/.txt/.pdf;
`.versions(id:string):Promise<{version:number,source:string}[]>`;
`.buildResume(id:string):Promise<string>` returns path to compiled PDF;
`.exportData():Promise<{profile:Profile,knowledge:Knowledge[],jobs:Job[],resumes:Resume[],interviews:Interview[]}>`;
Export `AppError extends Error` with code:string and optional status:number.
Export `resumeTemplate:string` minimal Chinese ctexart (no external assets).
All files stay inside root, error codes distinguish NOT_FOUND/VALIDATION/CONFLICT/NO_LATEX/COMPILE_FAILED.

## AI

Export `AIConfig={baseUrl:string,model:string,apiKey:string}`; `ModelClient(config)`.
Async `.ask(question:string,sources:SearchHit[]):Promise<string>` references source title/paragraph; `.reviseResume(source:string,instruction:string):Promise<string>` returns only LaTeX source; `.nextQuestion(interview:Interview,context:string):Promise<string>`; `.review(interview:Interview,context:string):Promise<Review>` validates evidence against candidate IDs and score ranges.
No key persistence in library. Timeout 45 seconds, error response never exposes provider response body/key. `AIError` has code:string. No ambient API use in tests. User-provided models, no hardcoded provider defaults.

## HTTP (root implements, UI consumes)

All routes prefix /api; responses `{ok:true,data:T}` or `{ok:false,error:{code,message}}`.
GET /bootstrap -> {token:string,workspace:string,profile:Profile,knowledge:Knowledge[],jobs:Job[],resumes:Resume[],interviews:Interview[],ai:{baseUrl:string,model:string,configured:boolean}}.
All mutation requests use X-NextOffer-Token token from bootstrap. POST content-type application/json.
GET /records/:kind; GET /records/:kind/:id; POST /records/:kind -> save(input); DELETE /records/:kind/:id?revision=N.
POST /profile -> saveProfile(input).
GET /search?q=... -> SearchHit[].
POST /import -> {name,base64} -> Knowledge.
GET /resumes/:id/versions -> {version,source}[].
POST /resumes/:id/build -> {url:'/api/resumes/:id/pdf'}; GET /resumes/:id/pdf -> application/pdf.
GET /export -> snapshot JSON (no credentials).
POST /settings -> {baseUrl,model,apiKey} -> {configured,baseUrl,model}; memory-only credentials, blank apiKey retains prior key, clear:true clears. Env fallback NEXT OFFER variables documented by root.
POST /ai/ask -> {question,noteId?:string} -> {answer:string,sources:SearchHit[]} (root obtains search or selected note paragraphs).
POST /ai/resume -> {source,instruction} -> {source:string}, proposals not auto-saved.
POST /ai/question -> {id,revision} -> saved Interview with appended interviewer message; root obtains context from job/resume/knowledge; stale revision rejected.
POST /ai/review -> {id,revision} -> saved Interview with review and completed status.
All missing-model actions fail explicitly, no fake responses.

## Browser

Use fetch wrappers in apps/web/src/api.ts. Token memory in api module. Bootstrap refresh after mutations. Four tabs; settings modal (BYOK api); no fabricated records/stats. Default empty state; users can create notes/job/resume/mock or real interview. For interview: create then generate question, save candidate message with random UUID, then request follow-up; allow agent results via CLI save. UI no direct filesystem or model secrets in localStorage.
