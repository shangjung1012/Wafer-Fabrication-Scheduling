# Scheduling Conflict — Test Cases

本文件列舉具體的衝突情境，作為實作衝突偵測與通知功能的測試基準。

**共同前提（除非另行說明）：**

- `frozenDays = 0`, `productionDays = 1`, `bufferDays = 0`
- WindowStart = Today + 1，WindowEnd = dueDate
- 排程引擎執行時間（Today）= **2026-05-16**
- 訂單優先序：`dueDate ASC` → `quantity DESC` → `createdAt ASC`

---

## Case 1：單工廠、同交期、容量被高優先序吃滿

**情境：** 兩筆訂單交期相同，高數量的訂單（高優先）搶先排入，導致低數量訂單（低優先）無空間。

### 初始狀態

| 工廠       | maxCapacity/day |
| :--------- | :-------------- |
| factory-A1 | 100             |

| 訂單    | dueDate    | quantity | createdAt  | 優先序               |
| :------ | :--------- | :------- | :--------- | :------------------- |
| Order-A | 2026-05-17 | 100      | 2026-05-01 | **1（quantity 大）** |
| Order-B | 2026-05-17 | 60       | 2026-05-02 | **2（quantity 小）** |

### 排程過程

```
排程視窗（兩筆單的 WindowEnd 均為 May 17）

處理 Order-A（優先）：
  May 17 → factory-A1 剩餘 100 → 分配 100 → 完成 ✓
  factory-A1 May 17：剩餘 0

處理 Order-B（次）：
  May 17 → factory-A1 剩餘 0 → 無可用容量
  視窗結束，RemainingQty = 60 → Rollback
```

### 結果

- Order-A：SCHEDULED（May 17, factory-A1, qty 100）
- Order-B：**CONFLICT** — dueDate 前所有容量已被高優先序訂單佔滿，且 Order-A 排在自身 dueDate 上，無法往後移

### 為何是衝突而非一般 Rollback

Order-A 的 dueDate 就是 May 17，再移就會違反其交期。兩廠（本例只有一廠）在 May 17 前無任何空餘日期。

---

## Case 2：多工廠、新單插入、全部工廠當天額滿

**情境：** 同生產類型的所有工廠在目標日均已排滿，新進訂單（最低優先）無法被任何工廠容納。

### 初始狀態

| 工廠       | maxCapacity/day |
| :--------- | :-------------- |
| factory-A1 | 100             |
| factory-A2 | 100             |

| 訂單    | dueDate    | quantity | createdAt  | 優先序            |
| :------ | :--------- | :------- | :--------- | :---------------- |
| Order-A | 2026-05-17 | 100      | 2026-05-01 | **1**             |
| Order-B | 2026-05-17 | 100      | 2026-05-02 | **2**             |
| Order-C | 2026-05-17 | 50       | 2026-05-10 | **3（最晚送單）** |

### 排程過程

```
處理 Order-A：
  May 17, factory-A1 → 分配 100 ✓

處理 Order-B：
  May 17, factory-A1 剩餘 0 → 嘗試 factory-A2
  May 17, factory-A2 剩餘 100 → 分配 100 ✓

處理 Order-C：
  May 17, factory-A1 剩餘 0
  May 17, factory-A2 剩餘 0
  視窗僅剩 May 17，全滿 → Rollback
```

### 結果

- Order-A：SCHEDULED（May 17, factory-A1）
- Order-B：SCHEDULED（May 17, factory-A2）
- Order-C：**CONFLICT** — 所有工廠在唯一可用日期均無剩餘容量

### 通知對象

- Admin（Type A 管理員）：收到 Email，說明 Order-C 無法排入
- Sales（Order-C 的 applicant）：收到通知，建議與客戶協調延後 dueDate 或縮減 quantity

---

## Case 3：多天視窗，各天均被高優先序填滿

**情境：** 低優先訂單有多天可用視窗，但每一天都被更高優先序的訂單佔滿。

### 初始狀態

| 工廠       | maxCapacity/day |
| :--------- | :-------------- |
| factory-A1 | 100             |

Today = 2026-05-14（視窗從 May 15 開始）

| 訂單    | dueDate    | quantity | createdAt  | 優先序                                       |
| :------ | :--------- | :------- | :--------- | :------------------------------------------- |
| Order-A | 2026-05-15 | 100      | 2026-05-01 | **1（最早 dueDate）**                        |
| Order-B | 2026-05-16 | 100      | 2026-05-02 | **2**                                        |
| Order-C | 2026-05-16 | 80       | 2026-05-03 | **3（同 dueDate 為 May 16，quantity 較小）** |

