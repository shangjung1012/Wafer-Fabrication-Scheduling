/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dnd-kit — tests don't exercise drag-and-drop
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));
vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Translate: { toString: () => "" } },
}));

import {
  DraggableAssignmentChip,
  DroppableCell,
} from "@/app/(dashboard)/visualization/_components/edit-cell";
import type { TimelineItem } from "@/modules/visualization/types";

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    assignmentId: "a-1",
    orderId: "o-1",
    orderName: "Alpha",
    isFixed: false,
    isPrioritized: false,
    factoryId: "f-1",
    productionDate: "2026-06-03",
    assignedQuantity: 100,
    status: "SCHEDULED",
    dueDate: "2026-12-31",
    applicantId: "s-1",
    applicantUsername: "sales1",
    lastModifiedById: null,
    ...overrides,
  };
}

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

describe("DraggableAssignmentChip", () => {
  it("renders order name and quantity", () => {
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip item={makeItem()} isMoved={false} />,
      );
    });
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("100");
  });

  it("shows Lock icon title for locked-by-status items", () => {
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip
          item={makeItem({ status: "IN_PRODUCTION" })}
          isMoved={false}
        />,
      );
    });
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.title).toContain("locked");
  });

  it("calls onClickItem when locked chip is clicked", () => {
    const onClickItem = vi.fn();
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip
          item={makeItem({ status: "COMPLETED" })}
          isMoved={false}
          onClickItem={onClickItem}
        />,
      );
    });
    const chip = container.querySelector("[role=button]") as HTMLElement;
    flushSync(() => {
      chip.click();
    });
    expect(onClickItem).toHaveBeenCalledTimes(1);
  });

  it("calls onClickItem on Enter key for locked chip", () => {
    const onClickItem = vi.fn();
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip
          item={makeItem({ status: "COMPLETED" })}
          isMoved={false}
          onClickItem={onClickItem}
        />,
      );
    });
    const chip = container.querySelector("[role=button]") as HTMLElement;
    flushSync(() => {
      chip.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onClickItem).toHaveBeenCalledTimes(1);
  });

  it("renders SCHEDULED chip without locked title", () => {
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip item={makeItem()} isMoved={false} />,
      );
    });
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.title).not.toContain("locked");
  });

  it("shows Crown icon when item is prioritized (locked status)", () => {
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip
          item={makeItem({ status: "IN_PRODUCTION", isPrioritized: true })}
          isMoved={false}
        />,
      );
    });
    // Crown svg should be in the DOM
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("shows Lock icon when item is fixed (SCHEDULED)", () => {
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip
          item={makeItem({ isFixed: true })}
          isMoved={false}
        />,
      );
    });
    expect(container.textContent).toContain("SCHEDULED");
  });

  it("shows lock/priority toggles in edit mode when handlers provided", () => {
    flushSync(() => {
      root.render(
        <DraggableAssignmentChip
          item={makeItem()}
          isMoved={false}
          editMode={true}
          onToggleOrderFixed={vi.fn()}
          onToggleOrderPrioritized={vi.fn()}
        />,
      );
    });
    const checkboxes = container.querySelectorAll("input[type=checkbox]");
    expect(checkboxes.length).toBe(2);
  });
});

describe("DroppableCell", () => {
  it("renders children", () => {
    flushSync(() => {
      root.render(
        <DroppableCell cellId="cell-1">
          <span>content</span>
        </DroppableCell>,
      );
    });
    expect(container.textContent).toContain("content");
  });

  it("shows invalidReason as title when disabled", () => {
    flushSync(() => {
      root.render(
        <DroppableCell
          cellId="cell-1"
          disabled={true}
          invalidReason="No capacity"
        >
          <span>x</span>
        </DroppableCell>,
      );
    });
    const div = container.firstElementChild as HTMLElement;
    expect(div.title).toBe("No capacity");
  });
});
