import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorState } from "@/components/ErrorState";

describe("ErrorState", () => {
  it('显示"无法连接后端"（O-2）', () => {
    render(<ErrorState />);
    expect(screen.getByText(/无法连接后端|不可用/i)).toBeInTheDocument();
  });
});
