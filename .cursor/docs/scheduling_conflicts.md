# Scheduling & conflicts

本文件定義排程的「版本化、衝突」與「確認生效」的最小共識，對齊 `api_spec.yml` 的排程端點描述（包含版本號推進）。

## Scheduling concepts (recommended)

- **Schedule version**：每次確認生效（confirm/apply）都推進版本，讓 UI 可以做 diff
- **Time window**：排程通常以日期區間查詢（startDate/endDate）
- **Capacity**：工廠 capacity（`Factory.maxCapacity/curCapacity`）會影響可排性

## Conflict types (minimal)

至少需要能表達以下衝突：

- **capacity conflict**：該時間窗內超過最大產能
- **due date conflict**：排程後的 `productionDate` 晚於 `dueDate`
- **assignment conflict**：訂單尚未分配 factory 或分配到不允許的 factory/type

## Confirm/apply flow (recommended)

排程變更建議採兩段式：

1. **Propose**（preview）
   - 回傳 proposal + conflicts + timeline
2. **Confirm**（apply）
   - request 帶 `expectedVersion`
   - server 以 transaction 寫入
   - 成功後回傳 `newVersion`
   - 版本不一致回 `409`

## Data that UI/Visualization needs

要支援甘特圖/衝突視覺化，至少需要：
- timeline items（orderId, factoryId, start/end, status, label）
- conflicts（type, severity, time range, impacted orderIds）
- diffs（before vs after：變更欄位、舊值、新值）

詳細 contract 見 `docs/visualization_contract.md`。

