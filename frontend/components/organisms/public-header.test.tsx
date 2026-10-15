import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicHeader } from "./public-header";

const ACME = { name: "Acme Inc.", websiteUrl: "https://www.example.com", logoUrl: "" };

describe("PublicHeader", () => {
  it("shows the hiring company's name and links to its website", () => {
    render(<PublicHeader company={ACME} />);

    expect(screen.getByRole("link", { name: "Careers at Acme Inc., home" })).toHaveAttribute(
      "href",
      "/careers",
    );
    expect(screen.getByText("Acme Inc.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "example.com" })).toHaveAttribute(
      "href",
      "https://www.example.com",
    );
  });

  it("shows the company logo when one is configured", () => {
    render(<PublicHeader company={{ ...ACME, logoUrl: "https://cdn.example.com/logo.svg" }} />);

    expect(screen.getByRole("img", { name: "Acme Inc." })).toHaveAttribute(
      "src",
      "https://cdn.example.com/logo.svg",
    );
    expect(screen.queryByText("Acme Inc.")).not.toBeInTheDocument();
  });

  it("shows a logo served by the app itself", () => {
    render(<PublicHeader company={{ ...ACME, logoUrl: "/logo.png" }} />);

    expect(screen.getByRole("img", { name: "Acme Inc." })).toHaveAttribute("src", "/logo.png");
  });

  it("stays neutral without a configured company", () => {
    render(<PublicHeader company={{ name: "", websiteUrl: "", logoUrl: "" }} />);

    expect(screen.getByRole("link", { name: "Careers, home" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
