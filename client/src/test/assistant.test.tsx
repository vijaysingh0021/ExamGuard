import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantPanel } from "../assistant";
import { canSend, errorText, suggestionsFor, trimHistory } from "../lib/assistant-client";

vi.mock("../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from "../lib/api";

describe("assistant client helpers", () => {
  it("keeps requests small", () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: "x".repeat(3000) + i }));
    const t = trimHistory(turns);
    expect(t).toHaveLength(12);
    expect(t.every((x) => x.content.length <= 2000)).toBe(true);
  });
  it("only sends non-empty messages while idle", () => {
    expect(canSend("  ", false)).toBe(false);
    expect(canSend("hi", true)).toBe(false);
    expect(canSend("hi", false)).toBe(true);
  });
  it("shows role-appropriate suggestions and friendly errors", () => {
    expect(suggestionsFor("student").join(" ")).toMatch(/camera/i);
    expect(suggestionsFor("institute_admin").join(" ")).toMatch(/analytics/i);
    expect(errorText(429)).toMatch(/too quickly/);
    expect(errorText(500)).not.toMatch(/500|stack/i);
  });
});

describe("AssistantPanel", () => {
  beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: { mode: "help_center" } }); vi.mocked(api.post).mockReset(); });

  it("opens accessibly, shows the mode, sends a message and renders sources", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { mode: "knowledge", answer: "Allow the camera in your browser.", sources: [{ id: "candidate-device-readiness", title: "Camera, microphone and network readiness" }], intent: "device_readiness", escalateToHuman: false, aiGenerated: false, disclaimer: "x" } });
    const user = userEvent.setup();
    render(<AssistantPanel organizationId="org-1" role="student" />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    expect(screen.getByRole("dialog", { name: /assistant/i })).toBeInTheDocument();
    expect(await screen.findByText("Help center")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/message the assistant/i), "camera blocked{Enter}");
    expect(await screen.findByText(/Allow the camera/)).toBeInTheDocument();
    expect(screen.getByText(/Camera, microphone and network readiness/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/api/organizations/org-1/assistant/chat", expect.objectContaining({ message: "camera blocked" }));
  });

  it("shows a friendly alert when the server rate-limits a request", async () => {
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { status: 429 } });
    const user = userEvent.setup();
    render(<AssistantPanel organizationId="org-1" role="student" />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    await user.type(screen.getByLabelText(/message the assistant/i), "hello{Enter}");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("closes on Escape and returns focus to the launcher", async () => {
    const user = userEvent.setup();
    render(<AssistantPanel organizationId="org-1" role="teacher" />);
    const launcher = screen.getByRole("button", { name: /help/i });
    await user.click(launcher);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });
});
