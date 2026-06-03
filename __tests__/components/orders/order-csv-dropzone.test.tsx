/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderCsvDropZone } from "@/components/orders/OrderCsvDropZone";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.clearAllMocks();
});

function makeFile(name: string, type = "text/csv"): File {
  return new File(["col1,col2"], name, { type });
}

describe("OrderCsvDropZone", () => {
  it("renders upload prompt when no file is selected", () => {
    flushSync(() => {
      root.render(<OrderCsvDropZone file={null} onFileChange={vi.fn()} />);
    });
    expect(container.textContent).toContain("Drag & drop CSV here");
    expect(container.textContent).toContain("click to choose");
  });

  it("shows filename when a file is provided", () => {
    const file = makeFile("orders.csv");
    flushSync(() => {
      root.render(<OrderCsvDropZone file={file} onFileChange={vi.fn()} />);
    });
    expect(container.textContent).toContain("orders.csv");
    expect(container.textContent).toContain("Ready — press Send");
  });

  it("shows Remove file button when a file is loaded", () => {
    const file = makeFile("orders.csv");
    flushSync(() => {
      root.render(<OrderCsvDropZone file={file} onFileChange={vi.fn()} />);
    });
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Remove"),
    );
    expect(btn).toBeDefined();
  });

  it("calls onFileChange(null) when Remove is clicked", () => {
    const onFileChange = vi.fn();
    const file = makeFile("orders.csv");
    flushSync(() => {
      root.render(<OrderCsvDropZone file={file} onFileChange={onFileChange} />);
    });
    const removeBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Remove"),
    )!;
    flushSync(() => {
      removeBtn.click();
    });
    expect(onFileChange).toHaveBeenCalledWith(null);
  });

  it("shows an error for non-CSV files via file input change", () => {
    const onFileChange = vi.fn();
    flushSync(() => {
      root.render(<OrderCsvDropZone file={null} onFileChange={onFileChange} />);
    });
    const input = container.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    const nonCsvFile = new File(["data"], "data.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", {
      value: [nonCsvFile],
      configurable: true,
    });
    flushSync(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain(".csv");
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it("accepts a .csv file via the file input and calls onFileChange", () => {
    const onFileChange = vi.fn();
    flushSync(() => {
      root.render(<OrderCsvDropZone file={null} onFileChange={onFileChange} />);
    });
    const input = container.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    const csvFile = makeFile("import.csv");
    Object.defineProperty(input, "files", {
      value: [csvFile],
      configurable: true,
    });
    flushSync(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onFileChange).toHaveBeenCalledWith(csvFile);
  });

  it("renders in disabled state without allowing interaction", () => {
    flushSync(() => {
      root.render(
        <OrderCsvDropZone file={null} onFileChange={vi.fn()} disabled={true} />,
      );
    });
    const dropzone = container.querySelector("[role=button]") as HTMLElement;
    expect(dropzone.tabIndex).toBe(-1);
  });

  it("shows instructions including column names", () => {
    flushSync(() => {
      root.render(<OrderCsvDropZone file={null} onFileChange={vi.fn()} />);
    });
    expect(container.textContent).toContain("name,type,dueDate,quantity");
  });

  it("does not show Remove button when disabled", () => {
    const file = makeFile("orders.csv");
    flushSync(() => {
      root.render(
        <OrderCsvDropZone file={file} onFileChange={vi.fn()} disabled={true} />,
      );
    });
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Remove"),
    );
    expect(btn).toBeUndefined();
  });
});
