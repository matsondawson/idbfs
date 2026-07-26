import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { render, screen, fireEvent } from "@testing-library/react";
import { Idbfs } from "../lib";
import { FileTree } from "../ui/FileTree";

// jsdom doesn't implement the Popover API yet; the context menu uses
// popover="manual" purely for its native top-layer/light-dismiss behavior,
// which isn't relevant to what these tests assert.
function stubPopover(container: HTMLElement) {
  const el = container.querySelector(".idbfs-tree__context-menu") as
    | (HTMLElement & { showPopover?: () => void; hidePopover?: () => void })
    | null;
  if (el) {
    el.showPopover = () => {};
    el.hidePopover = () => {};
  }
}

describe("FileTree readOnly / features", () => {
  let dbName: string;

  beforeEach(() => {
    dbName = `test-filetree-${Math.random()}`;
  });

  async function seed() {
    const fs = await new Idbfs({ dbName }).init();
    await fs.writeFile("/hello.txt", "hi");
  }

  it("shows mutating context menu items when writable", async () => {
    await seed();
    const fs = await new Idbfs({ dbName }).init();
    const { container } = render(<FileTree fs={fs} refreshKey={0} />);
    const row = await screen.findByText("hello.txt");
    stubPopover(container);
    fireEvent.contextMenu(row);
    expect(await screen.findByText("Rename")).not.toBeNull();
    expect(screen.getByText("Delete")).not.toBeNull();
  });

  it("hides mutating context menu items when read-only", async () => {
    await seed();
    const fs = await new Idbfs({ dbName, readOnly: true }).init();
    const { container } = render(<FileTree fs={fs} refreshKey={0} />);
    const row = await screen.findByText("hello.txt");
    stubPopover(container);
    fireEvent.contextMenu(row);
    expect(await screen.findByText("Copy")).not.toBeNull();
    expect(screen.queryByText("Rename")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("hides the built-in github toolbar and context-menu items when the github feature is disabled", async () => {
    await seed();
    const fs = await new Idbfs({ dbName }).init();
    await fs.mkdir("/proj");
    const { container } = render(<FileTree fs={fs} refreshKey={0} features={[]} />);
    const row = await screen.findByText("proj");
    expect(screen.queryByText("github: sign in")).toBeNull();
    stubPopover(container);
    fireEvent.contextMenu(row);
    expect(await screen.findByText("Copy")).not.toBeNull();
    expect(screen.queryByText(/GitHub:/)).toBeNull();
  });

  it("shows the built-in github toolbar and context-menu items by default", async () => {
    await seed();
    const fs = await new Idbfs({ dbName }).init();
    await fs.mkdir("/proj");
    const { container } = render(<FileTree fs={fs} refreshKey={0} />);
    expect(await screen.findByText("github: sign in")).not.toBeNull();
    const row = await screen.findByText("proj");
    stubPopover(container);
    fireEvent.contextMenu(row);
    expect(await screen.findByText("GitHub: Clone repo into new folder...")).not.toBeNull();
  });

  it("renders custom toolbar and context-menu extras regardless of features", async () => {
    await seed();
    const fs = await new Idbfs({ dbName }).init();
    const { container } = render(
      <FileTree
        fs={fs}
        refreshKey={0}
        features={[]}
        toolbar={<button>my tool</button>}
        renderContextMenuExtra={() => <div>my extra</div>}
      />,
    );
    expect(await screen.findByText("my tool")).not.toBeNull();
    const row = await screen.findByText("hello.txt");
    stubPopover(container);
    fireEvent.contextMenu(row);
    expect(await screen.findByText("my extra")).not.toBeNull();
  });
});
