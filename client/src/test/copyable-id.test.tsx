import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopyableId } from "../components/ui/copyable-id";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CopyableId", () => {
  it("copies the full ID and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CopyableId id="candidate-uuid" label="Candidate UUID" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Candidate UUID" }));

    expect(writeText).toHaveBeenCalledWith("candidate-uuid");
    expect(await screen.findByText("Candidate UUID copied to clipboard.")).toBeTruthy();
  });

  it("keeps the ID visible and explains when clipboard access fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CopyableId id="exam-uuid" label="Examination UUID" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Examination UUID" }));

    expect(screen.getByText("exam-uuid")).toBeTruthy();
    expect(await screen.findByText("Copy unavailable; select the ID.")).toBeTruthy();
  });
});
