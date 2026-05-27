# Benchmark 與排程正確性驗證

本文說明 `scripts/benchmark.ts` 如何驗證 **Greedy Best-Fit** 排程邏輯，以及報告／簡報可如何呈現。實作以 [`modules/schedule/strategy.ts`](modules/schedule/strategy.ts) 的契約為準；細節亦見 [`modules/schedule/README.md`](modules/schedule/README.md)。

---

## 執行方式

```bash
pnpm benchmark
```

腳本使用 **Mulberry32** 固定種子（`SEED = 42`），同一環境下結果可重現。若在本機執行 `tsx` 遇權限問題，需在非沙箱環境執行（與一般 Node 專案相同）。

---

## 合成負載（與腳本一致）

| 項目 | 設定 |
|------|------|
| 可變訂單 | **10,000** 筆 `PENDING`，`isFixed = false`；`quantity` 100–2000、`dueDate` 在視窗內隨機（種子固定則可重現） |
| 固定訂單 | 50 筆 `isFixed = true`，預先帶 `SCHEDULED` 派工（模擬鎖定產能）；工廠與生產日由種子隨機自 20 廠中選取 |
| `isPrioritized` | 可變訂單與 Phase 2 新單均以約 **5%** 機率為 `true`（`PRIORITIZED_PROB = 0.05`，由種子決定） |
| 工廠 | **20** 間；每廠 `maxCapacity` 在 **1000–5000** 間隨機（腳本不區分產品型別，所有廠皆可服務所有訂單） |
| 產能視窗 | 每廠 180 天 × 20 廠 = **3,600** 筆初始 `DailyCapacity` |
| Phase 2 | 在 Phase 1（`GAP_FILLING`）baseline 後再注入 2,000 筆 `NEW_*` 訂單，分別以三種 `reschedulePolicy` 重跑 |

---

## 正確性怎麼定義？

可分三層理解：

1. **約束滿足（Invariant）** — 演算法有沒有違反系統規則？
2. **失敗合理性（Failure justification）** — 標成 `FAILED` 的訂單，事後用容量與時間窗能否解釋？
3. **效率指標（選用）** — 成功率、利用率、與理論上界的差距 — 回答「排得好不好」，**不**等同於無 bug。

三層一起才能較完整回答：「你怎麼知道排程是對的？」—— 不是靠單看 `FAILED` 筆數。

---

## 第一層：Invariant（目標 7/7）

下列性質在 **任意輸入** 下都應成立；腳本中任一項失敗即視為演算法或輸出結構有問題，並以非零 exit code 結束。

| # | Invariant | 定義（摘要） |
|---|-----------|--------------|
| 1 | 容量非負 | 所有產能列 `curCapacity >= 0` |
| 2 | 容量不超上限 | 所有產能列 `curCapacity <= maxCapacity`（rollback 未多還） |
| 3 | 數量守恆 | 仍為 `SCHEDULED` 且非 `isFixed` 的訂單：`既有 assignment + 本次 newAssignments` 總量 = `quantity` |
| 4 | 時間窗合規 | 所有 **新** assignment 的 `productionDate` 落在 `[startDate, deadline]`（依 `calculateOrderDeadline`） |
| 5 | Rollback 完整 | `FAILED` 訂單不得殘留任何 `newAssignments` |
| 6 | 不可變保護 | `isFixed` 訂單狀態不變、且不得出現預期外的新 assignment |
| 7 | **Prioritized 處理順序** | 見下一節 |

**Metric：** Invariant Pass Rate = 通過項數 / 7，目標 **7/7**。

> 若未來在合成資料加入 `order.type` / `factory.type`，應在腳本中補上與 `strategy.ts` 一致的 **型別—工廠** 檢查，並將 `totalInvariants` 一併調整。

---

## Prioritized（`isPrioritized`）驗證 — 第 7 項 Invariant

### 產品行為（策略層）

在 `greedyBestFitStrategy` 中，可變訂單排序的 **第一鍵** 為 `isPrioritized === true` 者在前（高於 `PRIORITY_RETAIN` 對既有 `SCHEDULED` 的偏好，也高於 `dueDate` / `quantity` / `createdAt`）。見 `strategy.ts` 內 mutable sort 與 README「訂單旗標」一節。

### 腳本如何檢查（不重複實作排序邏輯）

策略執行時會：

1. 先將所有 **immutable**（`isFixed` / `IN_PRODUCTION` / `COMPLETED`）寫入 `processedOrders` 並預扣產能；
2. 再依 **排序後順序** 逐一處理 mutable，並依序 append 至 `processedOrders`。

本 benchmark 的 immutable **僅** `isFixed` 訂單，因此：

- 取 `processedOrders` 中 **`!isFixed`** 的子序列，即為 **Greedy 實際處理 mutable 的順序**；
- **Invariant：** 在該子序列中，不得出現「先出現非 `isPrioritized`，之後又出現 `isPrioritized`」的情況（否則代表未把急單區塊排在一般單之前）。

對應程式：`checkPrioritizedProcessingOrder`（[`scripts/benchmark.ts`](scripts/benchmark.ts)）。

### 涵蓋範圍

- **Phase 1**：主跑一次 `GAP_FILLING` 後檢查；
- **Phase 2**：每個 policy（`GAP_FILLING` / `GLOBAL_OPTIMIZE` / `PRIORITY_RETAIN`）的 `execute` 結果各檢查一次；失敗會印出 policy 名稱與違規 `orderId` 並 `exit(1)`。

### 此項 **不** 驗證什麼

- **不**保證「凡 `isPrioritized` 必排入成功」— 仍受時間窗與總產能限制。
- **不**用統計（例如急單成功率較高）當 invariant — 在產能極寬鬆時無法當作必要條件；本項只驗證 **排序／處理順序契約** 與實作一致。

