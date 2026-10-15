import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicFooter } from "./public-footer";

describe("PublicFooter", () => {
  it("credits the hiring company and links to its website", () => {
    render(
      <PublicFooter
        company={{ name: "Acme Inc.", websiteUrl: "https://www.example.com", logoUrl: "" }}
      />,
    );

    expect(screen.getByText("© Acme Inc.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "example.com" })).toHaveAttribute(
      "href",
      "https://www.example.com",
    );
  });

  it("always carries the powered-by link", () => {
    render(<PublicFooter company={{ name: "", websiteUrl: "", logoUrl: "" }} />);

    expect(screen.getByRole("link", { name: "Powered by BrainBox" })).toHaveAttribute(
      "href",
      "https://www.brainboxautomations.com",
    );
    expect(screen.queryByText(/©/)).not.toBeInTheDocument();
  });
});
