# Skill: DevOps release checklist

## Purpose

把「發版」變成可重複、可回滾、可觀測的流程，特別針對 Prisma migrations 與 JWT secrets。

## Inputs

- release scope（本次改了哪些功能/端點/資料表）
- 是否包含 Prisma migration（yes/no）
- 部署環境（staging/prod）

## Checklist

### A) Pre-release

- [ ] `pnpm lint` 乾淨
- [ ] `pnpm build` 成功
- [ ]（若有）tests 通過
- [ ] `.env`/secrets 已在環境設定（JWT signing key 不可缺）

### B) Migration strategy

- [ ] 是否為向後相容變更？（新增 nullable 欄位、避免立即加 NOT NULL/嚴格 constraint）
- [ ] 部署順序：code（相容）→ migrate deploy → 開新 feature
- [ ] 若不可避免 breaking change：準備 feature flag / staged rollout

### C) Deploy

- [ ] `pnpm db:deploy`（prod/staging）
- [ ] health check（至少能 hit 一個受保護 endpoint）
- [ ] RBAC smoke test：SUPERADMIN/ADMIN/SALES 各一條讀寫路徑

### D) Rollback plan (forward-only migrations)

- [ ] 有 feature flag 可快速關閉
- [ ] 若資料寫入不一致：準備補償腳本（forward migration）
- [ ] log/metrics/alerts 可定位問題

## Output artifacts

- release notes（簡要）
- migration notes（若有）
- rollback notes（若有）

