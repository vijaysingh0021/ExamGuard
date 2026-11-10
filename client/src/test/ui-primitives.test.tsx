import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge, Button, Card, CardContent, CardTitle, Input } from "../components/ui";

describe("ExamGuard UI primitives", () => {
  it("exposes semantic button variants and keyboard interaction", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button variant="outline" onClick={onClick}>Review incident</Button>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Review incident" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders status badges with accessible text", () => {
    render(<Badge variant="success">Verified</Badge>);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("composes cards and labels form controls", () => {
    render(<Card><CardContent><CardTitle>Candidate details</CardTitle><label htmlFor="candidate-email">Email</label><Input id="candidate-email" type="email" /></CardContent></Card>);
    expect(screen.getByRole("heading", { name: "Candidate details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });
});
