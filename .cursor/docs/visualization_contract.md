# Visualization contract

本文件定義 `/visualization/timeline` 的回應建議結構（對齊 `api_spec.yml` 的描述），讓 UI 端能穩定渲染甘特圖/時間軸/變更 diff。

## Endpoint

- `GET /visualization/timeline`
- query:
  - `factoryId?: string`
  - `startDate?: YYYY-MM-DD`
  - `endDate?: YYYY-MM-DD`

## Response shape (recommended)

```json
{
  "timeline": [
    {
      "orderId": "ord_...",
      "factoryId": "fac_...",
      "startAt": "2026-05-01T00:00:00.000Z",
      "endAt": "2026-05-03T00:00:00.000Z",
      "status": "SCHEDULED",
      "label": "Order A (qty=100)"
    }
  ],
  "conflicts": [
    {
      "conflictType": "CAPACITY",
      "severity": "ERROR",
      "startAt": "2026-05-02T00:00:00.000Z",
      "endAt": "2026-05-02T23:59:59.999Z",
      "orderIds": ["ord_..."],
      "message": "Capacity exceeded"
    }
  ],
  "diffs": [
    {
      "orderId": "ord_...",
      "field": "productionDate",
      "before": "2026-05-02T00:00:00.000Z",
      "after": "2026-05-03T00:00:00.000Z",
      "reason": "Rescheduled due to conflict"
    }
  ]
}
```

> 上述是「建議 contract」：目前 `api_spec.yml` 只定義為 array/object，後續可逐步補齊 schema。

## Stability rules

- `orderId/factoryId` 必須是 stable identifier
- 時間一律使用 ISO 8601（UTC）
- `conflictType/severity` 建議固定 enum（避免 UI hardcode string）