### 排程過程

```
處理 Order-A（dueDate May 15）：
  Window: May 15 only
  May 15, factory-A1 → 分配 100 ✓

處理 Order-B（dueDate May 16）：
  Window: May 15–16
  May 15, factory-A1 剩餘 0 → 嘗試 May 16
  May 16, factory-A1 剩餘 100 → 分配 100 ✓

處理 Order-C（dueDate May 16）：
  Window: May 15–16
  May 15, factory-A1 剩餘 0
  May 16, factory-A1 剩餘 0
  視窗耗盡 → Rollback
```

### 結果

- Order-A：SCHEDULED（May 15, factory-A1）
- Order-B：SCHEDULED（May 16, factory-A1）
- Order-C：**CONFLICT** — May 15 被 Order-A 佔（A 在其 dueDate 上不可移），May 16 被 Order-B 佔（B 在其 dueDate 上不可移）

---

## Case 4：部分容量不足（拆單仍無解）

**情境：** 低優先訂單嘗試拆分後仍無法在視窗內完整排入。

### 初始狀態

| 工廠       | maxCapacity/day |
| :--------- | :-------------- |
| factory-A1 | 100             |

| 訂單    | dueDate    | quantity | createdAt  | 優先序 |
| :------ | :--------- | :------- | :--------- | :----- |
| Order-A | 2026-05-17 | 80       | 2026-05-01 | **1**  |
| Order-B | 2026-05-17 | 50       | 2026-05-02 | **2**  |

### 排程過程

```
處理 Order-A：
  May 17, factory-A1 剩餘 100 → 分配 80 → factory-A1 May 17 剩餘 20 ✓

處理 Order-B（qty=50）：
  May 17, factory-A1 剩餘 20 → 分配 20，RemainingQty = 30
  視窗僅剩 May 17，無更多日期 → RemainingQty = 30 > 0 → Rollback
```

### 結果

- Order-A：SCHEDULED（May 17, factory-A1, qty 80）
- Order-B：**CONFLICT** — 即使嘗試拆單，May 17 只剩 20 無法滿足 qty 50，且視窗已結束

> **注意**：Rollback 後 factory-A1 May 17 的剩餘容量恢復至 20，但 Order-B 整筆訂單被捨棄（不會只排 20）。

---

## 反例：一般 Rollback（不觸發衝突通知）

**情境：** 訂單當前無法排入，但存在「未來容量釋放後可成功」的可能性，屬於正常等待重試。

### 初始狀態

| 工廠       | maxCapacity/day |
| :--------- | :-------------- |
| factory-A1 | 100             |

今天（May 16）factory-A1 已有 SCHEDULED 分配：

| 日期   | 已用容量 | 狀態                                 |
| :----- | :------- | :----------------------------------- |
| May 17 | 100      | SCHEDULED（Order-X，dueDate May 20） |
| May 18 | 100      | SCHEDULED（Order-Y，dueDate May 20） |

| 訂單    | dueDate    | quantity | createdAt  |
| :------ | :--------- | :------- | :--------- |
| Order-Z | 2026-05-18 | 50       | 2026-05-16 |

### 排程過程

```
處理 Order-Z：
  Window: May 17–18
  May 17: 剩餘 0（Order-X 佔滿）
  May 18: 剩餘 0（Order-Y 佔滿）
  Rollback → Order-Z 狀態維持 APPROVED
```

### 為何不是衝突

- Order-X 和 Order-Y 的 dueDate 是 May 20，它們本身有空間被往前移或往後調（May 19、May 20 仍有容量）
- 下一次排程執行時，引擎會重置 SCHEDULED 容量重新計算，**可能找到更優的分配**讓 Order-Z 也能排入
- 因此這是暫時性 Rollback，**不應觸發衝突通知**

---

## 衝突 vs 一般 Rollback 判斷摘要

| 條件                                       | 一般 Rollback  | 排程衝突   |
| :----------------------------------------- | :------------- | :--------- |
| 視窗內有容量，但本次被更高優先序佔用       | ✓ 等待重試     | —          |
| 佔用容量的訂單本身還有餘裕可調動           | ✓ 下次可能重排 | —          |
| 視窗內所有日期 × 所有工廠均無容量          | —              | ✓          |
| 佔用容量的訂單皆已排在其 dueDate，無法移動 | —              | ✓ 觸發通知 |
