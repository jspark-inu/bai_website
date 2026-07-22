---
title: BAI Next 단일 런타임 Task 9 cutover checklist
status: in_progress
updated_at: 2026-07-23T00:25:00+09:00
project: 1C38
canonical: true
---

# BAI Next 단일 런타임 Task 9 cutover checklist

## 승인과 변경 경계

- [x] 2026-07-23 PI가 Task 8 커밋과 Task 9 운영 진행을 명시적으로 승인했다.
- [x] Task 8은 `764a118`에 로컬 커밋했다.
- [ ] Task 9 preflight 변경을 검증·커밋한 뒤 `origin/main`에 push한다.
- [ ] 표준 자동배포만 사용하고 수동 rsync는 사용하지 않는다.
- [ ] `backend/`, `frontend/`, 운영 DB, uploads는 삭제하지 않는다.

## Preflight 기준선

- Source HEAD: `764a1185eb9010e6b5347f137a5116d571724319`
- Source branch: `main`, clean after Task 8 commit
- Origin/deploy-state: `3266d80cf3a046c1856d3f7b45862b72390b659f`
- Live code root: `/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/apps/web`
- Runtime env: `/Users/hai_1/AI-Workspace/code/runtime/config/bai-website.env` (regular file, mode 600, secret value not recorded)
- DB: `/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/backend/lab-feed.db`
- Uploads: `/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/backend/uploads`
- Verified DB backups: `/Users/hai_1/AI-Workspace/code/runtime/backups/bai_website`
- Code rollback snapshots: `/Users/hai_1/AI-Workspace/code/runtime/rollbacks/bai_website`
- Available disk: 63 GiB
- Pre-cutover HTTP: Flask health 200, local Next login/health 200, public login/health 200
- Pre-cutover listeners: Python `*:5066`, Node `*:5067`
- Loaded jobs: `com.user.bai-next`, `com.user.baifeed`, `com.user.baifeed-backup`, `com.user.bai-website-autodeploy`

### Pre-cutover data fingerprint

- SQLite `quick_check`: `ok`
- SQLite foreign-key errors: `0`
- Journal mode: `delete`
- Tables: `15`
- Migration ledger: `001_core_schema`, `002_legacy_compatibility`, `003_timestamp_compatibility`
- Upload files/bytes/symlinks: `0 / 0 / 0`
- Row counts:
  - members `18`, posts `10`, comments `8`, reactions `6`
  - projects `4`, project_members `2`, member_profiles `0`
  - materials `9`, inquiries `0`, wall_messages `2`
  - talent_requests `4`, talent_request_assignees `0`, contribution_points `0`
  - audit_log `50`, schema_migrations `3`

## Local release gates

- [x] TypeScript and generated route types
- [x] Frontend full tests: 350/350
- [x] Flask rollback oracle: 281 passed + 2 subtests
- [x] Static parity: 6/6
- [x] Talent-office harness: 5/5 and 55/55 focused contracts
- [x] Production build
- [x] Design harness RED reproduced against stale expectations
- [x] Design harness aligned with verified white-canvas/full-title release: 9/9
- [x] Isolated Playwright login/hydration/API smoke: login, current member, materials hydration, CSS/JS 200, unexpected browser errors 0
- [x] Next-only backup artifact and rollback command dry review

Preflight verified backup:

- File: `/Users/hai_1/AI-Workspace/code/runtime/backups/bai_website/lab-feed-task9-preflight-20260723-002604.db`
- Size: `159744` bytes
- SHA-256: `4b7245a63f63f1a51e413fd22ee9357df145e9c74d4fa45569fce3d344685b6f`
- Integrity/foreign keys: `ok / 0`
- Upload inventory: `/Users/hai_1/AI-Workspace/code/runtime/backups/bai_website/task9-preflight-uploads-inventory.json`

## Cutover actions

- [ ] Create and verify final SQLite online backup.
- [ ] Create uploads inventory/snapshot and record its hash.
- [ ] Preserve current Next, Flask, and backup plist files for rollback.
- [ ] Push the verified release to `origin/main` and observe automatic deployment.
- [ ] Confirm migration ledger includes `004_material_file_cleanup_queue` and `005_auth_sessions`.
- [ ] Confirm Next readiness and data/upload fingerprints before disabling Flask.
- [ ] Rewire `com.user.baifeed-backup` to the Node backup command and verify one run.
- [ ] Disable `com.user.baifeed`; confirm port 5066 has no listener.

## Live smoke and data comparison

- [ ] Public login page hydrates without browser errors; CSS/JS return 200.
- [ ] Temporary account login → `/api/me` → logout → replay rejection.
- [ ] Feed/read and malformed/anonymous authorization paths.
- [ ] Post create/edit/comment/react and cleanup.
- [ ] Project create/update/member link and cleanup.
- [ ] Admin member operation and API-key lifecycle.
- [ ] Goodbai `X-API-Key` request and cleanup.
- [ ] Material list/create/upload/download/replace/delete and file cleanup.
- [ ] Talent-office create/assign/review/solution/complete/points and cleanup.
- [ ] Inquiry/wall write and cleanup.
- [ ] `/api/runtime-health` database, migrations, uploads, and path fingerprints.
- [ ] Post-cutover `quick_check`, foreign-key check, row counts, upload inventory comparison.

## Rollback triggers and commands

Rollback immediately on login/session failure, integrity error, partial write, upload loss/disclosure, Goodbai regression, repeated 5xx, or runtime-health failure.

1. Restore the latest code snapshot from `/Users/hai_1/AI-Workspace/code/runtime/rollbacks/bai_website/deploy-*` using the deploy script's preserve exclusions.
2. Rebuild the restored Next release and restart `com.user.bai-next`.
3. Restore the preserved Flask plist with `launchctl bootstrap gui/$(id -u) <preserved-plist>` and `launchctl kickstart -k gui/$(id -u)/com.user.baifeed`.
4. Use the verified SQLite backup only if additive migrations or smoke cleanup cannot be safely reversed; compare row counts and integrity first.
5. Restore the previous backup plist if the Node backup job fails.

## Observation and closeout

- [ ] Observe for 30 minutes with blocking regression 0.
- [ ] Update `handoff-current.md`, migration roadmap, project Hub, service card, and live-services map.
- [ ] Register the live migration in the operational validation registry as `observing`.
- [ ] Do not archive or delete Flask/Python sources until operational acceptance is recorded separately.