若未來 benchmark 加入非 `isFixed` 的 immutable（例如 `IN_PRODUCTION`），應改為與 `strategy.ts` 相同的 immutable 判斷，或改以「輸入時的 mutable id 集合」過濾順序，避免誤判。

---

## 第二層：Failure justification

對每一筆 `FAILED` 訂單分類：

| 類型 | 意義 |
|------|------|
| **Window conflict** | 有效時間窗為空（例如 deadline 早於排程起算邏輯上的可行區間）— 物理上無法排 |
| **Capacity exhausted** | 以排程**結束後**的產能快照，在該訂單時間窗內加總剩餘產能仍小於需求量 — 資源被其他訂單（含排序較前者）消耗，屬合理競爭結果 |
| **Greedy trade-off**（腳本統計名） | 最終快照下窗內剩餘產能仍 ≥ 需求量 — 可能代表排序／貪婪取捨或需追查的 **potential miss**（腳本會列出筆數供檢視） |

**Metric：** Failure Justification Rate =（Window conflict + Capacity exhausted）/ `FAILED` 總數；腳本目標為 **100%**（即 Greedy trade-off 為 0 時與「無明顯誤判失敗」對齊）。

---

## 第三層：效率指標（選用）

| Metric | 說明 |
|--------|------|
| 排程成功率 | 可變訂單中 `SCHEDULED` 比例 |
| 容量利用率 | 新分配量對總可用產能之比（本合成場景下總供給常遠大於需求，數值可能偏低屬正常） |
| 對理論上界 | 成功排入量相對 `min(總需求, 總系統容量)` 的比例 |

以上數值 **隨種子與當日基準日而變**，簡報請以你實際一次 `pnpm benchmark` 終端輸出為準。

---

## 簡報建議：正確性金字塔

```
          ┌───────────────┐
          │  效率指標      │  排得好不好（選用）
          ├───────────────┤
          │  失敗合理性    │  FAILED 能否被容量／時間解釋
          │  目標: 100%   │
          ├───────────────┤
          │  Invariant    │  含 Prioritized 等 7 項
          │  目標: 7/7    │
          └───────────────┘
```

### 最近一次實跑（`SEED = 42`，本機 `pnpm benchmark`，工廠 20）

**Phase 1（單次 `GAP_FILLING`）**

| 項目 | 數值 |
|------|------|
| 規模 | 10,050 訂單（10,000 可變 + 50 固定）× 20 工廠 × 180 天 |
| 執行時間 | ~3180 ms |
| 排程結果 | 9,510 `SCHEDULED`（含 50 筆固定）、540 `FAILED` |
| Invariant | 7/7 |
| Failure justification | 100%（Window 121 / Capacity exhausted 419 / Greedy trade-off 0） |
| 可變單成功率 | 94.6%（9,460 / 10,000） |
| 容量利用率 | 91.6%；對理論上界 94.9% |

**Phase 2（+2,000 新單，三種 policy）**

| 指標 | GAP_FILLING | GLOBAL_OPTIMIZE | PRIORITY_RETAIN |
|------|-------------|-----------------|-----------------|
| Total scheduled | 9,681 | 9,090 | 9,700 |
| Total failed | 2,369 | 2,960 | 2,350 |
| New scheduled (/2000) | 171 | 1,518 | 248 |
| Retained (/9460) | 9,460 | 7,522 | 9,402 |
| Displaced | 0 | 1,938 | 58 |
| Stability | 100.0% | 79.5% | 99.4% |
| Execution (ms) | ~796 | ~4018 | ~3832 |

簡報填表時請以你當次終端輸出為準（機器與 Node 版本會影響 wall time）。

---

## Section 4：三種 `reschedulePolicy` 比較

Phase 2 在相同 baseline 下比較：

| 指標 | 意義 |
|------|------|
| Total scheduled / failed | 該 policy 跑完後總排入／總失敗 |
| New orders (/2000) | `NEW_*` 中變為 `SCHEDULED` 的筆數 |
| Retained (/Phase1 scheduled) | Phase 1 已 `SCHEDULED` 且 Phase 2 仍 `SCHEDULED` |
| Displaced | Phase 1 已 `SCHEDULED` 但 Phase 2 變 `FAILED` |
| Stability | Retained / Phase1 scheduled |
| Execution (ms) | 該 policy 單次策略耗時 |

**一句話對照：**

- **GAP_FILLING**：既有已排產能不釋放，新單只填空隙 — 通常 **最穩、最快**，新單成功率可能較低。
- **GLOBAL_OPTIMIZE**：釋放可變單產能後全局重排 — 通常 **總排入與新單成功較高**，但可能出現 **displaced**（既有單被擠掉）。
- **PRIORITY_RETAIN**：釋放後重排但排序上偏保留既有 `SCHEDULED` — **折衷** churn 與產能利用。

表內具體數字請以每次 `pnpm benchmark` 輸出為準（不同機器與日期基準會影響 wall time）。

---

## 與測試的分工

| 層級 | 位置 |
|------|------|
| 單元／整合測試 | `__tests__/modules/schedule/strategy.test.ts` 等（含 `isPrioritized` 排序案例） |
| 大規模回歸／簡報數字 | `pnpm benchmark` → `scripts/benchmark.ts` |

Benchmark 用於 **壓力下的不變量與失敗分類**，補足單測無法涵蓋的規模與組合；第 7 項把 **急單排序契約** 固定成可機械檢查的條件。帶 `order.type` 的場景請以 `__tests__/modules/schedule/strategy.test.ts` 與 README 為準；合成腳本目前未模擬多型別工廠。
