export type OrderCsvImportResult = {
  successCount: number;
  errorList: string[];
};

export async function importOrdersFromCsv(
  file: File,
): Promise<OrderCsvImportResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/orders/import", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    successCount?: number;
    errorList?: string[];
  };

  if (!res.ok) {
    throw new Error(body.message ?? `Import failed (${res.status})`);
  }

  return {
    successCount: body.successCount ?? 0,
    errorList: body.errorList ?? [],
  };
}
